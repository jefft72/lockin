import type { Ledger, LedgerEntry } from "./ledger.ts";

/** A calendar day in the user's own timezone, as a sortable "YYYY-MM-DD". */
export function dayKey(time: number): string {
	const date = new Date(time);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** The day `offset` days from `time`, by the calendar rather than by 24 hours, so DST is safe. */
function shiftDay(time: number, offset: number): number {
	const date = new Date(time);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, 12).getTime();
}

export interface Day {
	readonly key: string;
	/** Noon of the day, for labelling. */
	readonly time: number;
	readonly entries: readonly LedgerEntry[];
	readonly focusMs: number;
}

/** Sessions belong to the day they ended on. */
export function groupByDay(ledger: Ledger): Map<string, LedgerEntry[]> {
	const days = new Map<string, LedgerEntry[]>();
	for (const entry of ledger) {
		const key = dayKey(entry.endedAt);
		const bucket = days.get(key);
		if (bucket) bucket.push(entry);
		else days.set(key, [entry]);
	}
	return days;
}

const sumFocus = (entries: readonly LedgerEntry[]) =>
	entries.reduce((total, entry) => total + entry.focusMs, 0);

/** The last `count` calendar days ending today, oldest first, empty days included. */
export function recentDays(ledger: Ledger, now: number, count: number): Day[] {
	const byDay = groupByDay(ledger);
	const days: Day[] = [];
	for (let offset = 1 - count; offset <= 0; offset++) {
		const time = shiftDay(now, offset);
		const key = dayKey(time);
		const entries = byDay.get(key) ?? [];
		days.push({ key, time, entries, focusMs: sumFocus(entries) });
	}
	return days;
}

export interface Summary {
	readonly sessions: number;
	readonly totalMs: number;
	readonly todayMs: number;
	readonly todaySessions: number;
	/** Consecutive days banked, counting back from today, or from yesterday if today is still empty. */
	readonly streakDays: number;
	readonly longestStreakDays: number;
	readonly bestDayMs: number;
	readonly bestDaySessions: number;
	readonly longestSessionMs: number;
}

export function summarize(ledger: Ledger, now: number): Summary {
	const byDay = groupByDay(ledger);
	const today = byDay.get(dayKey(now)) ?? [];

	let streakDays = 0;
	const startOffset = today.length > 0 ? 0 : -1;
	while (byDay.has(dayKey(shiftDay(now, startOffset - streakDays)))) streakDays++;

	let longestStreakDays = 0;
	let run = 0;
	let previous: string | null = null;
	for (const key of [...byDay.keys()].sort()) {
		const [year, month, day] = key.split("-").map(Number) as [number, number, number];
		const dayBefore = dayKey(new Date(year, month - 1, day - 1, 12).getTime());
		run = previous === dayBefore ? run + 1 : 1;
		longestStreakDays = Math.max(longestStreakDays, run);
		previous = key;
	}

	let bestDayMs = 0;
	let bestDaySessions = 0;
	for (const entries of byDay.values()) {
		bestDayMs = Math.max(bestDayMs, sumFocus(entries));
		bestDaySessions = Math.max(bestDaySessions, entries.length);
	}

	return {
		sessions: ledger.length,
		totalMs: sumFocus(ledger),
		todayMs: sumFocus(today),
		todaySessions: today.length,
		streakDays,
		longestStreakDays,
		bestDayMs,
		bestDaySessions,
		longestSessionMs: ledger.reduce((best, entry) => Math.max(best, entry.focusMs), 0),
	};
}
