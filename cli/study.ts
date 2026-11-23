#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spotifyBridge } from "../bridge/spotify.ts";
import { plan, probe, start, stop } from "./daemon.ts";
import { openBrowser } from "./open.ts";
import { createAppServer, loadSite } from "./server.ts";

// The bank lives in the browser's storage for this exact address, so the
// default port is a promise: change it and the bank appears empty.
const DEFAULT_PORT = 2525;

const HELP = `usage: study [command] [options]

  study            open the timer, starting its server if needed
  study stop       stop the server
  study status     say whether the server is running
  study serve      run the server in this terminal, not the background

options:
  --port <n>       serve on another port (default ${DEFAULT_PORT}). The bank belongs
                   to the address, so another port is another, empty bank.
  --no-open        do not open the browser
  -h, --help       show this
  -v, --version    show the version
`;

class UsageError extends Error {}

/** The directory holding package.json, whether this runs from source or from the build. */
function packageRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	while (!existsSync(join(dir, "package.json"))) {
		const parent = dirname(dir);
		if (parent === dir) throw new Error("cannot find the lockin package");
		dir = parent;
	}
	return dir;
}

function parsePort(value: string | undefined): number {
	if (value === undefined) return DEFAULT_PORT;
	const port = Number(value);
	if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
		throw new UsageError(`not a port: ${value}`);
	}
	return port;
}

function serve(port: number, webRoot: string): void {
	const server = createAppServer(loadSite(webRoot), spotifyBridge());
	server.once("error", (error: NodeJS.ErrnoException) => {
		const reason = error.code === "EADDRINUSE" ? `port ${port} is already in use` : error.message;
		console.error(`study: ${reason}`);
		process.exit(1);
	});
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			server.close(() => process.exit(0));
			// Browsers hold connections open. Do not wait for them.
			server.closeAllConnections();
		});
	}
	// Loopback only: this is one person's timer, not a service.
	server.listen(port, "127.0.0.1", () => console.log(`lockin on http://127.0.0.1:${port}`));
}

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			port: { type: "string" },
			"no-open": { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
			version: { type: "boolean", short: "v", default: false },
		},
	});
	const root = packageRoot();
	if (values.help) {
		process.stdout.write(HELP);
		return 0;
	}
	if (values.version) {
		console.log(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
		return 0;
	}
	if (positionals.length > 1) throw new UsageError(`unexpected argument: ${positionals[1]}`);
	const command = positionals[0] ?? "start";
	const port = parsePort(values.port);
	const url = `http://127.0.0.1:${port}`;
	const webRoot = join(root, "dist");
	const busy = `port ${port} is in use by something else`;

	switch (command) {
		case "serve":
			serve(port, webRoot);
			return 0;

		case "start": {
			const found = await probe(port);
			const next = plan(found, loadSite(webRoot).build);
			if (next === "refuse") throw new Error(`${busy}. Free it, or pass --port.`);
			if (next === "restart" && found.state === "running") await stop(port, found.identity);
			if (next !== "open") {
				const self = fileURLToPath(import.meta.url);
				const logFile = join(tmpdir(), `lockin-${port}.log`);
				await start(port, [process.execPath, self, "serve", "--port", String(port)], logFile);
			}
			const opened = values["no-open"] ? true : await openBrowser(url);
			console.log(`${next === "open" ? "running" : `${next}ed`} · ${url}`);
			if (!opened) console.log("could not open a browser: open that address yourself");
			return 0;
		}

		case "stop": {
			const found = await probe(port);
			if (found.state === "foreign") throw new Error(busy);
			if (found.state === "running") await stop(port, found.identity);
			console.log(found.state === "running" ? "stopped" : "not running");
			return 0;
		}

		case "status": {
			const found = await probe(port);
			if (found.state === "foreign") throw new Error(busy);
			console.log(found.state === "running" ? `running · ${url}` : "not running");
			return found.state === "running" ? 0 : 1;
		}

		default:
			throw new UsageError(`unknown command: ${command}`);
	}
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	// parseArgs reports bad flags with a `code`; those are usage errors too.
	const usage =
		error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
	console.error(`study: ${error instanceof Error ? error.message : String(error)}`);
	if (usage) process.stderr.write(`\n${HELP}`);
	process.exitCode = usage ? 2 : 1;
}
