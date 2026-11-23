import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spotifyBridge } from "../bridge/spotify.ts";
import { createAppServer, IDENTITY_PATH, loadSite, parseIdentity } from "./server.ts";

let webRoot: string;
let server: Server | undefined;

beforeEach(() => {
	webRoot = mkdtempSync(join(tmpdir(), "lockin-site-"));
	mkdirSync(join(webRoot, "assets"));
	writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>lockin</title>");
	writeFileSync(join(webRoot, "assets", "app-abc123.js"), "console.log(1)");
	// A secret sitting right next to the web root.
	writeFileSync(`${webRoot}.secret`, "do not serve");
});

afterEach(async () => {
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
	server = undefined;
	rmSync(webRoot, { recursive: true, force: true });
	rmSync(`${webRoot}.secret`, { force: true });
});

async function serve(): Promise<string> {
	const bridge = spotifyBridge(async () => JSON.stringify({ state: "closed" }), "darwin", 0);
	server = createAppServer(loadSite(webRoot), bridge);
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A request with its path and headers sent exactly as written, which fetch will not do. */
function raw(origin: string, path: string, headers: Record<string, string> = {}) {
	return new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
		request(origin, { path, headers }, (response) => {
			let body = "";
			response.on("data", (chunk) => {
				body += chunk;
			});
			response.on("end", () => resolve({ status: response.statusCode, body }));
		})
			.on("error", reject)
			.end();
	});
}

describe("loadSite", () => {
	it("refuses a directory with no built app in it", () => {
		rmSync(join(webRoot, "index.html"));
		expect(() => loadSite(webRoot)).toThrow(/no built app/);
	});

	it("fingerprints the build by its contents", () => {
		const before = loadSite(webRoot).build;
		expect(loadSite(webRoot).build).toBe(before);
		writeFileSync(join(webRoot, "assets", "app-abc123.js"), "console.log(2)");
		expect(loadSite(webRoot).build).not.toBe(before);
	});
});

describe("createAppServer", () => {
	it("serves the page, revalidated on every load", async () => {
		const origin = await serve();
		const response = await fetch(`${origin}/`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await response.text()).toContain("<title>lockin</title>");
	});

	it("serves hashed assets as immutable", async () => {
		const origin = await serve();
		const response = await fetch(`${origin}/assets/app-abc123.js?v=1`);
		expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
		expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		expect(await response.text()).toBe("console.log(1)");
	});

	it("answers HEAD with headers and no body", async () => {
		const origin = await serve();
		const response = await fetch(`${origin}/`, { method: "HEAD" });
		expect(response.status).toBe(200);
		expect(response.headers.get("content-length")).toBe("36");
		expect(await response.text()).toBe("");
	});

	it("serves nothing from outside the built app", async () => {
		const origin = await serve();
		const outside = webRoot.split("/").at(-1);
		for (const path of [
			`/../${outside}.secret`,
			`/%2e%2e/${outside}.secret`,
			`/assets/../../${outside}.secret`,
			"/..%2f..%2f..%2fetc%2fpasswd",
			"/%00",
			"/%",
			"/missing.js",
		]) {
			const response = await raw(origin, path);
			expect(response.status, path).toBe(404);
			expect(response.body).toBe("not found\n");
		}
	});

	it("rejects anything but GET and HEAD", async () => {
		const origin = await serve();
		const response = await fetch(`${origin}/`, { method: "POST" });
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET, HEAD");
	});

	it("identifies itself, but only to this machine", async () => {
		const origin = await serve();
		const identity = parseIdentity(await (await fetch(origin + IDENTITY_PATH)).json());
		expect(identity).toEqual({ name: "lockin", build: loadSite(webRoot).build, pid: process.pid });
		expect((await raw(origin, IDENTITY_PATH, { Host: "evil.example" })).status).toBe(404);
	});

	it("mounts the Spotify bridge", async () => {
		const origin = await serve();
		expect(await (await fetch(`${origin}/api/spotify`)).json()).toEqual({ state: "closed" });
	});
});

describe("parseIdentity", () => {
	it("rejects anything that is not this app", () => {
		for (const value of [
			null,
			"lockin",
			{},
			{ name: "other", build: "x", pid: 1 },
			{ name: "lockin" },
		]) {
			expect(parseIdentity(value)).toBeNull();
		}
		expect(parseIdentity({ name: "lockin", build: "x", pid: 0 })).toBeNull();
	});
});
