import { advance, expect, expectClock, test } from "./app.ts";

test("study view hides the bank, survives reload, and leaves the timer running", async ({
	app,
}) => {
	const toggle = app.getByRole("button", { name: "study view" });
	const bank = app.getByRole("complementary", { name: "bank" });
	await expect(bank).toBeVisible();
	await app.keyboard.press("Space");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(bank).toBeHidden();
	await advance(app, 1000);
	await expectClock(app, "24:59");

	await app.reload();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(bank).toBeHidden();
	await app.keyboard.press("Escape");
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(bank).toBeVisible();
	await expect(app.getByRole("button", { name: "pause" })).toBeVisible();

	await app.keyboard.press("v");
	await expect(bank).toBeHidden();
	await toggle.click();
	await expect(bank).toBeVisible();
});
