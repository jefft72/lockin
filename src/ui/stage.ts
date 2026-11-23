import { spanText } from "../core/format.ts";
import {
	canBank,
	MINUTE,
	PHASES,
	type Phase,
	progress,
	remainingMs,
	STRETCHES,
	type TimerState,
} from "../core/timer.ts";
import { ClockView } from "./clock.ts";
import { button, el, reducedMotion, setText } from "./dom.ts";

export interface StageActions {
	toggle(): void;
	reset(): void;
	bank(): void;
	adjust(deltaMs: number): void;
	setDuration(ms: number): void;
	selectPhase(phase: Phase): void;
}

const PHASE_LABELS: Record<Phase, string> = {
	focus: "focus",
	break: "break",
	longBreak: "long break",
};

/** Scroll distance over the clock that changes the duration by one minute. */
const WHEEL_STEP_PX = 100;
/** A pause this long between wheel events starts a fresh gesture. */
const WHEEL_IDLE_MS = 250;

const PRESETS = [15, 25, 45, 60, 90];
const STEPS = [-5, -1, 1, 5];

/** The left side of the screen: phase tabs, the clock, checkpoints and controls. */
export class Stage {
	readonly el: HTMLElement;
	readonly actions: StageActions;
	/** Slot at the bottom of the stage for the now-playing strip. */
	readonly footer = el("footer", { class: "stage-footer" });
	private readonly clock: ClockView;
	private readonly phaseButtons = new Map<Phase, HTMLButtonElement>();
	private readonly presetButtons = new Map<number, HTMLButtonElement>();
	private readonly adjustRow = el("div", { class: "row adjust" });
	private readonly segments: HTMLElement[] = [];
	private readonly status = el("p", { class: "status", "aria-live": "polite" });
	private readonly toggleButton = button("start", { class: "primary" });
	private readonly resetButton = button("reset");
	private readonly bankButton = button("bank");
	private statusTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(state: TimerState, now: number, actions: StageActions) {
		this.actions = actions;
		this.clock = new ClockView(remainingMs(state, now));

		const phases = el("nav", { class: "row phases", "aria-label": "phase" });
		for (const phase of PHASES) {
			const tab = button(PHASE_LABELS[phase]);
			tab.addEventListener("click", () => actions.selectPhase(phase));
			this.phaseButtons.set(phase, tab);
			phases.append(tab);
		}
		const keys = el(
			"p",
			{ class: "keys" },
			"space start/pause · ↑↓ minutes · 0-9 type minutes · ←→ phase · r reset · b bank · m mute",
		);

		const stepButton = (minutes: number) => {
			const label = `${minutes > 0 ? "+" : "−"}${Math.abs(minutes)}`;
			const title = `${minutes > 0 ? "add" : "remove"} ${Math.abs(minutes)} min`;
			const step = button(label, { "aria-label": title, title });
			step.addEventListener("click", () => actions.adjust(minutes * MINUTE));
			return step;
		};
		const presets = PRESETS.map((minutes) => {
			const preset = button(String(minutes), { "aria-label": `${minutes} minutes` });
			preset.addEventListener("click", () => actions.setDuration(minutes * MINUTE));
			this.presetButtons.set(minutes, preset);
			return preset;
		});
		const [minusFive, minusOne, plusOne, plusFive] = STEPS.map(stepButton) as [
			HTMLButtonElement,
			HTMLButtonElement,
			HTMLButtonElement,
			HTMLButtonElement,
		];
		this.adjustRow.append(minusFive, minusOne, ...presets, plusOne, plusFive);

		const track = el("div", { class: "checkpoints", "aria-hidden": "true" });
		for (let i = 0; i < STRETCHES; i++) {
			const segment = el("i");
			this.segments.push(segment);
			track.append(segment);
		}

		this.toggleButton.addEventListener("click", () => actions.toggle());
		this.resetButton.addEventListener("click", () => actions.reset());
		this.bankButton.addEventListener("click", () => actions.bank());
		const controls = el(
			"div",
			{ class: "row controls" },
			this.toggleButton,
			this.resetButton,
			this.bankButton,
		);

		// A mouse wheel arrives in notches, a trackpad as a stream of pixels. Both
		// are summed and turned into one-minute steps, so a swipe does not send
		// the duration flying.
		let scrolled = 0;
		let scrolledAt = 0;
		this.clock.el.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				if (event.timeStamp - scrolledAt > WHEEL_IDLE_MS) scrolled = 0;
				scrolledAt = event.timeStamp;
				scrolled +=
					event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * 40;
				const steps = Math.trunc(scrolled / WHEEL_STEP_PX);
				if (steps === 0) return;
				scrolled -= steps * WHEEL_STEP_PX;
				// Scrolling up adds time.
				actions.adjust(-steps * MINUTE);
			},
			{ passive: false },
		);

		this.el = el(
			"section",
			{ class: "stage" },
			el("header", { class: "stage-header" }, phases, keys),
			el(
				"div",
				{ class: "centre" },
				// The checkpoint track shares the clock's box so it is exactly as wide.
				el("div", { class: "readout" }, this.clock.el, track),
				this.status,
				this.adjustRow,
				controls,
			),
			this.footer,
		);
		this.render(state, now, false);
	}

	render(state: TimerState, now: number, spin: boolean): void {
		const { run, phase } = state;
		const idle = run === null;
		const paused = run?.clock.kind === "paused";

		this.clock.render(remainingMs(state, now), spin);
		this.clock.el.classList.toggle("paused", paused);

		for (const [name, tab] of this.phaseButtons) {
			tab.setAttribute("aria-pressed", String(name === phase));
			tab.disabled = !idle && name !== phase;
		}

		const armedMinutes = state.durations[phase] / MINUTE;
		this.adjustRow.inert = !idle;
		for (const [minutes, preset] of this.presetButtons) {
			preset.setAttribute("aria-pressed", String(idle && minutes === armedMinutes));
		}

		const done = progress(state, now) * STRETCHES;
		this.segments.forEach((segment, i) => {
			const fill = Math.min(1, Math.max(0, done - i)).toFixed(3);
			if (segment.style.getPropertyValue("--fill") !== fill)
				segment.style.setProperty("--fill", fill);
		});
		this.segments[0]?.parentElement?.classList.toggle("off", idle || phase !== "focus");

		setText(this.toggleButton, idle ? "start" : paused ? "resume" : "pause");
		this.resetButton.disabled = idle;
		const bankable = canBank(state, now);
		this.bankButton.disabled = !bankable;
		const banked = run ? run.totalMs - remainingMs(state, now) : 0;
		setText(this.bankButton, bankable ? `bank ${spanText(banked)}` : "bank");
		this.bankButton.title = bankable
			? "end the session now and bank the time so far"
			: "bank a session early once a minute of focus is in";

		if (!this.statusTimer) setText(this.status, paused ? "paused" : "");
	}

	/** Shows a short message under the clock, then lets the resting text return. */
	announce(text: string, holdMs = 4000): void {
		clearTimeout(this.statusTimer);
		this.status.textContent = text;
		this.statusTimer = setTimeout(() => {
			this.statusTimer = undefined;
			this.status.textContent = "";
		}, holdMs);
	}

	/** Blinks the stretch that was just completed. */
	markCheckpoint(index: number): void {
		const segment = this.segments[index - 1];
		if (!segment || reducedMotion()) return;
		const blink = [1, 0, 1, 0, 1].map((opacity) => ({ opacity, easing: "step-end" }));
		segment.animate(blink, { duration: 900 });
	}

	/** Cuts the whole screen to white and back when a run ends. */
	flash(): void {
		if (reducedMotion()) return;
		document.body.animate([{ filter: "invert(1)" }, { filter: "invert(0)" }], {
			duration: 420,
			easing: "step-end",
		});
	}
}
