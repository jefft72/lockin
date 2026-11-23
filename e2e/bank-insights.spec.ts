import { advance, bankSession, clearBoard, expect, expectClock, MINUTE, test } from "./app.ts";

test("focus signal updates from deposits and arrow navigation leaves the timer alone", async ({
	app,
}) => {
	const signal = app.getByRole("region", { name: "28-day focus activity" });
	const days = signal.getByRole("button");
	const today = days.last();
	await expect(days).toHaveCount(28);
	await expect(today).toHaveAttribute("aria-current", "date");
	await expect(today).toHaveAttribute("data-level", "0");
	await expect(today).toHaveAccessibleName(/Sun, Nov 22 · 0m · 0 sessions/);

	await bankSession(app, 25);
	await clearBoard(app);
	await expect(today).toHaveAccessibleName(/Sun, Nov 22 · 25m · 1 session/);
	await expect(today).toHaveAttribute("data-level", "1");
	await expect(signal).toContainText("+25m vs prior 7d");

	await today.focus();
	await app.keyboard.press("ArrowLeft");
	const yesterday = days.nth(26);
	await expect(yesterday).toBeFocused();
	await expect(signal.locator(".bank-signal-detail")).toHaveText("Sat, Nov 21 · 0m · 0 sessions");
	await expectClock(app, "05:00");
	await app.keyboard.press("Enter");
	await expect(yesterday).toHaveAttribute("aria-pressed", "true");
	await expectClock(app, "05:00");

	await advance(app, 24 * 60 * MINUTE);
	await expect(today).toHaveAccessibleName(/Mon, Nov 23 · 0m · 0 sessions/);
	await expect(days.nth(26)).toHaveAttribute("data-level", "1");
	await expect(days.nth(25)).toHaveAttribute("aria-pressed", "true");
});
