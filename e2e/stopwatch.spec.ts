import {
	advance,
	clearBoard,
	elapse,
	expect,
	expectClock,
	ledgerOf,
	MINUTE,
	START,
	test,
} from "./app.ts";

test.beforeEach(async ({ app }) => {
	await app.getByRole("button", { name: "stopwatch", exact: true }).click();
});

test("counts up from zero", async ({ app }) => {
	await expectClock(app, "00:00", "elapsed");
	await app.keyboard.press("Space");
	await advance(app, 1000);
	await expectClock(app, "00:01", "elapsed");
	await advance(app, 61 * MINUTE + 16_000);
	await expectClock(app, "61:17", "elapsed");
	await expect(app).toHaveTitle("61:17 stopwatch");
});

test("is one arrow key away from focus", async ({ app }) => {
	await app.keyboard.press("ArrowRight");
	await expectClock(app, "25:00");
	await app.keyboard.press("ArrowLeft");
	await expectClock(app, "00:00", "elapsed");
});

test("has no length to set", async ({ app }) => {
	await expect(app.getByRole("button", { name: "45 minutes" })).toBeHidden();
	await app.keyboard.press("ArrowUp");
	await app.keyboard.press("7");
	await app.getByRole("timer").hover();
	await app.mouse.wheel(0, -300);
	await expectClock(app, "00:00", "elapsed");
	// And none of that leaked into the countdown.
	await app.getByRole("button", { name: "focus", exact: true }).click();
	await expectClock(app, "25:00");
});

test("pauses and resumes without losing or gaining time", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 5 * MINUTE);
	await app.keyboard.press("Space");
	await advance(app, 30 * MINUTE);
	await expectClock(app, "05:00", "elapsed");
	await app.keyboard.press("Space");
	await advance(app, MINUTE);
	await expectClock(app, "06:00", "elapsed");
});

test("survives a reload and keeps the right time", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 10 * MINUTE);
	await app.reload();
	await expectClock(app, "10:00", "elapsed");
	await advance(app, 5 * MINUTE);
	await expectClock(app, "15:00", "elapsed");
});

test("marks 25, 50 and 90 minutes", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 24 * MINUTE);
	await expect(app.locator(".status")).toHaveText("");
	await advance(app, MINUTE);
	await expect(app.locator(".status")).toHaveText("25m in");
	await advance(app, 25 * MINUTE);
	await expect(app.locator(".status")).toHaveText("50m in");
	await advance(app, 40 * MINUTE);
	await expect(app.locator(".status")).toHaveText("1h 30m in");
});

test("banks the time on the clock and earns the same rewards", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 60 * MINUTE + 30_000);
	await app.getByRole("button", { name: "bank 1h 00m" }).click();
	await expect.poll(async () => (await ledgerOf(app)).length).toBe(1);
	expect((await ledgerOf(app))[0]).toMatchObject({
		startedAt: START.getTime(),
		endedAt: START.getTime() + 60 * MINUTE + 30_000,
		focusMs: 60 * MINUTE + 30_000,
		plannedMs: 0,
		kind: "stopwatch",
	});

	// It lands in the bank like any other session, and is ready to go again.
	await expect(app.locator(".status")).toHaveText("banked 1h 00m");
	await expect(app.locator(".bank header")).toContainText("today 1h 00m · 1 session");
	await expect(app.locator(".day").last().locator(".stack i")).toHaveCount(1);
	await expect(app.locator(".audit")).toHaveText("ledger verified · 1 entry");
	await expectClock(app, "00:00", "elapsed");
	await expect(app.getByRole("button", { name: "stopwatch", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await elapse(app, 1500);
	await expect(app.locator(".board")).toHaveAttribute("aria-label", "reward: FIRST DEPOSIT");
	await clearBoard(app);
	await app.getByRole("button", { name: "rewards" }).click();
	await expect(app.locator(".list .earned")).toHaveText([
		"first deposit",
		"1 hour banked",
		"deep work",
	]);
});

test("does not bank under a minute, and reset throws the time away", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 59_000);
	await expect(app.getByRole("button", { name: "bank" })).toBeDisabled();
	await app.keyboard.press("b");
	await advance(app, 20 * MINUTE);
	await app.keyboard.press("r");
	await expectClock(app, "00:00", "elapsed");
	await expect(app.getByRole("button", { name: "start" })).toBeVisible();
	expect(await ledgerOf(app)).toHaveLength(0);
});

test("banks itself at three hours if it is left running", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 14 * 60 * MINUTE);
	await expect.poll(async () => (await ledgerOf(app)).length).toBe(1);
	expect((await ledgerOf(app))[0]).toMatchObject({
		endedAt: START.getTime() + 180 * MINUTE,
		focusMs: 180 * MINUTE,
		kind: "stopwatch",
	});
	await expectClock(app, "00:00", "elapsed");
	await clearBoard(app);
	await app.getByRole("button", { name: "rewards" }).click();
	await expect(app.locator(".list .earned")).toContainText(["marathon", "the long haul"]);
});

test("leaves the pomodoro cycle where it was", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 30 * MINUTE);
	await app.keyboard.press("b");
	await expect.poll(async () => (await ledgerOf(app)).length).toBe(1);
	await clearBoard(app);

	// Three more focus runs would earn the long break if the stopwatch had counted as one.
	await app.getByRole("button", { name: "focus", exact: true }).click();
	for (const next of ["break", "break", "break"]) {
		await app.keyboard.press("Space");
		await advance(app, 25 * MINUTE);
		await expect(app.getByRole("button", { name: next, exact: true })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await clearBoard(app);
		await app.keyboard.press("Space");
		await advance(app, 5 * MINUTE);
	}
});
