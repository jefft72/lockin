import "./reward-board.css";
import { button, el, reducedMotion } from "./dom.ts";
import { FlipCell } from "./flip.ts";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const STAGGER_MS = 55;
const HOLD_MS = 3200;
/** Generous upper bound for one cell to finish flipping, used to pace the queue. */
const SETTLE_MS = 700;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const randomGlyph = () => GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));

/** A departure-board ceremony for milestones, with one slot per reward. */
export class Board {
	readonly el = el("dialog", { class: "board reward-board", hidden: "" });
	private readonly line = el("div", { class: "board-line", "aria-hidden": "true" });
	private readonly current = el("p", { class: "reward-board-live", "aria-live": "polite" });
	private readonly count = el("span", { class: "reward-board-count", "aria-hidden": "true" });
	private readonly continue = button("continue", { class: "reward-board-continue", autofocus: "" });
	private queue: string[] = [];
	private running = false;
	/** Bumped on dismissal so a sequence in flight knows to stop. */
	private generation = 0;

	constructor() {
		this.el.append(
			el(
				"div",
				{ class: "reward-board-panel" },
				el(
					"header",
					{ class: "reward-board-header", "aria-hidden": "true" },
					el("span", { class: "reward-board-chip" }, "◆"),
					el("span", {}, "FOCUS BANK / MILESTONE UNLOCKED"),
					this.count,
				),
				this.line,
				this.current,
				el("footer", { class: "reward-board-footer" }, this.continue),
			),
		);
		this.continue.addEventListener("click", () => this.dismiss());
		this.el.addEventListener("click", (event) => {
			if (event.target === this.el) this.dismiss();
		});
		this.el.addEventListener("cancel", (event) => {
			event.preventDefault();
			this.dismiss();
		});
		this.el.addEventListener("keydown", (event) => {
			// Preserve keyboard navigation and native activation for the button.
			if (event.key === "Tab" || event.key === "Enter" || event.key === " ") {
				event.stopPropagation();
			}
		});
	}

	get open(): boolean {
		return this.el.open;
	}

	announce(labels: readonly string[]): void {
		this.queue.push(...labels);
		if (!this.running && this.queue.length > 0) void this.run();
	}

	dismiss(): void {
		this.generation += 1;
		this.queue = [];
		this.running = false;
		this.el.close();
		this.el.hidden = true;
		this.line.replaceChildren();
		this.current.textContent = "";
	}

	private async run(): Promise<void> {
		this.running = true;
		const generation = this.generation;
		const alive = () => generation === this.generation;
		const motion = !reducedMotion();
		let index = 0;

		for (let label = this.queue.shift(); label !== undefined; label = this.queue.shift()) {
			this.el.setAttribute("aria-label", `reward: ${label}`);
			this.current.textContent = label;
			index += 1;
			this.count.textContent = `${index} / ${index + this.queue.length}`;
			this.line.style.setProperty("--chars", String(label.length));
			const chars = [...label];
			const cells = chars.map((char) => new FlipCell(motion ? " " : char));
			this.line.replaceChildren(...cells.map((cell) => cell.el));
			if (!this.open) {
				this.el.hidden = false;
				this.el.showModal();
			}
			const settle = motion ? (cells.length - 1) * STAGGER_MS + SETTLE_MS : 0;

			if (motion) {
				chars.forEach((char, i) => {
					cells[i]?.set(char, [randomGlyph(), randomGlyph(), char], i * STAGGER_MS);
				});
			}
			await sleep(settle + HOLD_MS);
			if (!alive()) return;

			// Leave the last milestone readable through the end. Only roll the
			// display away when there is another milestone ready to take its place.
			if (motion && this.queue.length > 0) {
				cells.forEach((cell, i) => {
					cell.set(" ", [" "], i * STAGGER_MS);
				});
				await sleep(settle);
				if (!alive()) return;
			}
		}
		this.dismiss();
	}
}
