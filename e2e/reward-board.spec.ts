import { bankSession, elapse, expect, test } from "./app.ts";

test("the milestone dialog traps focus and restores it when continued", async ({ app }) => {
	const rewards = app.getByRole("button", { name: "rewards" });
	await bankSession(app, 25);
	await rewards.focus();
	await elapse(app, 1500);
	const dialog = app.getByRole("dialog", { name: "reward: FIRST DEPOSIT" });
	const next = dialog.getByRole("button", { name: "continue" });
	await expect(next).toBeFocused();
	await app.keyboard.press("Tab");
	await expect(dialog).toBeVisible();
	await expect(rewards).not.toBeFocused();
	await next.focus();
	await app.keyboard.press("Enter");
	await expect(dialog).toBeHidden();
	await expect(rewards).toBeFocused();
});

test("reduced motion reveals the milestone without animation", async ({ app }) => {
	await app.emulateMedia({ reducedMotion: "reduce" });
	await bankSession(app, 25);
	await elapse(app, 1500);
	const dialog = app.getByRole("dialog", { name: "reward: FIRST DEPOSIT" });
	await expect(dialog.locator(".board-line")).toHaveText("FIRST DEPOSIT");
	expect(await dialog.evaluate((sheet) => sheet.getAnimations({ subtree: true }).length)).toBe(0);
	await app.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
