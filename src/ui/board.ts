import { el } from "./dom.ts";
import { FlipCell } from "./flip.ts";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const STAGGER_MS = 55;
const HOLD_MS = 2600;
/** Generous upper bound for one cell to finish flipping, used to pace the queue. */
const SETTLE_MS = 700;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const randomGlyph = () => GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));

/**
 * A full-screen split-flap board that spells out rewards one at a time, the
 * way a departures board turns over a new line.
 */
export class Board {
	readonly el = el("div", { class: "board", hidden: "", role: "status" });
	private readonly caption = el("p", {}, "reward");
	private readonly line = el("div", { class: "board-line", "aria-hidden": "true" });
	private queue: string[] = [];
	private running = false;
	/** Bumped on dismissal so a sequence in flight knows to stop. */
	private generation = 0;

	constructor() {
		this.el.append(this.caption, this.line);
		this.el.addEventListener("click", () => this.dismiss());
	}

	get open(): boolean {
		return !this.el.hidden;
	}

	announce(labels: readonly string[]): void {
		this.queue.push(...labels);
		if (!this.running && this.queue.length > 0) void this.run();
	}

	dismiss(): void {
		this.generation += 1;
		this.queue = [];
		this.running = false;
		this.el.hidden = true;
	}

	private async run(): Promise<void> {
		this.running = true;
		const generation = this.generation;
		const alive = () => generation === this.generation;
		this.el.hidden = false;
		for (let label = this.queue.shift(); label !== undefined; label = this.queue.shift()) {
			this.el.setAttribute("aria-label", `reward: ${label}`);
			this.line.style.setProperty("--chars", String(label.length));
			const cells = [...label].map(() => new FlipCell(" "));
			this.line.replaceChildren(...cells.map((cell) => cell.el));
			const settle = cells.length * STAGGER_MS + SETTLE_MS;

			[...label].forEach((char, i) => {
				cells[i]?.set(char, [randomGlyph(), randomGlyph(), char], i * STAGGER_MS);
			});
			await sleep(settle + HOLD_MS);
			if (!alive()) return;

			cells.forEach((cell, i) => {
				cell.set(" ", [" "], i * STAGGER_MS);
			});
			await sleep(settle);
			if (!alive()) return;
		}
		this.running = false;
		this.el.hidden = true;
	}
}
