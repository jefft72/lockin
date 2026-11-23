import {
	BRIDGE_HEADER,
	BRIDGE_PATH,
	type Command,
	type NowPlaying,
	parseNowPlaying,
} from "../core/now-playing.ts";

const POLL_MS = 3000;
/** How soon to look again after a command, once Spotify has caught up with it. */
const SETTLE_MS = 600;

export interface NowPlayingClient {
	send(command: Command): void;
}

/**
 * Polls the local bridge and reports each sample with the time it was taken.
 * Stops for good if there is no bridge (the page is hosted somewhere static),
 * and rests while the tab is hidden.
 */
export function watchNowPlaying(
	listener: (nowPlaying: NowPlaying, sampledAt: number) => void,
): NowPlayingClient {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let gone = false;

	const report = async (response: Response): Promise<void> => {
		if (response.status === 404) {
			gone = true;
			listener({ state: "unsupported" }, Date.now());
			return;
		}
		const nowPlaying = response.ok ? parseNowPlaying(await response.json()) : null;
		listener(nowPlaying ?? { state: "unsupported" }, Date.now());
	};

	const schedule = (delayMs: number): void => {
		clearTimeout(timer);
		if (gone || document.hidden) return;
		timer = setTimeout(poll, delayMs);
	};

	const poll = async (): Promise<void> => {
		try {
			await report(await fetch(BRIDGE_PATH, { cache: "no-store" }));
		} catch {
			// The server is down or mid-restart. Show nothing and keep trying.
			listener({ state: "unsupported" }, Date.now());
		}
		schedule(POLL_MS);
	};

	document.addEventListener("visibilitychange", () => schedule(0));
	schedule(0);

	return {
		send(command) {
			if (gone) return;
			fetch(`${BRIDGE_PATH}/${command}`, { method: "POST", headers: { [BRIDGE_HEADER]: "1" } })
				.then(report)
				.catch(() => {})
				.finally(() => schedule(SETTLE_MS));
		},
	};
}
