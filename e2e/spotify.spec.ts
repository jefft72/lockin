import { BRIDGE_HEADER } from "../src/core/now-playing.ts";
import { advance, expect, test } from "./app.ts";

const track = {
	id: "spotify:track:1",
	name: "Midnight City",
	artist: "M83",
	album: "Hurry Up, We're Dreaming",
	durationMs: 240_000,
	positionMs: 60_000,
};

test("stays out of the way when there is no bridge", async ({ app }) => {
	await expect(app.locator(".now-playing")).toBeHidden();
});

test("says so when Spotify is closed", async ({ app }) => {
	await app.route("**/api/spotify**", (route) => route.fulfill({ json: { state: "closed" } }));
	await advance(app, 3000);
	await expect(app.locator(".song")).toHaveText("spotify closed");
	await expect(app.getByRole("button", { name: "next track" })).toBeHidden();
});

test("shows the track and moves its progress between polls", async ({ app }) => {
	await app.route("**/api/spotify**", (route) =>
		route.fulfill({ json: { state: "playing", track } }),
	);
	await advance(app, 3000);
	await expect(app.locator(".song")).toHaveText("spotify Midnight City M83");
	const fill = () =>
		app.locator(".song-progress i").evaluate((bar) => bar.style.getPropertyValue("--fill"));
	await expect.poll(fill).toBe("0.2500");
	// One second later, with no new sample yet, the line has moved on its own.
	await advance(app, 1000);
	await expect.poll(async () => Number(await fill())).toBeGreaterThan(0.25);
});

test("sends transport commands with the bridge header", async ({ app }) => {
	let state: "playing" | "paused" = "playing";
	const commands: string[] = [];
	await app.route("**/api/spotify**", async (route) => {
		const request = route.request();
		if (request.method() === "POST") {
			expect(await request.headerValue(BRIDGE_HEADER)).toBe("1");
			commands.push(new URL(request.url()).pathname);
			if (request.url().endsWith("/playpause")) state = state === "playing" ? "paused" : "playing";
		}
		await route.fulfill({ json: { state, track } });
	});
	await advance(app, 3000);

	const strip = app.locator(".now-playing");
	await strip.getByRole("button", { name: "pause" }).click();
	await expect(strip).toHaveAttribute("data-state", "paused");
	await expect(strip.getByRole("button", { name: "play", exact: true })).toBeVisible();
	await strip.getByRole("button", { name: "next track" }).click();
	await strip.getByRole("button", { name: "previous track" }).click();
	await expect
		.poll(() => commands)
		.toEqual(["/api/spotify/playpause", "/api/spotify/next", "/api/spotify/previous"]);

	// The music controls never touch the timer.
	await expect(app.getByRole("button", { name: "start" })).toBeVisible();
});
