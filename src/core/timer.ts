/**
 * The timer is a pure state machine. It never reads a clock and never counts
 * ticks: every event carries the wall time it happened at, and a running timer
 * is just a deadline. That makes it immune to throttled tabs, sleeping laptops
 * and reloads, and lets tests drive it with plain numbers.
 */

export const PHASES = ["focus", "break", "longBreak"] as const;
export type Phase = (typeof PHASES)[number];

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const MIN_DURATION = MINUTE;
export const MAX_DURATION = 180 * MINUTE;
/** A focus run is split into this many equal stretches, with a checkpoint between each. */
export const STRETCHES = 4;
/** Every Nth completed focus run earns the long break. */
export const LONG_BREAK_EVERY = 4;
/** Banking early is only allowed once this much focus time has been put in. */
export const MIN_BANKABLE = MINUTE;

export type RunClock =
	| { readonly kind: "running"; readonly deadline: number }
	| { readonly kind: "paused"; readonly remainingMs: number };

export interface Run {
	readonly id: string;
	readonly startedAt: number;
	readonly totalMs: number;
	/** Checkpoints already announced, 0 to STRETCHES - 1. */
	readonly checkpoint: number;
	readonly clock: RunClock;
}

export interface TimerState {
	readonly phase: Phase;
	readonly durations: Readonly<Record<Phase, number>>;
	/** Null while idle: the timer is armed at `durations[phase]`. */
	readonly run: Run | null;
	/** Focus runs completed so far, used to schedule the long break. */
	readonly cycle: number;
}

export interface SessionRecord {
	readonly id: string;
	readonly startedAt: number;
	readonly endedAt: number;
	/** Time actually spent counting down, pauses excluded. */
	readonly focusMs: number;
	readonly plannedMs: number;
	readonly kind: "full" | "partial";
}

export type TimerEvent =
	| { readonly type: "start"; readonly now: number; readonly id: string }
	| { readonly type: "pause"; readonly now: number }
	| { readonly type: "tick"; readonly now: number }
	| { readonly type: "bank"; readonly now: number }
	| { readonly type: "reset" }
	| { readonly type: "setDuration"; readonly ms: number }
	| { readonly type: "selectPhase"; readonly phase: Phase };

export type TimerEffect =
	| { readonly type: "checkpoint"; readonly index: number }
	| { readonly type: "finished"; readonly phase: Phase; readonly session: SessionRecord | null };

export type Transition = readonly [TimerState, readonly TimerEffect[]];

const NO_EFFECTS: readonly TimerEffect[] = [];

export const initialState: TimerState = {
	phase: "focus",
	durations: { focus: 25 * MINUTE, break: 5 * MINUTE, longBreak: 15 * MINUTE },
	run: null,
	cycle: 0,
};

export function clampDuration(ms: number): number {
	const whole = Math.round(ms / SECOND) * SECOND;
	return Math.min(MAX_DURATION, Math.max(MIN_DURATION, whole));
}

export function remainingMs(state: TimerState, now: number): number {
	const { run } = state;
	if (!run) return state.durations[state.phase];
	return run.clock.kind === "running"
		? Math.max(0, run.clock.deadline - now)
		: run.clock.remainingMs;
}

/** Fraction of the current run that has elapsed, 0 while idle. */
export function progress(state: TimerState, now: number): number {
	const { run } = state;
	if (!run) return 0;
	return Math.min(1, Math.max(0, 1 - remainingMs(state, now) / run.totalMs));
}

export function canBank(state: TimerState, now: number): boolean {
	const { run } = state;
	if (!run || state.phase !== "focus") return false;
	return run.totalMs - remainingMs(state, now) >= MIN_BANKABLE;
}

function finish(
	state: TimerState,
	run: Run,
	endedAt: number,
	focusMs: number,
	kind: SessionRecord["kind"],
): Transition {
	const { phase } = state;
	const wasFocus = phase === "focus";
	const cycle = wasFocus ? state.cycle + 1 : state.cycle;
	const next: Phase = !wasFocus ? "focus" : cycle % LONG_BREAK_EVERY === 0 ? "longBreak" : "break";
	const session: SessionRecord | null = wasFocus
		? { id: run.id, startedAt: run.startedAt, endedAt, focusMs, plannedMs: run.totalMs, kind }
		: null;
	return [{ ...state, phase: next, run: null, cycle }, [{ type: "finished", phase, session }]];
}

