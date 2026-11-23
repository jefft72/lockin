import { defineConfig, devices } from "@playwright/test";

// Its own port, so a test run never collides with the app someone has open.
const PORT = 2599;
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: "e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: ORIGIN,
		locale: "en-US",
		timezoneId: "America/Los_Angeles",
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	// The tests run against the production build on the production server: the
	// same thing the `study` command starts.
	webServer: {
		command: `npm run build && node build/cli/study.js serve --port ${PORT}`,
		url: ORIGIN,
		reuseExistingServer: !process.env.CI,
	},
});
