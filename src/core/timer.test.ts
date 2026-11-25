import { describe, expect, it } from "vitest";
import {
	canBank,
	clampDuration,
	elapsedMs,
	initialState,
	MAX_DURATION,
	MINUTE,
	parseState,
	reading,
	reduce,
	remainingMs,
	SECOND,
	STOPWATCH_CAP,
	stretchesDone,
	type TimerEffect,
	type TimerEvent,
	type TimerState,
} from "./timer.ts";

const T0 = 1_800_000_000_000;

/** Applies events in order, collecting every effect along the way. */
function play(state: TimerState, ...events: TimerEvent[]): [TimerState, TimerEffect[]] {
	const effects: TimerEffect[] = [];
	let current = state;
	for (const event of events) {
		const [next, emitted] = reduce(current, event);
		current = next;
		effects.push(...emitted);
	}
	return [current, effects];
}

const start = (now: number, id = "run-1"): TimerEvent => ({ type: "start", now, id });
const tick = (now: number): TimerEvent => ({ type: "tick", now });

describe("idle", () => {
	it("is armed at the phase duration", () => {
		expect(remainingMs(initialState, T0)).toBe(25 * MINUTE);
		expect(elapsedMs(initialState, T0)).toBe(0);
		expect(stretchesDone(initialState, T0)).toBe(0);
	});

	it("adjusts the duration of the selected phase only", () => {
		const [state] = play(initialState, { type: "setDuration", ms: 50 * MINUTE });
		expect(state.durations).toEqual({
			focus: 50 * MINUTE,
			break: 5 * MINUTE,
			longBreak: 15 * MINUTE,
		});
	});

	it("clamps durations to whole seconds within bounds", () => {
		expect(clampDuration(0)).toBe(MINUTE);
		expect(clampDuration(999 * MINUTE)).toBe(MAX_DURATION);
		expect(clampDuration(90 * SECOND + 400)).toBe(90 * SECOND);
	});

	it("returns the same state when nothing changes", () => {
		for (const event of [
			tick(T0),
			{ type: "pause", now: T0 },
			{ type: "reset" },
			{ type: "bank", now: T0 },
			{ type: "setDuration", ms: 25 * MINUTE },
			{ type: "selectPhase", phase: "focus" },
		] satisfies TimerEvent[]) {
			expect(reduce(initialState, event)[0]).toBe(initialState);
		}
	});
});

describe("running", () => {
	it("counts down against the wall clock", () => {
		const [state] = play(initialState, start(T0));
		expect(remainingMs(state, T0 + 10 * MINUTE)).toBe(15 * MINUTE);
		expect(elapsedMs(state, T0 + 10 * MINUTE)).toBe(10 * MINUTE);
		expect(stretchesDone(state, T0 + 10 * MINUTE)).toBeCloseTo(1.6);
	});

	it("freezes while paused and resumes with the same time left", () => {
		const [paused] = play(initialState, start(T0), { type: "pause", now: T0 + 10 * MINUTE });
		expect(remainingMs(paused, T0 + 60 * MINUTE)).toBe(15 * MINUTE);

		const [resumed] = play(paused, start(T0 + 60 * MINUTE, "ignored"));
		expect(resumed.run?.id).toBe("run-1");
		expect(remainingMs(resumed, T0 + 61 * MINUTE)).toBe(14 * MINUTE);
	});

	it("locks duration and phase while a run exists", () => {
		const [running] = play(initialState, start(T0));
		expect(reduce(running, { type: "setDuration", ms: 50 * MINUTE })[0]).toBe(running);
		expect(reduce(running, { type: "selectPhase", phase: "break" })[0]).toBe(running);
	});

	it("discards the run on reset without banking anything", () => {
		const [state, effects] = play(initialState, start(T0), tick(T0 + 20 * MINUTE), {
			type: "reset",
		});
		expect(state.run).toBeNull();
		expect(state.phase).toBe("focus");
		expect(effects.filter((e) => e.type === "finished")).toEqual([]);
	});
});

describe("checkpoints", () => {
	it("announces each quarter of a focus run once", () => {
		const quarter = (25 * MINUTE) / 4;
		const [, effects] = play(
			initialState,
			start(T0),
			tick(T0 + quarter - 1),
			tick(T0 + quarter),
			tick(T0 + quarter + 5),
			tick(T0 + 2 * quarter),
			tick(T0 + 3 * quarter),
		);
		expect(effects).toEqual([
			{ type: "checkpoint", index: 1, atMs: quarter },
			{ type: "checkpoint", index: 2, atMs: 2 * quarter },
			{ type: "checkpoint", index: 3, atMs: 3 * quarter },
		]);
	});

	it("announces only the latest checkpoint after a long gap", () => {
		const [, effects] = play(initialState, start(T0), tick(T0 + 20 * MINUTE));
		expect(effects).toEqual([{ type: "checkpoint", index: 3, atMs: 18.75 * MINUTE }]);
	});

	it("does not checkpoint breaks", () => {
		const [, effects] = play(
			initialState,
			{ type: "selectPhase", phase: "break" },
			start(T0),
			tick(T0 + 4 * MINUTE),
		);
		expect(effects).toEqual([]);
	});
});

