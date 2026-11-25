/**
 * The timer is a pure state machine. It never reads a clock and never counts
 * ticks: every event carries the wall time it happened at, and a running timer
 * is just a deadline. That makes it immune to throttled tabs, sleeping laptops
 * and reloads, and lets tests drive it with plain numbers.
 *
 * The stopwatch is the same machine read the other way round: a countdown
 * from a cap, shown as the time gone rather than the time left.
 */

export const PHASES = ["focus", "break", "longBreak", "stopwatch"] as const;
export type Phase = (typeof PHASES)[number];
/** The phases that count down from a length the user sets. The stopwatch counts up instead. */
export type TimedPhase = Exclude<Phase, "stopwatch">;

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const MIN_DURATION = MINUTE;
export const MAX_DURATION = 180 * MINUTE;
/** A run of work is split into this many stretches, with a checkpoint between each. */
export const STRETCHES = 4;
/**
 * A stopwatch run is open-ended but not endless: it banks itself at this
 * length. The bank is append-only, so a stopwatch forgotten overnight must not
 * be able to deposit a day of hours nobody worked.
 */
export const STOPWATCH_CAP = MAX_DURATION;
/** The elapsed times a stopwatch run announces as its checkpoints. */
export const STOPWATCH_MARKS = [25 * MINUTE, 50 * MINUTE, 90 * MINUTE] as const;
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
	/** The length counted down from. For a stopwatch, the cap it stops at. */
	readonly totalMs: number;
	/** Checkpoints already announced, 0 to STRETCHES - 1. */
	readonly checkpoint: number;
	readonly clock: RunClock;
}

export interface TimerState {
	readonly phase: Phase;
	readonly durations: Readonly<Record<TimedPhase, number>>;
	/** Null while idle: the timer is armed and waiting. */
	readonly run: Run | null;
	/** Focus runs completed so far, used to schedule the long break. */
	readonly cycle: number;
}

