import type { Plugin } from "vite";
import { bridgeMiddleware } from "./http.ts";
import { spotifyBridge } from "./spotify.ts";

/** Mounts the Spotify bridge on the dev server. */
export function spotifyBridgePlugin(): Plugin {
	const middleware = bridgeMiddleware(spotifyBridge());
	return {
		name: "lockin:spotify-bridge",
		configureServer(server) {
			server.middlewares.use(middleware);
		},
	};
}
