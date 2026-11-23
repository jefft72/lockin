import fontUrl from "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url";
import { el, reducedMotion } from "./dom.ts";

export const DIGIT_FAMILY = "Lockin Digits";
const DIGIT_WEIGHT = 900;

/** One full flip at rest pace, and one step of a fast spin, in milliseconds. */
const FLIP_MS = 420;
const SPIN_MS = 96;

/**
 * Loads the digit face and measures where its ink actually sits, so each glyph
 * can be cropped to its exact height and split precisely through the middle.
 * Font metrics are read at runtime rather than hard-coded: the split stays
 * centred even if the face is swapped or falls back.
 */
export async function loadDigitFace(): Promise<void> {
	try {
		const face = new FontFace(DIGIT_FAMILY, `url(${fontUrl}) format("woff2")`, {
			weight: "100 900",
			stretch: "62% 125%",
			display: "block",
		});
		document.fonts.add(await face.load());
	} catch {
		// The fallback face still gets measured below.
	}
	const ctx = document.createElement("canvas").getContext("2d");
	if (!ctx) return;
	const size = 1000;
	ctx.font = `${DIGIT_WEIGHT} ${size}px "${DIGIT_FAMILY}", sans-serif`;
	const m = ctx.measureText("0123456789");
	const inkHeight = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / size;
	// With line-height 1 the font's content area is centred on the line box, so
	// the baseline sits at half a line plus half the ascent/descent imbalance.
	const baseline = 0.5 + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / size / 2;
	const inkTop = baseline - m.actualBoundingBoxAscent / size;
	const root = document.documentElement.style;
	root.setProperty("--ink-h", `${inkHeight.toFixed(4)}em`);
	root.setProperty("--ink-top", `${inkTop.toFixed(4)}em`);
}

function half(side: "top" | "bottom", char: string): HTMLElement {
	return el("span", { class: `half ${side}` }, el("span", { class: "glyph" }, char));
}

function setGlyph(node: HTMLElement, char: string): void {
	(node.firstElementChild as HTMLElement).textContent = char;
}

const DIGITS = "0123456789";

/** The digits to pass through going from one digit to another the short way round. */
export function spinPath(from: string, to: string): string[] {
	const a = DIGITS.indexOf(from);
	const b = DIGITS.indexOf(to);
	if (a < 0 || b < 0 || a === b) return [to];
	const up = (b - a + 10) % 10;
	const step = up <= 5 ? 1 : -1;
	const path: string[] = [];
	for (let i = a; i !== b; ) {
		i = (i + step + 10) % 10;
		path.push(DIGITS.charAt(i));
	}
	return path;
}

/**
 * A single split-flap character. The top half of the old glyph folds down to
 * reveal the new one behind it, then the new bottom half swings into place.
 */
export class FlipCell {
	readonly el: HTMLElement;
	private readonly top: HTMLElement;
	private readonly bottom: HTMLElement;
	/** The glyph the cell is heading for, which may still be mid-flip. */
	private target: string;
	/** The glyph fully shown right now. */
	private shown: string;
	private queue: string[] = [];
	private busy = false;

	constructor(char: string) {
		this.target = char;
		this.shown = char;
		this.top = half("top", char);
		this.bottom = half("bottom", char);
		this.el = el("span", { class: "flip" }, this.top, this.bottom);
	}

	get value(): string {
		return this.target;
	}

	/**
	 * Shows `char`. Latest call wins: anything still queued is dropped. `path`
	 * lists glyphs to flip through on the way, ending with `char`.
	 */
	set(char: string, path: string[] = [char], delayMs = 0): void {
		if (char === this.target) return;
		this.target = char;
		if (reducedMotion() || document.hidden) {
			this.queue = [];
			this.snap(char);
			return;
		}
		this.queue = path;
		if (!this.busy) void this.drain(delayMs);
	}

	private snap(char: string): void {
		this.shown = char;
		setGlyph(this.top, char);
		setGlyph(this.bottom, char);
	}

	private async drain(delayMs: number): Promise<void> {
		this.busy = true;
		if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
		for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
			// More to come after this one means we are spinning: go fast.
			await this.flip(next, this.queue.length > 0 ? SPIN_MS : FLIP_MS);
		}
		this.busy = false;
		// A hidden tab snaps instead of animating and may have moved on meanwhile.
		if (this.shown !== this.target) this.snap(this.target);
	}

	private async flip(next: string, duration: number): Promise<void> {
		if (next === this.shown) return;
		const out = half("top", this.shown);
		const into = half("bottom", next);
		out.classList.add("flap");
		into.classList.add("flap");
		into.style.transform = "rotateX(90deg)";
		setGlyph(this.top, next);
		this.el.append(out, into);
		const lit = "brightness(1)";
		const shaded = "brightness(0.3)";
		try {
			await out.animate(
				[
					{ transform: "rotateX(0deg)", filter: lit },
					{ transform: "rotateX(-90deg)", filter: shaded },
				],
				{ duration: duration * 0.45, easing: "cubic-bezier(0.55, 0, 0.9, 0.5)", fill: "forwards" },
			).finished;
			out.remove();
			await into.animate(
				[
					{ transform: "rotateX(90deg)", filter: shaded },
					{ transform: "rotateX(0deg)", filter: lit },
				],
				{
					duration: duration * 0.55,
					easing: "cubic-bezier(0.2, 0.9, 0.3, 1.25)",
					fill: "forwards",
				},
			).finished;
		} catch {
			// The animation was cancelled (the node left the page). Land the glyph anyway.
		}
		out.remove();
		into.remove();
		this.snap(next);
	}
}