export interface SessionRecord {
	readonly id: string;
	readonly startedAt: number;
	readonly endedAt: number;
	/** Time actually spent with the clock running, pauses excluded. */
	readonly focusMs: number;
	/** The length the session was set to. 0 for a stopwatch session, which has none. */
	readonly plannedMs: number;
	/** `full` and `partial` are countdowns that ran out or were banked early. */
	readonly kind: "full" | "partial" | "stopwatch";
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
	/** `atMs` is how far into the run the checkpoint sits. */
	| { readonly type: "checkpoint"; readonly index: number; readonly atMs: number }
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

/** Work is what gets banked and has checkpoints. Breaks do neither. */
export function isWork(phase: Phase): boolean {
	return phase === "focus" || phase === "stopwatch";
}

/** How long a run started now could last. */
function armedMs(state: TimerState): number {
	return state.phase === "stopwatch" ? STOPWATCH_CAP : state.durations[state.phase];
}

export function remainingMs(state: TimerState, now: number): number {
	const { run } = state;
	if (!run) return armedMs(state);
	return run.clock.kind === "running"
		? Math.max(0, run.clock.deadline - now)
		: run.clock.remainingMs;
}

/** Time the current run has spent with its clock running, 0 while idle. */
export function elapsedMs(state: TimerState, now: number): number {
	const { run } = state;
	return run ? run.totalMs - remainingMs(state, now) : 0;
}

export interface Reading {
	readonly seconds: number;
	readonly counting: "up" | "down";
}

/**
 * What the clock should show, in whole seconds. Either way a second only
 * counts once it is fully spent: a countdown reads its full length at the
 * start and zero exactly when it ends, and a stopwatch starts at zero.
 */
export function reading(state: TimerState, now: number): Reading {
	return state.phase === "stopwatch"
		? { seconds: Math.floor(elapsedMs(state, now) / SECOND), counting: "up" }
		: { seconds: Math.ceil(remainingMs(state, now) / SECOND), counting: "down" };
}

/**
 * Where each stretch of a run ends, as elapsed time. A countdown is cut into
 * equal parts. A stopwatch has no length to divide, so its stretches end at
 * fixed marks instead. Breaks have none.
 */
function stretchEnds(phase: Phase, totalMs: number): readonly number[] {
	if (phase === "stopwatch") return [...STOPWATCH_MARKS, totalMs];
	if (phase !== "focus") return [];
	return Array.from({ length: STRETCHES }, (_, i) => (totalMs * (i + 1)) / STRETCHES);
}

/**
 * How many stretches of the current run are done, fractions included: 2.5 is
 * halfway through the third. 0 while idle and during breaks.
 */
export function stretchesDone(state: TimerState, now: number): number {
	const { run } = state;
	if (!run) return 0;
	const ends = stretchEnds(state.phase, run.totalMs);
	const elapsed = elapsedMs(state, now);
	let start = 0;
	for (const [index, end] of ends.entries()) {
		if (elapsed < end) return index + (elapsed - start) / (end - start);
		start = end;
	}
	return ends.length;
}

export function canBank(state: TimerState, now: number): boolean {
	return isWork(state.phase) && elapsedMs(state, now) >= MIN_BANKABLE;
}

function finish(
	state: TimerState,
	run: Run,
	endedAt: number,
	focusMs: number,
	early: boolean,
): Transition {
	const { phase } = state;
	const idle = { ...state, run: null };
	const span = { id: run.id, startedAt: run.startedAt, endedAt, focusMs };
	if (phase === "stopwatch") {
		// No plan to fall short of, and no break owed: the stopwatch stays put
		// and the pomodoro cycle does not move.
		const session: SessionRecord = { ...span, plannedMs: 0, kind: "stopwatch" };
		return [idle, [{ type: "finished", phase, session }]];
	}
	if (phase !== "focus") {
		return [{ ...idle, phase: "focus" }, [{ type: "finished", phase, session: null }]];
	}
	const cycle = state.cycle + 1;
	const next: Phase = cycle % LONG_BREAK_EVERY === 0 ? "longBreak" : "break";
	const kind = early ? "partial" : "full";
	const session: SessionRecord = { ...span, plannedMs: run.totalMs, kind };
	return [{ ...idle, phase: next, cycle }, [{ type: "finished", phase, session }]];
}

export function reduce(state: TimerState, event: TimerEvent): Transition {
	const { run } = state;
	switch (event.type) {
		case "start": {
			if (!run) {
				const totalMs = armedMs(state);
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
				return finish(state, run, run.clock.deadline, run.totalMs, false);
			}
			const elapsed = elapsedMs(state, event.now);
			const passed = stretchEnds(state.phase, run.totalMs)
				.slice(0, STRETCHES - 1)
				.filter((end) => end <= elapsed);
			const atMs = passed.at(-1);
			if (atMs === undefined || passed.length <= run.checkpoint) return [state, NO_EFFECTS];
			// A late tick can cross several checkpoints at once: announce only the latest.
			return [
				{ ...state, run: { ...run, checkpoint: passed.length } },
				[{ type: "checkpoint", index: passed.length, atMs }],
			];
		}
		case "bank": {
			if (!run || !canBank(state, event.now)) return [state, NO_EFFECTS];
			const left = remainingMs(state, event.now);
			return finish(state, run, event.now, run.totalMs - left, left > 0);
		}
		case "reset":
			return run ? [{ ...state, run: null }, NO_EFFECTS] : [state, NO_EFFECTS];
		case "setDuration": {
			const { phase } = state;
			// The stopwatch has no length to set.
			if (run || phase === "stopwatch") return [state, NO_EFFECTS];
			const ms = clampDuration(event.ms);
			if (ms === state.durations[phase]) return [state, NO_EFFECTS];
			return [{ ...state, durations: { ...state.durations, [phase]: ms } }, NO_EFFECTS];
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
