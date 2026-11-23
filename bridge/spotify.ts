import { execFile } from "node:child_process";
import { type Command, type NowPlaying, parseNowPlaying } from "../src/core/now-playing.ts";

/**
 * Talks to the Spotify desktop app through macOS scripting. No API keys, no
 * OAuth, no Premium: if Spotify is open on this Mac, this can see it.
 *
 * The scripts are JavaScript for Automation rather than AppleScript because
 * JXA can ask whether an app is running without launching it, and returns
 * JSON, which survives any track title.
 */

/** Runs a JXA script and resolves with what it printed. */
export type ScriptRunner = (script: string) => Promise<string>;

const SCRIPT_TIMEOUT_MS = 4000;

export const osascript: ScriptRunner = (script) =>
	new Promise((resolve, reject) => {
		execFile(
			"osascript",
			["-l", "JavaScript", "-e", script],
			{ timeout: SCRIPT_TIMEOUT_MS },
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
	});

const READ = `(() => {
	const app = Application("Spotify");
	if (!app.running()) return JSON.stringify({ state: "closed" });
	const state = app.playerState();
	if (state !== "playing" && state !== "paused") return JSON.stringify({ state: "stopped" });
	const track = app.currentTrack;
	return JSON.stringify({
		state,
		track: {
			id: track.id(),
			name: track.name(),
			artist: track.artist(),
			album: track.album(),
			durationMs: track.duration(),
			positionMs: Math.round(app.playerPosition() * 1000),
		},
	});
})()`;

const ACTIONS: Record<Command, string> = {
	playpause: "playpause",
	next: "nextTrack",
	previous: "previousTrack",
};

// Never launches Spotify: a command sent while it is closed does nothing.
const command = (action: string) => `(() => {
	const app = Application("Spotify");
	if (app.running()) app.${action}();
})()`;

export interface SpotifyBridge {
	nowPlaying(): Promise<NowPlaying>;
	send(command: Command): Promise<void>;
}

export function spotifyBridge(
	run: ScriptRunner = osascript,
	platform: string = process.platform,
	cacheMs = 1000,
): SpotifyBridge {
	const supported = platform === "darwin";
	let cached: { at: number; value: Promise<NowPlaying> } | undefined;

	const read = async (): Promise<NowPlaying> => {
		try {
			return parseNowPlaying(JSON.parse(await run(READ))) ?? { state: "stopped" };
		} catch {
			// Spotify is mid-launch, has no track loaded, or automation was
			// denied. Nothing is playing as far as anyone can tell.
			return { state: "stopped" };
		}
	};

	return {
		nowPlaying() {
			if (!supported) return Promise.resolve({ state: "unsupported" });
			// Several tabs poll at once: let them share one trip to Spotify.
			const now = Date.now();
			if (!cached || now - cached.at >= cacheMs) cached = { at: now, value: read() };
			return cached.value;
		},
		async send(name) {
			if (!supported) return;
			cached = undefined;
			await run(command(ACTIONS[name])).catch(() => {});
			cached = undefined;
		},
	};
}
