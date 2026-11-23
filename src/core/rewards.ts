import type { Ledger } from "./ledger.ts";
import { type Summary, summarize } from "./stats.ts";
import { MINUTE } from "./timer.ts";

const HOUR = 60 * MINUTE;

export interface Reward {
	readonly id: string;
	/** Upper case, short enough for the split-flap board. */
	readonly label: string;
	/** How to earn it. */
	readonly hint: string;
	/** Progress towards it, 0 to 1. Earned at 1. */
	progress(summary: Summary): number;
}

const ratio = (value: number, goal: number) => Math.min(1, value / goal);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const hoursBanked = (hours: number): Reward => ({
	id: `total-${hours}h`,
	label: `${plural(hours, "hour").toUpperCase()} BANKED`,
	hint: `bank ${plural(hours, "hour")} in total`,
	progress: (s) => ratio(s.totalMs, hours * HOUR),
});

const streak = (days: number): Reward => ({
	id: `streak-${days}d`,
	label: `${days} DAY STREAK`,
	hint: `bank a session ${days} days in a row`,
	progress: (s) => ratio(s.longestStreakDays, days),
});

const bigDay = (hours: number): Reward => ({
	id: `day-${hours}h`,
	label: `${hours} HOUR DAY`,
	hint: `bank ${hours} hours in one day`,
	progress: (s) => ratio(s.bestDayMs, hours * HOUR),
});

const set = (sessions: number, label: string): Reward => ({
	id: `set-${sessions}`,
	label,
	hint: `bank ${sessions} sessions in one day`,
	progress: (s) => ratio(s.bestDaySessions, sessions),
});

const longSession = (minutes: number, label: string): Reward => ({
	id: `session-${minutes}m`,
	label,
	hint: `bank a single ${minutes} minute session`,
	progress: (s) => ratio(s.longestSessionMs, minutes * MINUTE),
});

/**
 * Every reward is a function of the ledger's all-time bests, never of today's
 * date, so once earned it stays earned for as long as the ledger stands.
 */
export const REWARDS: readonly Reward[] = [
	{
		id: "first-deposit",
		label: "FIRST DEPOSIT",
		hint: "bank your first session",
		progress: (s) => ratio(s.sessions, 1),
	},
	...[1, 5, 10, 25, 50, 100, 250, 500].map(hoursBanked),
	...[2, 3, 5, 7, 14, 30, 60, 100].map(streak),
	set(4, "FULL SET"),
	set(8, "DOUBLE SET"),
	set(12, "TRIPLE SET"),
	...[2, 4, 6, 8].map(bigDay),
	longSession(50, "DEEP WORK"),
	longSession(90, "MARATHON"),
];

export function earned(ledger: Ledger): Set<string> {
	// `now` only affects the current streak, which no reward reads.
	const summary = summarize(ledger, 0);
	return new Set(REWARDS.filter((reward) => reward.progress(summary) >= 1).map((r) => r.id));
}

/** The rewards a deposit just unlocked, in display order. */
export function newlyEarned(before: Ledger, after: Ledger): Reward[] {
	const had = earned(before);
	const has = earned(after);
	return REWARDS.filter((reward) => has.has(reward.id) && !had.has(reward.id));
}