describe("finishing", () => {
	it("banks a full session ending at the deadline, however late the tick", () => {
		const [state, effects] = play(initialState, start(T0), tick(T0 + 8 * 60 * MINUTE));
		expect(state).toMatchObject({ phase: "break", run: null, cycle: 1 });
		expect(effects).toEqual([
			{
				type: "finished",
				phase: "focus",
				session: {
					id: "run-1",
					startedAt: T0,
					endedAt: T0 + 25 * MINUTE,
					focusMs: 25 * MINUTE,
					plannedMs: 25 * MINUTE,
					kind: "full",
				},
			},
		]);
	});

	it("excludes paused time from a session but keeps its real span", () => {
		const [, effects] = play(
			initialState,
			start(T0),
			{ type: "pause", now: T0 + 10 * MINUTE },
			start(T0 + 40 * MINUTE),
			tick(T0 + 55 * MINUTE),
		);
		const done = effects.find((e) => e.type === "finished");
		expect(done?.session).toMatchObject({ focusMs: 25 * MINUTE, endedAt: T0 + 55 * MINUTE });
	});

	it("returns to focus after a break without banking it", () => {
		const [state, effects] = play(
			initialState,
			{ type: "selectPhase", phase: "break" },
			start(T0),
			tick(T0 + 5 * MINUTE),
		);
		expect(state).toMatchObject({ phase: "focus", cycle: 0 });
		expect(effects).toEqual([{ type: "finished", phase: "break", session: null }]);
	});

	it("earns the long break on every fourth focus run", () => {
		let state = initialState;
		let now = T0;
		const phases: string[] = [];
		for (let i = 0; i < 16; i++) {
			[state] = play(state, start(now, `run-${i}`), tick(now + MAX_DURATION));
			phases.push(state.phase);
			now += MAX_DURATION;
		}
		expect(phases.slice(0, 8)).toEqual([
			"break",
			"focus",
			"break",
			"focus",
			"break",
			"focus",
			"longBreak",
			"focus",
		]);
		expect(phases.slice(8)).toEqual(phases.slice(0, 8));
	});
});

describe("banking early", () => {
	it("is refused until a minute of focus is in", () => {
		const [running] = play(initialState, start(T0));
		expect(canBank(running, T0 + 59 * SECOND)).toBe(false);
		expect(reduce(running, { type: "bank", now: T0 + 59 * SECOND })[0]).toBe(running);
		expect(canBank(running, T0 + MINUTE)).toBe(true);
	});

	it("banks the focus time put in so far as a partial session", () => {
		const [state, effects] = play(
			initialState,
			start(T0),
			{ type: "pause", now: T0 + 12 * MINUTE },
			{ type: "bank", now: T0 + 30 * MINUTE },
		);
		expect(state).toMatchObject({ phase: "break", run: null });
		expect(effects.at(-1)).toMatchObject({
			type: "finished",
			session: {
				focusMs: 12 * MINUTE,
				plannedMs: 25 * MINUTE,
				endedAt: T0 + 30 * MINUTE,
				kind: "partial",
			},
		});
	});

	it("is refused during breaks", () => {
		const [onBreak] = play(initialState, { type: "selectPhase", phase: "break" }, start(T0));
		expect(canBank(onBreak, T0 + 3 * MINUTE)).toBe(false);
	});
});

describe("reading", () => {
	it("rounds a countdown up, so the last second shows until it is fully spent", () => {
		expect(reading(initialState, T0)).toEqual({ seconds: 25 * 60, counting: "down" });
		const [running] = play(initialState, start(T0));
		expect(reading(running, T0 + 1).seconds).toBe(25 * 60);
		expect(reading(running, T0 + SECOND).seconds).toBe(25 * 60 - 1);
		expect(reading(running, T0 + 25 * MINUTE - 1).seconds).toBe(1);
		expect(reading(running, T0 + 25 * MINUTE).seconds).toBe(0);
	});

	it("rounds a stopwatch down, so a second shows only once it has passed", () => {
		const [armed] = play(initialState, { type: "selectPhase", phase: "stopwatch" });
		expect(reading(armed, T0)).toEqual({ seconds: 0, counting: "up" });
		const [running] = play(armed, start(T0));
		expect(reading(running, T0 + SECOND - 1).seconds).toBe(0);
		expect(reading(running, T0 + SECOND).seconds).toBe(1);
		expect(reading(running, T0 + 61 * MINUTE + 500).seconds).toBe(61 * 60);
	});
});