export function reduce(state: TimerState, event: TimerEvent): Transition {
	const { run } = state;
	switch (event.type) {
		case "start": {
			if (!run) {
				const totalMs = state.durations[state.phase];
				const clock: RunClock = { kind: "running", deadline: event.now + totalMs };
				const started: Run = { id: event.id, startedAt: event.now, totalMs, checkpoint: 0, clock };
				return [{ ...state, run: started }, NO_EFFECTS];
			}
			if (run.clock.kind === "running") return [state, NO_EFFECTS];
			const clock: RunClock = { kind: "running", deadline: event.now + run.clock.remainingMs };
			return [{ ...state, run: { ...run, clock } }, NO_EFFECTS];
		}
		case "pause": {
			if (run?.clock.kind !== "running") return [state, NO_EFFECTS];
			const clock: RunClock = { kind: "paused", remainingMs: remainingMs(state, event.now) };
			return [{ ...state, run: { ...run, clock } }, NO_EFFECTS];
		}
		case "tick": {
			if (run?.clock.kind !== "running") return [state, NO_EFFECTS];
			if (event.now >= run.clock.deadline) {
				// The run ended at its deadline, however late this tick arrives.
				return finish(state, run, run.clock.deadline, run.totalMs, "full");
			}
			if (state.phase !== "focus") return [state, NO_EFFECTS];
			const reached = Math.min(STRETCHES - 1, Math.floor(progress(state, event.now) * STRETCHES));
			if (reached <= run.checkpoint) return [state, NO_EFFECTS];
			// A late tick can cross several checkpoints at once: announce only the latest.
			return [
				{ ...state, run: { ...run, checkpoint: reached } },
				[{ type: "checkpoint", index: reached }],
			];
		}
		case "bank": {
			if (!run || !canBank(state, event.now)) return [state, NO_EFFECTS];
			const left = remainingMs(state, event.now);
			if (left === 0) return finish(state, run, event.now, run.totalMs, "full");
			return finish(state, run, event.now, run.totalMs - left, "partial");
		}
		case "reset":
			return run ? [{ ...state, run: null }, NO_EFFECTS] : [state, NO_EFFECTS];
		case "setDuration": {
			const ms = clampDuration(event.ms);
			if (run || ms === state.durations[state.phase]) return [state, NO_EFFECTS];
			return [{ ...state, durations: { ...state.durations, [state.phase]: ms } }, NO_EFFECTS];
		}
		case "selectPhase":
			if (run || event.phase === state.phase) return [state, NO_EFFECTS];
			return [{ ...state, phase: event.phase }, NO_EFFECTS];
	}
}

function isPhase(value: unknown): value is Phase {
	return PHASES.includes(value as Phase);
}

function isDuration(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && clampDuration(value) === value;
}

function isTime(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseRun(value: unknown): Run | null {
	if (typeof value !== "object" || value === null) return null;
	const { id, startedAt, totalMs, checkpoint, clock } = value as Record<string, unknown>;
	if (typeof id !== "string" || id === "" || !isTime(startedAt) || !isDuration(totalMs))
		return null;
	if (!Number.isInteger(checkpoint) || (checkpoint as number) < 0) return null;
	if ((checkpoint as number) >= STRETCHES) return null;
	if (typeof clock !== "object" || clock === null) return null;
	const { kind, deadline, remainingMs: left } = clock as Record<string, unknown>;
	let parsed: RunClock;
	if (kind === "running" && isTime(deadline)) parsed = { kind, deadline };
	else if (kind === "paused" && isTime(left) && left <= totalMs)
		parsed = { kind, remainingMs: left };
	else return null;
	return { id, startedAt, totalMs, checkpoint: checkpoint as number, clock: parsed };
}

/** Rebuilds a state from untrusted persisted JSON, or null if it is not one. */
export function parseState(value: unknown): TimerState | null {
	if (typeof value !== "object" || value === null) return null;
	const { phase, durations, run, cycle } = value as Record<string, unknown>;
	if (!isPhase(phase) || typeof durations !== "object" || durations === null) return null;
	const d = durations as Record<string, unknown>;
	if (!isDuration(d.focus) || !isDuration(d.break) || !isDuration(d.longBreak)) return null;
	if (!Number.isInteger(cycle) || (cycle as number) < 0) return null;
	const parsedRun = run === null ? null : parseRun(run);
	if (run !== null && parsedRun === null) return null;
	return {
		phase,
		durations: { focus: d.focus, break: d.break, longBreak: d.longBreak },
		run: parsedRun,
		cycle: cycle as number,
	};
}
