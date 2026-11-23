import { advance, clearBoard, expect, expectClock, ledgerOf, MINUTE, START, test } from "./app.ts";

test("counts down from 25 minutes", async ({ app }) => {
	await expectClock(app, "25:00");
	await app.keyboard.press("Space");
	await advance(app, 1000);
	await expectClock(app, "24:59");
	await advance(app, 9 * MINUTE + 59_000);
	await expectClock(app, "15:00");
	await expect(app).toHaveTitle("15:00 focus");
});

test("keeps the visible and accessible countdown in sync", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 1000);
	await expectClock(app, "24:59");
	await expect(app.locator(".clock-value")).toHaveText("24:59");
});

test("pauses and resumes without losing or gaining time", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 5 * MINUTE);
	await app.keyboard.press("Space");
	await expect(app.getByRole("button", { name: "resume" })).toBeVisible();
	await advance(app, 30 * MINUTE);
	await expectClock(app, "20:00");
	await app.keyboard.press("Space");
	await advance(app, MINUTE);
	await expectClock(app, "19:00");
});

test.describe("setting the duration", () => {
	test("arrow keys step by one minute, or five with shift", async ({ app }) => {
		await app.keyboard.press("ArrowUp");
		await expectClock(app, "26:00");
		await app.keyboard.press("Shift+ArrowDown");
		await expectClock(app, "21:00");
	});

	test("typed digits become minutes", async ({ app }) => {
		await app.keyboard.press("4");
		await expectClock(app, "04:00");
		await app.keyboard.press("5");
		await expectClock(app, "45:00");
		// After a pause, typing starts a new number.
		await advance(app, 2000);
		await app.keyboard.press("9");
		await expectClock(app, "09:00");
	});

	test("presets, step buttons and the scroll wheel all set it", async ({ app }) => {
		await app.getByRole("button", { name: "90 minutes" }).click();
		await expectClock(app, "90:00");
		await app.getByRole("button", { name: "add 5 min" }).click();
		await expectClock(app, "95:00");
		await app.getByRole("button", { name: "remove 1 min" }).click();
		await expectClock(app, "94:00");
		await app.getByRole("timer").hover();
		await app.mouse.wheel(0, -100);
		await expectClock(app, "95:00");
	});

	test("stays between one minute and three hours", async ({ app }) => {
		await app.keyboard.press("0");
		await expectClock(app, "01:00");
		await advance(app, 2000);
		for (const key of ["9", "9", "9"]) await app.keyboard.press(key);
		await expectClock(app, "180:00");
	});

	test("is locked while a session runs", async ({ app }) => {
		await app.keyboard.press("Space");
		await app.keyboard.press("ArrowUp");
		await app.keyboard.press("7");
		await expectClock(app, "25:00");
		await expect(app.getByRole("button", { name: "45 minutes" })).toBeHidden();
		await expect(app.getByRole("button", { name: "break", exact: true })).toBeDisabled();
	});

	test("each phase remembers its own", async ({ app }) => {
		await app.keyboard.press("ArrowUp");
		await app.keyboard.press("ArrowRight");
		await expectClock(app, "05:00");
		await app.keyboard.press("ArrowDown");
		await app.keyboard.press("ArrowLeft");
		await expectClock(app, "26:00");
		await app.reload();
		await expectClock(app, "26:00");
		await app.getByRole("button", { name: "break", exact: true }).click();
		await expectClock(app, "04:00");
	});
});

test("space starts the timer even right after a mouse click", async ({ app }) => {
	await app.getByRole("button", { name: "45 minutes" }).click();
	await app.keyboard.press("Space");
	await expect(app.getByRole("button", { name: "pause" })).toBeVisible();
	await advance(app, MINUTE);
	await expectClock(app, "44:00");
});

test("holding a key down does not flicker the timer", async ({ app }) => {
	await app.keyboard.down("Space");
	for (let i = 0; i < 5; i++) await app.keyboard.down("Space");
	await app.keyboard.up("Space");
	await expect(app.getByRole("button", { name: "pause" })).toBeVisible();

	// Arrows are the exception: holding one keeps stepping.
	await app.keyboard.press("r");
	await app.keyboard.down("ArrowUp");
	for (let i = 0; i < 4; i++) await app.keyboard.down("ArrowUp");
	await app.keyboard.up("ArrowUp");
	await expectClock(app, "30:00");
});

test("a session survives a reload and keeps the right time", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 10 * MINUTE);
	await app.reload();
	await expectClock(app, "15:00");
	await advance(app, 5 * MINUTE);
	await expectClock(app, "10:00");
});

test("a session that ended while the page was closed is still banked", async ({ app, context }) => {
	await app.keyboard.press("Space");
	await advance(app, MINUTE);
	await app.close();

	const later = await context.newPage();
	await later.route("**/api/spotify**", (route) =>
		route.fulfill({ json: { state: "unsupported" } }),
	);
	await later.clock.fastForward(3 * 60 * MINUTE);
	await later.goto("/");
	await expect.poll(async () => (await ledgerOf(later)).length).toBe(1);
	const [entry] = await ledgerOf(later);
	// Banked for its real length, ending when it actually ended.
	expect(entry).toMatchObject({
		startedAt: START.getTime(),
		endedAt: START.getTime() + 25 * MINUTE,
		focusMs: 25 * MINUTE,
		kind: "full",
	});
});

test("finishing focus arms the break, and every fourth one the long break", async ({ app }) => {
	const phase = (name: string) => app.getByRole("button", { name, exact: true });
	for (const next of ["break", "break", "break", "long break"]) {
		await expect(phase("focus")).toHaveAttribute("aria-pressed", "true");
		await app.keyboard.press("Space");
		await advance(app, 25 * MINUTE);
		await expect(phase(next)).toHaveAttribute("aria-pressed", "true");
		await clearBoard(app);
		await app.keyboard.press("Space");
		await advance(app, 15 * MINUTE);
	}
	await expect(phase("focus")).toHaveAttribute("aria-pressed", "true");
	expect(await ledgerOf(app)).toHaveLength(4);
});

test("checkpoints mark each quarter of a session", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 7 * MINUTE);
	await expect(app.locator(".status")).toHaveText("checkpoint 1/3");
	const fills = () =>
		app
			.locator(".checkpoints i")
			.evaluateAll((segments) =>
				segments.map((segment) =>
					Number.parseFloat((segment as HTMLElement).style.getPropertyValue("--fill")),
				),
			);
	await expect.poll(fills).toEqual([1, 0.12, 0, 0]);
	await advance(app, 6 * MINUTE);
	await expect(app.locator(".status")).toHaveText("checkpoint 2/3");
	await expect.poll(fills).toEqual([1, 1, 0.08, 0]);
});

test("reset throws the session away", async ({ app }) => {
	await app.keyboard.press("Space");
	await advance(app, 20 * MINUTE);
	await app.keyboard.press("r");
	await expectClock(app, "25:00");
	await expect(app.getByRole("button", { name: "start" })).toBeVisible();
	expect(await ledgerOf(app)).toHaveLength(0);
});

test("banking early keeps the time put in", async ({ app }) => {
	await app.keyboard.press("Space");
	await expect(app.getByRole("button", { name: "bank" })).toBeDisabled();
	await advance(app, 12 * MINUTE + 30_000);
	await app.getByRole("button", { name: "bank 12m" }).click();
	await expect.poll(async () => (await ledgerOf(app)).length).toBe(1);
	expect((await ledgerOf(app))[0]).toMatchObject({
		focusMs: 12 * MINUTE + 30_000,
		kind: "partial",
	});
	await expect(app.locator(".session")).toContainText("12m*");
});
