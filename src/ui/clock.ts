import { clockDigits } from "../core/format.ts";
import { el, reducedMotion, setText } from "./dom.ts";

const ADJUST_MS = 240;

/** A typographic timer whose visible text and accessible name stay in sync. */
export class ClockView {
	readonly el: HTMLElement;
	private readonly value = el("span", { class: "clock-value", "aria-hidden": "true" });
	private last = "";
	private adjustment: Animation | undefined;

	constructor(remainingMs: number) {
		this.el = el("div", { class: "clock", role: "timer", "aria-live": "off" }, this.value);
		this.render(remainingMs, false);
	}

	render(remainingMs: number, spin: boolean): void {
		const { minutes, seconds } = clockDigits(remainingMs);
		const time = `${minutes}:${seconds}`;
		if (time === this.last) return;

		this.last = time;
		this.adjustment?.cancel();
		setText(this.value, time);
		this.el.dataset.wide = String(minutes.length > 2);
		this.el.setAttribute("aria-label", `${time} remaining`);
		// Give deliberate user changes a small cue. Ordinary ticks are still.
		if (spin && !reducedMotion()) {
			this.adjustment = this.value.animate(
				[
					{ opacity: 0.5, transform: "translateY(.045em)" },
					{ opacity: 1, transform: "none" },
				],
				{ duration: ADJUST_MS, easing: "ease-out" },
			);
		}
	}
}
