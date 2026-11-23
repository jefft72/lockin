import { describe, expect, it } from "vitest";
import { clockDigits, clockText, spanText } from "./format.ts";
import { MINUTE, SECOND } from "./timer.ts";

describe("clockDigits", () => {
	it("rounds up so the last second is shown until it is fully spent", () => {
		expect(clockText(25 * MINUTE)).toBe("25:00");
		expect(clockText(25 * MINUTE - 1)).toBe("25:00");
		expect(clockText(24 * MINUTE + 59 * SECOND)).toBe("24:59");
		expect(clockText(1)).toBe("00:01");
		expect(clockText(0)).toBe("00:00");
		expect(clockText(-500)).toBe("00:00");
	});

	it("grows a third minute digit past 99 minutes", () => {
		expect(clockDigits(180 * MINUTE)).toEqual({ minutes: "180", seconds: "00" });
	});
});

describe("spanText", () => {
	it("drops the hours until there are some", () => {
		expect(spanText(0)).toBe("0m");
		expect(spanText(45 * MINUTE + 59 * SECOND)).toBe("45m");
		expect(spanText(65 * MINUTE)).toBe("1h 05m");
		expect(spanText(12 * 60 * MINUTE + 35 * MINUTE)).toBe("12h 35m");
	});
});
