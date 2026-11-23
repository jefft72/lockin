import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openBrowser, opener } from "./open.ts";

describe("opener", () => {
	it("uses each platform's own way of opening a URL", () => {
		expect(opener("darwin", {})).toEqual(["open"]);
		expect(opener("linux", {})).toEqual(["xdg-open"]);
		expect(opener("win32", {})).toEqual(["cmd", "/c", "start", ""]);
	});

	it("prefers the browser named in BROWSER", () => {
		expect(opener("darwin", { BROWSER: "/usr/bin/firefox" })).toEqual(["/usr/bin/firefox"]);
		expect(opener("darwin", { BROWSER: "" })).toEqual(["open"]);
	});
});

describe("openBrowser", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "lockin-open-"));
	});

	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("hands the URL to the opener and settles without waiting for it to exit", async () => {
		const seen = join(dir, "seen");
		// A stand-in browser that records its URL, then stays open for a while.
		const script = `require("node:fs").writeFileSync(${JSON.stringify(seen)}, process.argv[1]);
			setTimeout(() => {}, 5000);`;
		const before = Date.now();
		expect(await openBrowser("http://127.0.0.1:2525", [process.execPath, "-e", script])).toBe(true);
		expect(Date.now() - before).toBeLessThan(2000);
		await expect.poll(() => existsSync(seen)).toBe(true);
		expect(readFileSync(seen, "utf8")).toBe("http://127.0.0.1:2525");
	});

	it("reports an opener that does not exist", async () => {
		expect(await openBrowser("http://127.0.0.1:2525", [join(dir, "no-such-browser")])).toBe(false);
	});
});
