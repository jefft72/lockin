import { readFile } from "node:fs/promises";
import {
	advance,
	bankSession,
	clearBoard,
	elapse,
	expect,
	expectClock,
	ledgerOf,
	MINUTE,
	START,
	test,
} from "./app.ts";

test("starts empty and verified", async ({ app }) => {
	await expect(app.locator(".bank .total")).toHaveAttribute("aria-label", "0m");
	await expect(app.locator(".list")).toHaveText("nothing banked yet");
	await expect(app.locator(".audit")).toHaveText("ledger verified · 0 entries");
});

test("a finished session lands on today's stack", async ({ app }) => {
	await bankSession(app, 25);
	await expect(app.locator(".bank .total")).toHaveAttribute("aria-label", "25m");
	await expect(app.locator(".bank header")).toContainText("today 25m · 1 session");
	await expect(app.locator(".bank header")).toContainText("streak 1 day");
	await expect(app.locator(".day").last().locator(".stack i")).toHaveCount(1);
	await expect(app.locator(".session")).toContainText("#1");
	await expect(app.locator(".session")).toContainText("25m");
	await expect(app.locator(".audit")).toHaveText("ledger verified · 1 entry");
	await expect(app.locator(".status")).toHaveText("banked 25m");
});

test("sessions stack up across days and keep a streak", async ({ app }) => {
	await bankSession(app, 25);
	await clearBoard(app);
	await bankSession(app, 45);
	await clearBoard(app);
	await advance(app, 24 * 60 * MINUTE);
	await bankSession(app, 60);
	await clearBoard(app);

	const days = app.locator(".day");
	await expect(days).toHaveCount(7);
	await expect(days.nth(5).locator(".stack i")).toHaveCount(2);
	await expect(days.nth(6).locator(".stack i")).toHaveCount(1);
	await expect(app.locator(".bank .total")).toHaveAttribute("aria-label", "2h 10m");
	await expect(app.locator(".bank header")).toContainText("today 1h 00m · 1 session");
	await expect(app.locator(".bank header")).toContainText("streak 2 days");
	await expect(app.locator(".audit")).toHaveText("ledger verified · 3 entries");
});

test("the bank turns over at midnight without a reload", async ({ app }) => {
	await bankSession(app, 25);
	await clearBoard(app);
	await expect(app.locator(".bank header")).toContainText("today 25m");
	await advance(app, 16 * 60 * MINUTE);
	await expect(app.locator(".bank header")).toContainText("today 0m · 0 sessions");
	await expect(app.locator(".day").nth(5).locator(".stack i")).toHaveCount(1);
});

test.describe("rewards", () => {
	test("the first deposit puts a reward on the board", async ({ app }) => {
		await bankSession(app, 25);
		const board = app.locator(".board");
		// It waits for the block to land first.
		await expect(board).toBeHidden();
		await elapse(app, 1500);
		await expect(board).toBeVisible();
		await expect(board).toHaveAttribute("aria-label", "reward: FIRST DEPOSIT");
		// The board spells itself out, holds, and clears on its own.
		await elapse(app, 10_000);
		await expect(board).toBeHidden();
	});

	test("a key dismisses the board and does nothing else", async ({ app }) => {
		await bankSession(app, 25);
		await elapse(app, 1500);
		await expect(app.locator(".board")).toBeVisible();
		await app.keyboard.press("Space");
		await expect(app.locator(".board")).toBeHidden();
		await expect(app.getByRole("button", { name: "start" })).toBeVisible();
		await expectClock(app, "05:00");
	});

	test("the rewards tab tracks what is earned and how far the rest is", async ({ app }) => {
		await app.getByRole("button", { name: "rewards" }).click();
		await expect(app.locator(".list")).toContainText("0 of 27 earned");
		await bankSession(app, 60);
		await clearBoard(app);
		const list = app.locator(".list");
		await expect(list).toContainText("3 of 27 earned");
		await expect(list.locator(".earned")).toHaveText([
			"first deposit",
			"1 hour banked",
			"deep work",
		]);
		await expect(list.locator("li", { hasText: "bank 5 hours in total" })).toContainText("20%");
	});
});

