import { clockText } from "./core/format.ts";
import {
	initialState,
	MINUTE,
	PHASES,
	parseState,
	reduce,
	remainingMs,
	type TimerEffect,
	type TimerEvent,
	type TimerState,
} from "./core/timer.ts";
import { jsonStore } from "./platform/storage.ts";
import { startTicker } from "./platform/ticker.ts";
import { Stage } from "./ui/stage.ts";

/** How long typed digits keep accumulating into one number of minutes. */
const TYPING_WINDOW_MS = 1500;

export function startApp(root: HTMLElement): void {
	const timerStore = jsonStore("lockin.timer.v1", parseState);
	let state: TimerState = timerStore.load() ?? initialState;

	const stage = new Stage(state, Date.now(), {
		toggle: () => {
			const now = Date.now();
			if (state.run?.clock.kind === "running") dispatch({ type: "pause", now });
			else dispatch({ type: "start", now, id: crypto.randomUUID() });
		},
		reset: () => dispatch({ type: "reset" }),
		bank: () => dispatch({ type: "bank", now: Date.now() }),
		adjust: (deltaMs) => {
			dispatch({ type: "setDuration", ms: state.durations[state.phase] + deltaMs });
		},
		setDuration: (ms) => dispatch({ type: "setDuration", ms }),
		selectPhase: (phase) => dispatch({ type: "selectPhase", phase }),
	});
	root.append(stage.el);

	function render(spin: boolean): void {
		const now = Date.now();
		stage.render(state, now, spin);
		const label = state.phase === "focus" ? "focus" : "break";
		document.title = state.run ? `${clockText(remainingMs(state, now))} ${label}` : "lockin";
	}

	function handle(effect: TimerEffect): void {
		switch (effect.type) {
			case "checkpoint":
				stage.markCheckpoint(effect.index);
				stage.announce(`checkpoint ${effect.index}/4`);
				break;
			case "finished":
				stage.flash();
				break;
		}
	}

	function dispatch(event: TimerEvent): void {
		const [next, effects] = reduce(state, event);
		if (next !== state) {
			state = next;
			timerStore.save(state);
		}
		// Ticks, starts and pauses move the clock one honest second at a time.
		// Every other change of the reading rolls the digits to their new value.
		const steady = event.type === "tick" || event.type === "start" || event.type === "pause";
		render(!steady || effects.some((effect) => effect.type === "finished"));
		for (const effect of effects) handle(effect);
	}

	const tick = () => dispatch({ type: "tick", now: Date.now() });
	startTicker(tick);
	document.addEventListener("visibilitychange", tick);
	timerStore.subscribe((other) => {
		// Another tab moved the timer: follow it rather than run a second one.
		state = other ?? initialState;
		render(true);
	});

	let typed = "";
	let typedAt = 0;
	addEventListener("keydown", (event) => {
		if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
		const target = event.target;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
		const onButton = target instanceof HTMLButtonElement;
		const step = (event.shiftKey ? 5 : 1) * MINUTE;
		switch (event.key) {
			case " ":
			case "Enter":
				// A focused button already handles its own activation keys.
				if (onButton) return;
				stage.actions.toggle();
				break;
			case "ArrowUp":
				stage.actions.adjust(step);
				break;
			case "ArrowDown":
				stage.actions.adjust(-step);
				break;
			case "ArrowLeft":
			case "ArrowRight": {
				const shift = event.key === "ArrowRight" ? 1 : PHASES.length - 1;
				const phase = PHASES[(PHASES.indexOf(state.phase) + shift) % PHASES.length];
				if (phase) stage.actions.selectPhase(phase);
				break;
			}
			case "r":
				stage.actions.reset();
				break;
			case "b":
				stage.actions.bank();
				break;
			default: {
				if (!/^\d$/.test(event.key) || state.run) return;
				const now = performance.now();
				typed = now - typedAt > TYPING_WINDOW_MS ? event.key : (typed + event.key).slice(-3);
				typedAt = now;
				stage.actions.setDuration(Number(typed) * MINUTE);
			}
		}
		event.preventDefault();
	});
}
