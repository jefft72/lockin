import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, relative, sep } from "node:path";
import { bridgeMiddleware, isLoopbackHost } from "../bridge/http.ts";
import type { SpotifyBridge } from "../bridge/spotify.ts";

/** Where a running server says who it is, so `study` can tell it from a stranger on the port. */
export const IDENTITY_PATH = "/api/lockin";

export interface Identity {
	readonly name: "lockin";
	/** Fingerprint of the app being served. Changes whenever the app does. */
	readonly build: string;
	readonly pid: number;
}

export function parseIdentity(value: unknown): Identity | null {
	if (typeof value !== "object" || value === null) return null;
	const { name, build, pid } = value as Record<string, unknown>;
	if (name !== "lockin" || typeof build !== "string" || build === "") return null;
	if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null;
	return { name, build, pid };
}

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".map": "application/json",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};

interface SiteFile {
	readonly body: Buffer;
	readonly type: string;
	/** Named after its own content hash, so it can be cached forever. */
	readonly immutable: boolean;
}

export interface Site {
	readonly files: ReadonlyMap<string, SiteFile>;
	readonly build: string;
}

/**
 * Reads the whole built app into memory. It is a handful of small files, and
 * serving from a map means a request can never be talked into reading
 * anything else off the disk.
 */
export function loadSite(webRoot: string): Site {
	const paths = readdirSync(webRoot, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
	const files = new Map<string, SiteFile>();
	const fingerprint = createHash("sha256");
	for (const path of paths) {
		const urlPath = `/${relative(webRoot, path).split(sep).join("/")}`;
		const body = readFileSync(path);
		fingerprint.update(`${urlPath}\0${body.length}\0`).update(body);
		files.set(urlPath, {
			body,
			type: CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
			immutable: urlPath.startsWith("/assets/"),
		});
	}
	if (!files.has("/index.html")) throw new Error(`no built app in ${webRoot}`);
	return { files, build: fingerprint.digest("hex").slice(0, 16) };
}

function reply(
	request: IncomingMessage,
	response: ServerResponse,
	status: number,
	headers: Record<string, string>,
	body: Buffer | string = "",
): void {
	response.writeHead(status, {
		"Content-Length": Buffer.byteLength(body),
		"X-Content-Type-Options": "nosniff",
		...headers,
	});
	response.end(request.method === "HEAD" ? undefined : body);
}

function pathOf(request: IncomingMessage): string | null {
	try {
		return decodeURIComponent((request.url ?? "/").split(/[?#]/)[0] ?? "/");
	} catch {
		return null;
	}
}

/** The whole production server: the built app, the Spotify bridge, and an identity endpoint. */
export function createAppServer(site: Site, bridge: SpotifyBridge): Server {
	const spotify = bridgeMiddleware(bridge);
	const identity: Identity = { name: "lockin", build: site.build, pid: process.pid };

	const serveSite = (request: IncomingMessage, response: ServerResponse): void => {
		const text = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
		if (request.method !== "GET" && request.method !== "HEAD") {
			reply(request, response, 405, { ...text, Allow: "GET, HEAD" }, "method not allowed\n");
			return;
		}
		const path = pathOf(request);
		if (path === IDENTITY_PATH && isLoopbackHost(request.headers.host)) {
			const json = { "Content-Type": "application/json", "Cache-Control": "no-store" };
			reply(request, response, 200, json, JSON.stringify(identity));
			return;
		}
		const file = path === null ? undefined : site.files.get(path === "/" ? "/index.html" : path);
		if (!file) {
			reply(request, response, 404, text, "not found\n");
			return;
		}
		reply(
			request,
			response,
			200,
			{
				"Content-Type": file.type,
				// Hashed assets never change. The page itself is revalidated every
				// time, so a new version of the app shows up on the next load.
				"Cache-Control": file.immutable ? "public, max-age=31536000, immutable" : "no-cache",
			},
			file.body,
		);
	};

	return createServer((request, response) => {
		spotify(request, response, () => serveSite(request, response));
	});
}
