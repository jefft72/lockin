import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { get } from "node:http";
import { IDENTITY_PATH, type Identity, parseIdentity } from "./server.ts";

/** What is listening on the port right now. */
export type Probe =
	| { readonly state: "free" }
	/** Something answered, and it is not this app. */
	| { readonly state: "foreign" }
	| { readonly state: "running"; readonly identity: Identity };

export type Plan = "open" | "start" | "restart" | "refuse";

/**
 * What `study` should do given what it found on the port. A server left over
 * from an older install is replaced, so reinstalling is all an update takes.
 */
export function plan(found: Probe, build: string): Plan {
	if (found.state === "free") return "start";
	if (found.state === "foreign") return "refuse";
	return found.identity.build === build ? "open" : "restart";
}

const POLL_MS = 50;
const PROBE_TIMEOUT_MS = 2000;
const START_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** More than any identity reply needs: a stranger streaming forever is cut off here. */
const MAX_REPLY_BYTES = 4096;

/**
 * Asks whatever is on the port who it is.
 *
 * Deliberately not `fetch`: fetch keeps connections alive in a pool, and this
 * is called right before and right after killing the server it talked to.
 * Reusing a pooled socket whose server has just died can throw from inside
 * Node (seen as an uncaught `setTypeOfService EINVAL` on Node 26), taking the
 * whole command down. One fresh connection per probe cannot go stale.
 */
export function probe(port: number): Promise<Probe> {
	return new Promise((resolve) => {
		const foreign = () => resolve({ state: "foreign" });
		const request = get(
			{ host: "127.0.0.1", port, path: IDENTITY_PATH, agent: false, timeout: PROBE_TIMEOUT_MS },
			(response) => {
				let reply = "";
				response.setEncoding("utf8");
				response.on("error", foreign);
				response.on("data", (chunk: string) => {
					reply += chunk;
					if (reply.length > MAX_REPLY_BYTES) request.destroy();
				});
				response.on("end", () => {
					let identity: Identity | null = null;
					try {
						if (response.statusCode === 200) identity = parseIdentity(JSON.parse(reply));
					} catch {
						// Not JSON, so not this app.
					}
					resolve(identity ? { state: "running", identity } : { state: "foreign" });
				});
			},
		);
		request.on("timeout", () => request.destroy());
		// Refused means nothing is listening. Anything else (a reset, a hang, a
		// half-open socket) means something is there and it is not answering as us.
		request.on("error", (error: NodeJS.ErrnoException) => {
			resolve(error.code === "ECONNREFUSED" ? { state: "free" } : { state: "foreign" });
		});
	});
}

function tail(file: string, lines = 12): string {
	try {
		return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
	} catch {
		return "";
	}
}

/**
 * Starts the server as its own process, detached from this terminal, and
 * resolves once it is answering. `command` is how to run the server in the
 * foreground; its output goes to `logFile`.
 */
export async function start(
	port: number,
	command: readonly [string, ...string[]],
	logFile: string,
): Promise<Identity> {
	const [file, ...args] = command;
	const log = openSync(logFile, "w");
	const child = spawn(file, args, { detached: true, stdio: ["ignore", log, log] });
	closeSync(log);
	let exited = false;
	child.once("exit", () => {
		exited = true;
	});
	child.once("error", () => {
		exited = true;
	});
	child.unref();

	const deadline = Date.now() + START_TIMEOUT_MS;
	while (!exited && Date.now() < deadline) {
		const found = await probe(port);
		// Only the process just started counts: not a stranger that got there first.
		if (found.state === "running" && found.identity.pid === child.pid) return found.identity;
		await sleep(POLL_MS);
	}
	if (!exited) child.kill();
	const output = tail(logFile);
	throw new Error(`the server did not start${output ? `:\n${output}` : ""}`);
}

/** Asks a running server to stop and resolves once the port is free. */
export async function stop(port: number, identity: Identity): Promise<void> {
	try {
		process.kill(identity.pid, "SIGTERM");
	} catch {
		// Already gone.
	}
	const deadline = Date.now() + STOP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if ((await probe(port)).state === "free") return;
		await sleep(POLL_MS);
	}
	throw new Error(`the server (pid ${identity.pid}) did not stop`);
}
