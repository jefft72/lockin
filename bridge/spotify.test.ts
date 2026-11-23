import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BRIDGE_HEADER, BRIDGE_PATH, type NowPlaying } from "../src/core/now-playing.ts";
import { bridgeMiddleware } from "./http.ts";
import { type ScriptRunner, spotifyBridge } from "./spotify.ts";

const track = {
	id: "spotify:track:1",
	name: 'A "quoted"\ttitle',
	artist: "Someone",
	album: "Something",
	durationMs: 200_000,
	positionMs: 42_000,
};
const playing: NowPlaying = { state: "playing", track };

/** A stand-in for osascript that records what it was asked to run. */
function fakeSpotify(reply: () => string | Promise<string>) {
	const scripts: string[] = [];
	const run: ScriptRunner = async (script) => {
		scripts.push(script);
		return reply();
	};
	return { run, scripts };
}

describe("spotifyBridge", () => {
	it("reports what Spotify is playing", async () => {
		const { run } = fakeSpotify(() => JSON.stringify(playing));
		expect(await spotifyBridge(run, "darwin").nowPlaying()).toEqual(playing);
	});

	it("passes through closed and stopped", async () => {
		for (const state of ["closed", "stopped"] as const) {
			const { run } = fakeSpotify(() => JSON.stringify({ state }));
			expect(await spotifyBridge(run, "darwin").nowPlaying()).toEqual({ state });
		}
	});

	it("treats a failing or garbled script as nothing playing", async () => {
		const replies = [
			() => Promise.reject(new Error("automation denied")),
			() => "not json",
			() => JSON.stringify({ state: "playing" }),
		];
		for (const reply of replies) {
			const { run } = fakeSpotify(reply);
			expect(await spotifyBridge(run, "darwin").nowPlaying()).toEqual({ state: "stopped" });
		}
	});

	it("never runs a script off macOS", async () => {
		const { run, scripts } = fakeSpotify(() => JSON.stringify(playing));
		const bridge = spotifyBridge(run, "linux");
		expect(await bridge.nowPlaying()).toEqual({ state: "unsupported" });
		await bridge.send("next");
		expect(scripts).toEqual([]);
	});

	it("shares one read between polls that land together", async () => {
		const { run, scripts } = fakeSpotify(() => JSON.stringify(playing));
		const bridge = spotifyBridge(run, "darwin", 60_000);
		await Promise.all([bridge.nowPlaying(), bridge.nowPlaying(), bridge.nowPlaying()]);
		expect(scripts).toHaveLength(1);
	});

	it("reads fresh after a command", async () => {
		const { run, scripts } = fakeSpotify(() => JSON.stringify(playing));
		const bridge = spotifyBridge(run, "darwin", 60_000);
		await bridge.nowPlaying();
		await bridge.send("next");
		await bridge.nowPlaying();
		expect(scripts).toHaveLength(3);
		expect(scripts[1]).toContain("nextTrack()");
		// A command must never be the thing that launches Spotify.
		expect(scripts[1]).toContain("app.running()");
	});
});

describe("bridgeMiddleware", () => {
	let server: Server | undefined;

	afterEach(
		() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
	);

	async function serve() {
		const spotify = fakeSpotify(() => JSON.stringify(playing));
		const middleware = bridgeMiddleware(spotifyBridge(spotify.run, "darwin", 0));
		server = createServer((request, response) => {
			middleware(request, response, () => {
				response.statusCode = 404;
				response.end("not the bridge");
			});
		});
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const origin = `http://127.0.0.1:${port}`;
		return { origin, scripts: spotify.scripts };
	}

	const trusted = (origin: string) => ({ Origin: origin, [BRIDGE_HEADER]: "1" });

	it("serves now playing as JSON", async () => {
		const { origin } = await serve();
		const response = await fetch(origin + BRIDGE_PATH);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual(playing);
	});

	it("leaves every other path alone", async () => {
		const { origin } = await serve();
		expect(await (await fetch(`${origin}/api/spotifyish`)).text()).toBe("not the bridge");
	});

	it("runs a command from its own page and answers with the new state", async () => {
		const { origin, scripts } = await serve();
		const response = await fetch(`${origin}${BRIDGE_PATH}/playpause`, {
			method: "POST",
			headers: trusted(origin),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(playing);
		expect(scripts[0]).toContain("playpause()");
	});

	it("refuses commands from another site", async () => {
		const { origin, scripts } = await serve();
		const attempts: Record<string, string>[] = [
			{},
			{ Origin: origin },
			{ [BRIDGE_HEADER]: "1" },
			{ ...trusted(origin), Origin: "https://evil.example" },
		];
		for (const headers of attempts) {
			const response = await fetch(`${origin}${BRIDGE_PATH}/next`, { method: "POST", headers });
			expect(response.status).toBe(403);
		}
		expect(scripts).toEqual([]);
	});

	it("refuses a rebound hostname", async () => {
		const { origin, scripts } = await serve();
		// fetch will not let a caller set Host, so speak HTTP directly.
		const status = await new Promise<number | undefined>((resolve, reject) => {
			request(origin + BRIDGE_PATH, { headers: { Host: "evil.example" } }, (response) => {
				response.resume();
				resolve(response.statusCode);
			})
				.on("error", reject)
				.end();
		});
		expect(status).toBe(403);
		expect(scripts).toEqual([]);
	});

	it("rejects unknown commands and wrong methods", async () => {
		const { origin } = await serve();
		const post = (path: string) =>
			fetch(origin + path, { method: "POST", headers: trusted(origin) });
		expect((await post(`${BRIDGE_PATH}/shuffle`)).status).toBe(404);
		expect((await post(BRIDGE_PATH)).status).toBe(405);
		expect((await fetch(`${origin}${BRIDGE_PATH}/next`)).status).toBe(405);
	});
});
