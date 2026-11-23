import { defineConfig } from "vitest/config";
import { spotifyBridgePlugin } from "./bridge/vite-plugin.ts";

// This is the development server only. The built app is served by `study`
// (see cli/), on its own port so the two never share a bank.
export default defineConfig({
	server: { host: "127.0.0.1", port: 2526, strictPort: true },
	build: { target: "es2023" },
	plugins: [spotifyBridgePlugin()],
	test: {
		include: ["src/**/*.test.ts", "bridge/**/*.test.ts", "cli/**/*.test.ts"],
		environment: "node",
	},
});