describe("stopwatch", () => {
	const [armed] = play(initialState, { type: "selectPhase", phase: "stopwatch" });

	it("has no length to set", () => {
		expect(reduce(armed, { type: "setDuration", ms: 50 * MINUTE })[0]).toBe(armed);
	});

	it("freezes while paused and carries on from where it was", () => {
		const [paused] = play(armed, start(T0), { type: "pause", now: T0 + 10 * MINUTE });
		expect(elapsedMs(paused, T0 + 60 * MINUTE)).toBe(10 * MINUTE);
		const [resumed] = play(paused, start(T0 + 60 * MINUTE));
		expect(elapsedMs(resumed, T0 + 61 * MINUTE)).toBe(11 * MINUTE);
	});

	it("announces 25, 50 and 90 minutes", () => {
		const [, effects] = play(
			armed,
			start(T0),
			tick(T0 + 25 * MINUTE - 1),
			tick(T0 + 25 * MINUTE),
			tick(T0 + 50 * MINUTE),
			tick(T0 + 89 * MINUTE),
			tick(T0 + 90 * MINUTE),
			tick(T0 + 170 * MINUTE),
		);
		expect(effects).toEqual([
			{ type: "checkpoint", index: 1, atMs: 25 * MINUTE },
			{ type: "checkpoint", index: 2, atMs: 50 * MINUTE },
			{ type: "checkpoint", index: 3, atMs: 90 * MINUTE },
		]);
	});

	it("fills each stretch at its own pace", () => {
		const [running] = play(armed, start(T0));
		expect(stretchesDone(running, T0 + 12.5 * MINUTE)).toBeCloseTo(0.5);
		expect(stretchesDone(running, T0 + 25 * MINUTE)).toBe(1);
		expect(stretchesDone(running, T0 + 70 * MINUTE)).toBeCloseTo(2.5);
		expect(stretchesDone(running, T0 + 135 * MINUTE)).toBeCloseTo(3.5);
		expect(stretchesDone(running, T0 + 999 * MINUTE)).toBe(4);
	});

	it("cannot be banked before a minute is in", () => {
		const [running] = play(armed, start(T0));
		expect(canBank(running, T0 + 59 * SECOND)).toBe(false);
		expect(canBank(running, T0 + MINUTE)).toBe(true);
	});

	it("banks the time on the clock and stays where it is", () => {
		const [state, effects] = play(
			armed,
			start(T0),
			{ type: "pause", now: T0 + 40 * MINUTE },
			start(T0 + 60 * MINUTE),
			{ type: "bank", now: T0 + 70 * MINUTE },
		);
		// No break is owed and the pomodoro cycle has not moved.
		expect(state).toEqual(armed);
		expect(effects.at(-1)).toEqual({
			type: "finished",
			phase: "stopwatch",
			session: {
				id: "run-1",
				startedAt: T0,
				endedAt: T0 + 70 * MINUTE,
				focusMs: 50 * MINUTE,
				plannedMs: 0,
				kind: "stopwatch",
			},
		});
	});

	it("banks itself at the cap, however long it was left running", () => {
		const [state, effects] = play(armed, start(T0), tick(T0 + 14 * 60 * MINUTE));
		expect(state).toEqual(armed);
		expect(effects.at(-1)).toMatchObject({
			type: "finished",
			session: { focusMs: STOPWATCH_CAP, endedAt: T0 + STOPWATCH_CAP, kind: "stopwatch" },
		});
	});

	it("round-trips through JSON mid-run", () => {
		const [running] = play(armed, start(T0), tick(T0 + 30 * MINUTE));
		const [paused] = play(running, { type: "pause", now: T0 + 31 * MINUTE });
		for (const state of [armed, running, paused]) {
			expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
		}
	});
});

describe("parseState", () => {
	it("round-trips every shape of state through JSON", () => {
		const [running] = play(initialState, start(T0), tick(T0 + 10 * MINUTE));
		const [paused] = play(running, { type: "pause", now: T0 + 11 * MINUTE });
		for (const state of [initialState, running, paused]) {
			expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
		}
	});

	it("rejects anything malformed", () => {
		const [running] = play(initialState, start(T0));
		const bad: unknown[] = [
			null,
			"focus",
			{},
			{ ...initialState, phase: "nap" },
			{ ...initialState, cycle: -1 },
			{ ...initialState, durations: { focus: 5, break: 5 * MINUTE, longBreak: 15 * MINUTE } },
			{ ...running, run: { ...running.run, clock: { kind: "running" } } },
			{ ...running, run: { ...running.run, checkpoint: 9 } },
			{ ...running, run: { ...running.run, clock: { kind: "paused", remainingMs: MAX_DURATION } } },
		];
		for (const value of bad) expect(parseState(value)).toBeNull();
	});
});
