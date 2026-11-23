import { defineConfig } from "vitest/config";

// The app is only ever served on loopback: the Spotify bridge drives a local
// app, and a fixed port keeps localStorage (the bank) on one stable origin.
export default defineConfig({
	server: { host: "127.0.0.1", port: 2526, strictPort: true },
	preview: { host: "127.0.0.1", port: 2525, strictPort: true },
	build: { target: "es2023" },
	test: {
		include: ["src/**/*.test.ts", "bridge/**/*.test.ts"],
		environment: "node",
	},
});
