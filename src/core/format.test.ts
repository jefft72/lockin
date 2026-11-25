import { describe, expect, it } from "vitest";
import { clockDigits, clockText, spanText } from "./format.ts";
import { MINUTE, SECOND } from "./timer.ts";

describe("clockText", () => {
	it("pads minutes and seconds to two digits", () => {
		expect(clockText(25 * 60)).toBe("25:00");
		expect(clockText(24 * 60 + 59)).toBe("24:59");
		expect(clockText(61)).toBe("01:01");
		expect(clockText(0)).toBe("00:00");
	});

	it("grows a third minute digit past 99 minutes", () => {
		expect(clockDigits(180 * 60)).toEqual({ minutes: "180", seconds: "00" });
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
