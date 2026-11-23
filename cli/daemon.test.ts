import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { plan, probe } from "./daemon.ts";
import { IDENTITY_PATH, type Identity } from "./server.ts";

const identity: Identity = { name: "lockin", build: "abc", pid: 4242 };

describe("plan", () => {
	it("starts when the port is free", () => {
		expect(plan({ state: "free" }, "abc")).toBe("start");
	});

	it("just opens when this version is already running", () => {
		expect(plan({ state: "running", identity }, "abc")).toBe("open");
	});

	it("replaces a server from another version", () => {
		expect(plan({ state: "running", identity }, "def")).toBe("restart");
	});

	it("refuses to touch a port something else is using", () => {
		expect(plan({ state: "foreign" }, "abc")).toBe("refuse");
	});
});

describe("probe", () => {
	let server: Server | undefined;

	afterEach(async () => {
		await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
		server = undefined;
	});

	async function listen(body: string, status = 200): Promise<number> {
		server = createServer((request, response) => {
			response.statusCode = request.url === IDENTITY_PATH ? status : 404;
			response.end(body);
		});
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		return (server.address() as AddressInfo).port;
	}

	it("recognises this app", async () => {
		expect(await probe(await listen(JSON.stringify(identity)))).toEqual({
			state: "running",
			identity,
		});
	});

	it("calls anything else on the port foreign", async () => {
		for (const [body, status] of [
			["<html>some other dev server</html>", 200],
			[JSON.stringify({ name: "someone-else" }), 200],
			[JSON.stringify(identity), 500],
		] as const) {
			expect(await probe(await listen(body, status))).toEqual({ state: "foreign" });
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
	});

	it("sees a closed port as free", async () => {
		const port = await listen("");
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		expect(await probe(port)).toEqual({ state: "free" });
	});
});
