import { clockDigits } from "../core/format.ts";
import { el } from "./dom.ts";
import { FlipCell, spinPath } from "./flip.ts";

/** Delay between neighbouring digits when the whole clock spins to a new time. */
const STAGGER_MS = 45;

/** The big MM:SS readout, one split-flap cell per digit. */
export class ClockView {
	readonly el: HTMLElement;
	private readonly minutesEl = el("span", { class: "group", "aria-hidden": "true" });
	private readonly secondsEl = el("span", { class: "group", "aria-hidden": "true" });
	private minutes: FlipCell[] = [];
	private readonly seconds: FlipCell[];

	constructor(remainingMs: number) {
		const digits = clockDigits(remainingMs);
		this.seconds = [...digits.seconds].map((char) => new FlipCell(char));
		this.secondsEl.append(...this.seconds.map((cell) => cell.el));
		this.rebuildMinutes(digits.minutes);
		const colon = el("span", { class: "colon", "aria-hidden": "true" }, el("i"), el("i"));
		this.el = el(
			"div",
			{ class: "clock", role: "timer", "aria-live": "off" },
			this.minutesEl,
			colon,
			this.secondsEl,
		);
		this.label(digits);
	}

	/**
	 * Shows a time. A plain update flips only the digits that changed; `spin`
	 * rolls every changed digit through the ones in between, left to right.
	 */
	render(remainingMs: number, spin: boolean): void {
		const digits = clockDigits(remainingMs);
		if (digits.minutes.length !== this.minutes.length) this.rebuildMinutes(digits.minutes);
		const cells = [...this.minutes, ...this.seconds];
		const chars = [...digits.minutes, ...digits.seconds];
		cells.forEach((cell, i) => {
			const char = chars[i] as string;
			if (spin) cell.set(char, spinPath(cell.value, char), i * STAGGER_MS);
			else cell.set(char);
		});
		this.label(digits);
	}

	private rebuildMinutes(minutes: string): void {
		this.minutes = [...minutes].map((char) => new FlipCell(char));
		this.minutesEl.replaceChildren(...this.minutes.map((cell) => cell.el));
	}

	private label(digits: { minutes: string; seconds: string }): void {
		this.el.setAttribute("data-wide", String(digits.minutes.length > 2));
		this.el.setAttribute("aria-label", `${digits.minutes}:${digits.seconds} remaining`);
	}
}