test.describe("the ledger", () => {
	test("is a hash chain", async ({ app }) => {
		await bankSession(app, 25);
		await clearBoard(app);
		await bankSession(app, 25);
		const [first, second] = await ledgerOf(app);
		expect(first).toMatchObject({ seq: 1, prev: "0".repeat(64) });
		expect(second).toMatchObject({ seq: 2, prev: first?.hash });
		expect(second?.hash).toMatch(/^[0-9a-f]{64}$/);
	});

	test("notices when a session has been padded", async ({ app }) => {
		await bankSession(app, 25);
		await clearBoard(app);
		await bankSession(app, 25);
		await app.evaluate(() => {
			const ledger = JSON.parse(localStorage.getItem("lockin.ledger.v1") ?? "[]");
			ledger[1].focusMs = 3 * 60 * 60 * 1000;
			localStorage.setItem("lockin.ledger.v1", JSON.stringify(ledger));
		});
		await app.reload();
		await expect(app.locator(".audit")).toHaveText("ledger broken at #2");
	});

	test("sets unreadable data aside instead of overwriting it", async ({ app }) => {
		await app.evaluate(() => localStorage.setItem("lockin.ledger.v1", "{ not a ledger"));
		await app.reload();
		await expect(app.locator(".audit")).toHaveText("ledger verified · 0 entries");
		const parked = await app.evaluate(() =>
			Object.entries(localStorage).filter(([key]) =>
				key.startsWith("lockin.ledger.v1.unreadable."),
			),
		);
		expect(parked.map(([, value]) => value)).toEqual(["{ not a ledger"]);
	});

	test("exports, and imports back into an empty bank", async ({ app }) => {
		await bankSession(app, 25);
		await clearBoard(app);
		await bankSession(app, 45);
		await clearBoard(app);

		const downloading = app.waitForEvent("download");
		await app.getByRole("button", { name: "export" }).click();
		const download = await downloading;
		expect(download.suggestedFilename()).toBe("lockin-ledger-2026-11-22.json");
		const file = await download.path();
		expect(JSON.parse(await readFile(file, "utf8"))).toEqual(await ledgerOf(app));

		await app.evaluate(() => localStorage.removeItem("lockin.ledger.v1"));
		await app.reload();
		await expect(app.locator(".audit")).toHaveText("ledger verified · 0 entries");

		await app.locator('.bank input[type="file"]').setInputFiles(file);
		await expect(app.locator(".notice")).toHaveText("imported 2 entries");
		await expect(app.locator(".audit")).toHaveText("ledger verified · 2 entries");
		await expect(app.locator(".bank .total")).toHaveAttribute("aria-label", "1h 10m");
	});

	test("refuses to import a tampered or foreign file", async ({ app }) => {
		await bankSession(app, 25);
		const [entry] = await ledgerOf(app);
		const picker = app.locator('.bank input[type="file"]');
		const asFile = (name: string, value: unknown) => ({
			name,
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(value)),
		});

		await picker.setInputFiles(asFile("padded.json", [{ ...entry, focusMs: 180 * MINUTE }]));
		await expect(app.locator(".notice")).toHaveText("import refused: chain broken at #1");

		await picker.setInputFiles(asFile("other.json", { hello: "world" }));
		await expect(app.locator(".notice")).toHaveText("import refused: not a ledger file");
		expect(await ledgerOf(app)).toEqual([entry]);
	});

	test("asks before an import would throw sessions away", async ({ app }) => {
		await bankSession(app, 25);
		await clearBoard(app);
		const downloading = app.waitForEvent("download");
		await app.getByRole("button", { name: "export" }).click();
		const file = await (await downloading).path();
		await bankSession(app, 45);
		await clearBoard(app);

		// The file holds one session, the bank two: importing would lose one.
		const picker = app.locator('.bank input[type="file"]');
		app.once("dialog", (dialog) => dialog.dismiss());
		await picker.setInputFiles(file);
		await expect(app.locator(".audit")).toHaveText("ledger verified · 2 entries");
		expect(await ledgerOf(app)).toHaveLength(2);

		app.once("dialog", (dialog) => dialog.accept());
		await picker.setInputFiles(file);
		await expect(app.locator(".audit")).toHaveText("ledger verified · 1 entry");
	});
});

test("two tabs share one timer and bank a session exactly once", async ({ app, context }) => {
	const other = await context.newPage();
	await other.route("**/api/spotify**", (route) =>
		route.fulfill({ json: { state: "unsupported" } }),
	);
	await other.goto("/");
	await expectClock(other, "25:00");

	await app.keyboard.press("Space");
	await expect(other.getByRole("button", { name: "pause" })).toBeVisible();
	await context.clock.fastForward(10 * MINUTE);
	await expectClock(other, "15:00");

	await context.clock.fastForward(15 * MINUTE);
	for (const tab of [app, other]) {
		await expect(tab.locator(".audit")).toHaveText("ledger verified · 1 entry");
		await expect(tab.getByRole("button", { name: "break", exact: true })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	}
	expect(await ledgerOf(app)).toHaveLength(1);
	expect((await ledgerOf(app))[0]).toMatchObject({
		startedAt: START.getTime(),
		focusMs: 25 * MINUTE,
	});
});
