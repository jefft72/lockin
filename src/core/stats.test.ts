import { describe, expect, it } from "vitest";
import type { Ledger, LedgerEntry } from "./ledger.ts";
import { earned, newlyEarned, REWARDS } from "./rewards.ts";
import { dayKey, recentDays, summarize } from "./stats.ts";
import { MINUTE } from "./timer.ts";

/** A local wall-clock time in November 2026, so the tests hold in any timezone. */
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

let nextId = 0;
/** A stats-only ledger entry: the chain fields are irrelevant here. */
function entry(endedAt: number, minutes = 25): LedgerEntry {
	nextId += 1;
	return {
		id: `e${nextId}`,
		seq: nextId,
		startedAt: endedAt - minutes * MINUTE,
		endedAt,
		focusMs: minutes * MINUTE,
		plannedMs: minutes * MINUTE,
		kind: "full",
		prev: "",
		hash: "",
	};
}

describe("dayKey", () => {
	it("uses the local calendar day", () => {
		expect(dayKey(at(3, 0, 0))).toBe("2026-11-03");
		expect(dayKey(at(3, 23, 59))).toBe("2026-11-03");
		expect(dayKey(at(4, 0, 0))).toBe("2026-11-04");
	});
});

describe("recentDays", () => {
	it("returns consecutive days ending today, empty ones included", () => {
		const ledger = [entry(at(20, 9)), entry(at(22, 9)), entry(at(22, 10), 50)];
		const days = recentDays(ledger, at(22, 18), 4);
		expect(days.map((day) => day.key)).toEqual([
			"2026-11-19",
			"2026-11-20",
			"2026-11-21",
			"2026-11-22",
		]);
		expect(days.map((day) => day.entries.length)).toEqual([0, 1, 0, 2]);
		expect(days.at(-1)?.focusMs).toBe(75 * MINUTE);
	});

	it("crosses month boundaries by the calendar", () => {
		const days = recentDays([], at(1, 8), 3);
		expect(days.map((day) => day.key)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
	});

	it("files a session that runs past midnight under the day it ended", () => {
		const days = recentDays([entry(at(22, 0, 10))], at(22, 9), 2);
		expect(days.map((day) => day.entries.length)).toEqual([0, 1]);
	});
});

describe("summarize", () => {
	it("is all zeroes for an empty ledger", () => {
		expect(summarize([], at(22))).toEqual({
			sessions: 0,
			totalMs: 0,
			todayMs: 0,
			todaySessions: 0,
			streakDays: 0,
			longestStreakDays: 0,
			bestDayMs: 0,
			bestDaySessions: 0,
			longestSessionMs: 0,
		});
	});

	it("totals today and all time", () => {
		const ledger = [entry(at(21, 9)), entry(at(22, 9)), entry(at(22, 10), 50)];
		expect(summarize(ledger, at(22, 18))).toMatchObject({
			sessions: 3,
			totalMs: 100 * MINUTE,
			todayMs: 75 * MINUTE,
			todaySessions: 2,
			bestDayMs: 75 * MINUTE,
			bestDaySessions: 2,
			longestSessionMs: 50 * MINUTE,
		});
	});

	it("keeps yesterday's streak alive until today is over", () => {
		const ledger = [entry(at(19)), entry(at(20)), entry(at(21))];
		expect(summarize(ledger, at(22, 8)).streakDays).toBe(3);
		expect(summarize([...ledger, entry(at(22, 9))], at(22, 10)).streakDays).toBe(4);
		expect(summarize(ledger, at(23, 8)).streakDays).toBe(0);
	});

	it("remembers the longest streak after it breaks", () => {
		const ledger = [entry(at(1)), entry(at(2)), entry(at(3)), entry(at(10)), entry(at(11))];
		expect(summarize(ledger, at(22))).toMatchObject({ streakDays: 0, longestStreakDays: 3 });
	});
});

describe("rewards", () => {
	it("has unique ids and board-sized labels", () => {
		expect(new Set(REWARDS.map((reward) => reward.id)).size).toBe(REWARDS.length);
		for (const reward of REWARDS) expect(reward.label).toMatch(/^[A-Z0-9 ]{1,18}$/);
	});

	it("starts with nothing earned", () => {
		expect(earned([])).toEqual(new Set());
	});

	it("unlocks on the deposit that crosses the line", () => {
		const first: Ledger = [entry(at(22, 9))];
		expect(newlyEarned([], first).map((reward) => reward.id)).toEqual(["first-deposit"]);

		const second = [...first, entry(at(22, 10))];
		expect(newlyEarned(first, second)).toEqual([]);

		const third = [...second, entry(at(22, 11))];
		expect(newlyEarned(second, third).map((reward) => reward.id)).toEqual(["total-1h"]);

		const fourth = [...third, entry(at(22, 12), 50)];
		expect(newlyEarned(third, fourth).map((reward) => reward.id)).toEqual([
			"set-4",
			"day-2h",
			"session-50m",
		]);
	});

	it("rewards the longest session there can be", () => {
		expect(earned([entry(at(22, 12), 179)]).has("session-180m")).toBe(false);
		expect(earned([entry(at(22, 12), 180)]).has("session-180m")).toBe(true);
	});

	it("never takes a reward back when a streak ends", () => {
		const ledger = [entry(at(1)), entry(at(2)), entry(at(3))];
		const later = [...ledger, entry(at(20))];
		expect(earned(ledger).has("streak-3d")).toBe(true);
		expect(earned(later).has("streak-3d")).toBe(true);
		expect(newlyEarned(ledger, later)).toEqual([]);
	});
});
