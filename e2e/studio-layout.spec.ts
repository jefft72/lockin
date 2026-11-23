import { expect, expectClock, test } from "./app.ts";

test("a small screen fits a three-digit timer and keeps its controls accessible", async ({
	app,
}) => {
	await app.setViewportSize({ width: 360, height: 640 });
	for (const key of ["1", "8", "0"]) await app.keyboard.press(key);
	await expectClock(app, "180:00");

	const timer = await app.getByRole("timer").boundingBox();
	expect(timer).not.toBeNull();
	expect(timer?.x).toBeGreaterThanOrEqual(0);
	expect((timer?.x ?? 0) + (timer?.width ?? 0)).toBeLessThanOrEqual(360);
	expect(await app.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

	await app.getByRole("button", { name: "start", exact: true }).click();
	await expect(app.getByRole("button", { name: "pause", exact: true })).toBeVisible();
	await app.getByRole("button", { name: "study view" }).click();
	await expect(app.getByRole("complementary", { name: "bank" })).toBeHidden();
});
