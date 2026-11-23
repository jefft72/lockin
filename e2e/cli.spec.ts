import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// The compiled command, exactly as `npm install -g` would link it.
const CLI = fileURLToPath(new URL("../build/cli/study.js", import.meta.url));

interface Result {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

/** Runs `study` from a directory that has nothing to do with the project. */
function study(port: number, ...args: string[]): Promise<Result> {
	return new Promise((resolve) => {
		execFile(
			process.execPath,
			[CLI, ...args, "--port", String(port)],
			{ cwd: tmpdir(), env: { ...process.env, ...browser } },
			(error, stdout, stderr) => {
				resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
			},
		);
	});
}

/** Each test gets a port of its own, so they can run side by side. */
async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return port;
}

/**
 * Fetches over a connection of its own. These tests stop the server they just
 * talked to, and a pooled connection to a dead server is not safe to reuse.
 */
function read(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		get(url, { agent: false }, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => {
				body += chunk;
			});
			response.on("end", () => resolve(body));
		}).on("error", reject);
	});
}

const identityOf = async (port: number) =>
	JSON.parse(await read(`http://127.0.0.1:${port}/api/lockin`));

let port: number;
/** Environment that swaps the real browser for one that only records what it was asked to open. */
let browser: { BROWSER: string };
let opened: string;

test.beforeEach(async () => {
	port = await freePort();
	opened = test.info().outputPath("opened");
	const fake = test.info().outputPath("browser.sh");
	await writeFile(fake, `#!/bin/sh\necho "$1" >> "${opened}"\n`, { mode: 0o755 });
	browser = { BROWSER: fake };
});

test.afterEach(async () => {
	await study(port, "stop");
});

test("opens the browser every time, whether or not the server was already running", async () => {
	const url = `http://127.0.0.1:${port}`;
	expect(await study(port)).toEqual({ code: 0, stdout: `started · ${url}\n`, stderr: "" });
	expect(await study(port)).toEqual({ code: 0, stdout: `running · ${url}\n`, stderr: "" });
	await expect.poll(() => readFile(opened, "utf8").catch(() => "")).toBe(`${url}\n${url}\n`);
});

test("says so when no browser could be opened, and still starts", async () => {
	browser = { BROWSER: "/nonexistent/browser" };
	const url = `http://127.0.0.1:${port}`;
	expect(await study(port)).toEqual({
		code: 0,
		stdout: `started · ${url}\ncould not open a browser: open that address yourself\n`,
		stderr: "",
	});
	expect(await read(url)).toContain("<title>lockin</title>");
});

test("starts in the background from any directory, only once, and stops", async () => {
	const url = `http://127.0.0.1:${port}`;
	expect(await study(port, "status")).toMatchObject({ code: 1, stdout: "not running\n" });

	expect(await study(port, "--no-open")).toMatchObject({ code: 0, stdout: `started · ${url}\n` });
	expect(await read(url)).toContain("<title>lockin</title>");
	expect(JSON.parse(await read(`${url}/api/spotify`))).toHaveProperty("state");
	expect(await study(port, "status")).toMatchObject({ code: 0, stdout: `running · ${url}\n` });

	// Asking again finds the same server rather than starting a second one.
	const first = await identityOf(port);
	expect(await study(port, "--no-open")).toMatchObject({ code: 0, stdout: `running · ${url}\n` });
	expect(await identityOf(port)).toEqual(first);

	expect(await study(port, "stop")).toMatchObject({ code: 0, stdout: "stopped\n" });
	await expect(read(url)).rejects.toThrow("ECONNREFUSED");
	expect(await study(port, "stop")).toMatchObject({ code: 0, stdout: "not running\n" });
});

test("replaces a server left running by an older version", async () => {
	const older = spawn(
		process.execPath,
		[
			"-e",
			`require("node:http")
				.createServer((_, response) =>
					response.end(JSON.stringify({ name: "lockin", build: "older", pid: process.pid })))
				.listen(${port}, "127.0.0.1", () => console.log("up"));`,
		],
		{ stdio: ["ignore", "pipe", "inherit"] },
	);
	await once(older.stdout, "data");
	const gone = once(older, "exit");

	const result = await study(port, "--no-open");
	expect(result).toEqual({ code: 0, stdout: `restarted · http://127.0.0.1:${port}\n`, stderr: "" });
	await gone;
	expect((await identityOf(port)).build).not.toBe("older");
});

test("leaves the port alone when something else is using it", async () => {
	const other = createServer((_, response) => response.end("someone else's dev server"));
	await new Promise<void>((resolve) => other.listen(port, "127.0.0.1", resolve));
	try {
		const result = await study(port, "--no-open");
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(`port ${port} is in use by something else`);
		expect((await study(port, "stop")).code).toBe(1);
		expect(await read(`http://127.0.0.1:${port}`)).toBe("someone else's dev server");
	} finally {
		await new Promise<void>((resolve) => other.close(() => resolve()));
	}
});
