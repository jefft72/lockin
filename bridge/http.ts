import type { IncomingMessage, ServerResponse } from "node:http";
import { BRIDGE_HEADER, BRIDGE_PATH, COMMANDS, type Command } from "../src/core/now-playing.ts";
import type { SpotifyBridge } from "./spotify.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostname(host: string | undefined): string | null {
	if (!host) return null;
	try {
		return new URL(`http://${host}`).hostname;
	} catch {
		return null;
	}
}

/**
 * The bridge can pause someone's music, so it only answers the page it was
 * served with:
 *  - the Host must be loopback, which defeats DNS rebinding;
 *  - commands must come from that same origin and carry a custom header that
 *    a cross-site form or image request cannot set, which defeats requests
 *    from any other page in the browser.
 */
function refusal(request: IncomingMessage, isCommand: boolean): number | null {
	const host = request.headers.host;
	const name = hostname(host);
	if (name === null || !LOOPBACK_HOSTS.has(name)) return 403;
	if (!isCommand) return null;
	if (request.headers[BRIDGE_HEADER] !== "1") return 403;
	const origin = request.headers.origin;
	if (origin !== `http://${host}`) return 403;
	return null;
}

function send(response: ServerResponse, status: number, body?: unknown): void {
	response.statusCode = status;
	response.setHeader("Cache-Control", "no-store");
	if (body === undefined) {
		response.end();
		return;
	}
	response.setHeader("Content-Type", "application/json");
	response.end(JSON.stringify(body));
}

type Next = () => void;

const isCommandName = (action: string): action is Command => COMMANDS.includes(action as Command);

/** Connect-style middleware serving the bridge under `BRIDGE_PATH`. */
export function bridgeMiddleware(bridge: SpotifyBridge) {
	return (request: IncomingMessage, response: ServerResponse, next: Next): void => {
		const path = (request.url ?? "").split("?")[0] ?? "";
		if (path !== BRIDGE_PATH && !path.startsWith(`${BRIDGE_PATH}/`)) {
			next();
			return;
		}

		// "" reads what is playing; anything else must be a known command.
		const action = path.slice(BRIDGE_PATH.length + 1);
		const command = isCommandName(action) ? action : null;
		const status =
			action !== "" && command === null
				? 404
				: request.method !== (command ? "POST" : "GET")
					? 405
					: refusal(request, command !== null);
		if (status !== null) {
			send(response, status);
			return;
		}

		const work = command
			? bridge.send(command).then(() => bridge.nowPlaying())
			: bridge.nowPlaying();
		work.then(
			(nowPlaying) => send(response, 200, nowPlaying),
			() => send(response, 500),
		);
	};
}
