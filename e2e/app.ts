import { test as base, expect, type Page } from "@playwright/test";

/** 09:00 on a Sunday, local to the test timezone. */
export const START = new Date("2026-11-22T09:00:00-08:00");

export const MINUTE = 60_000;

/**
 * Every test starts with no Spotify bridge and a clock frozen at START that
 * only moves when the test moves it, so nothing depends on the real time, on
 * how fast the machine is, or on what it happens to be playing.
 */
export const test = base.extend<{ app: Page }>({
	app: async ({ page }, use) => {
		// Let time run while the page loads, then stop it exactly on START.
		await page.clock.install({ time: START.getTime() - MINUTE });
		await page.route("**/api/spotify**", (route) =>
			route.fulfill({ json: { state: "unsupported" } }),
		);
		await page.goto("/");
		await expect(page.getByRole("timer")).toBeVisible();
		await page.clock.pauseAt(START);
		await use(page);
	},
});

export { expect };

/** The clock reads a time left by default, or a time gone for the stopwatch. */
export async function expectClock(
	page: Page,
	reading: string,
	counting: "remaining" | "elapsed" = "remaining",
): Promise<void> {
	await expect(page.getByRole("timer")).toHaveAttribute("aria-label", `${reading} ${counting}`);
}

/**
 * Jumps the clock forward, like closing the laptop lid and opening it later.
 * The timer notices on its next heartbeat.
 */
export async function advance(page: Page, ms: number): Promise<void> {
	await page.clock.fastForward(ms);
}

/** Lets time pass normally, running every timer along the way in order. */
export async function elapse(page: Page, ms: number): Promise<void> {
	await page.clock.runFor(ms);
}

export function ledgerOf(page: Page): Promise<Array<Record<string, unknown>>> {
	return page.evaluate(() => JSON.parse(localStorage.getItem("lockin.ledger.v1") ?? "[]"));
}

/** Runs one full focus session of the armed length and waits for it to be banked. */
export async function bankSession(page: Page, minutes = 25): Promise<void> {
	const before = (await ledgerOf(page)).length;
	await page.getByRole("button", { name: "focus", exact: true }).click();
	await page.getByRole("button", { name: `${minutes} minutes` }).click();
	await page.keyboard.press("Space");
	await advance(page, minutes * MINUTE);
	await expect.poll(async () => (await ledgerOf(page)).length).toBe(before + 1);
}

/** Waits out the beat between a deposit and its rewards, then clears any board. */
export async function clearBoard(page: Page): Promise<void> {
	await elapse(page, 1500);
	const board = page.locator(".board");
	if (await board.isVisible()) await page.keyboard.press("Escape");
	await expect(board).toBeHidden();
}
