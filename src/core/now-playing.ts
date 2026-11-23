/** What the Spotify bridge reports. Shared by the server and the page. */
export interface Track {
	readonly id: string;
	readonly name: string;
	readonly artist: string;
	readonly album: string;
	readonly durationMs: number;
	readonly positionMs: number;
}

export type NowPlaying =
	/** The bridge cannot talk to Spotify on this machine (not macOS, or no bridge at all). */
	| { readonly state: "unsupported" }
	/** The Spotify app is not running. */
	| { readonly state: "closed" }
	/** Spotify is open with nothing loaded. */
	| { readonly state: "stopped" }
	| { readonly state: "playing" | "paused"; readonly track: Track };

/** Where the local bridge is mounted, and the header its commands must carry. */
export const BRIDGE_PATH = "/api/spotify";
export const BRIDGE_HEADER = "x-lockin-bridge";

export const COMMANDS = ["playpause", "next", "previous"] as const;
export type Command = (typeof COMMANDS)[number];

const isText = (value: unknown): value is string => typeof value === "string";
const isSpan = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Validates a report from untrusted JSON, or null if it is not one. */
export function parseNowPlaying(value: unknown): NowPlaying | null {
	if (typeof value !== "object" || value === null) return null;
	const { state, track } = value as Record<string, unknown>;
	if (state === "unsupported" || state === "closed" || state === "stopped") return { state };
	if (state !== "playing" && state !== "paused") return null;
	if (typeof track !== "object" || track === null) return null;
	const { id, name, artist, album, durationMs, positionMs } = track as Record<string, unknown>;
	if (!isText(id) || !isText(name) || !isText(artist) || !isText(album)) return null;
	if (!isSpan(durationMs) || !isSpan(positionMs)) return null;
	return { state, track: { id, name, artist, album, durationMs, positionMs } };
}
