import "./reward-board.css";
import { button, el, reducedMotion } from "./dom.ts";

const HOLD_MS = 3600;
const ARRIVAL_MS = 260;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A printed milestone card, with one slot per reward. */
export class Board {
	readonly el = el("dialog", { class: "board reward-board", hidden: "" });
	private readonly line = el("p", { class: "board-line", "aria-hidden": "true" });
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
					el("span", {}, "LOCKIN / THE RECORD"),
					this.count,
				),
				el(
					"div",
					{ class: "reward-board-body" },
					el("span", { class: "reward-board-mark", "aria-hidden": "true" }, "✦"),
					el("p", { class: "reward-board-kicker" }, "Milestone unlocked"),
					this.line,
					this.current,
				),
				el(
					"footer",
					{ class: "reward-board-footer" },
					el("span", {}, "FILED IN YOUR FOCUS LOG"),
					this.continue,
				),
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
			// Keep the title readable immediately; the paper moves, not the letters.
			this.line.textContent = label;
			if (!this.open) {
				this.el.hidden = false;
				this.el.showModal();
			}
			if (motion) {
				this.line.animate(
					[
						{ opacity: 0.7, translate: "0 0.24rem" },
						{ opacity: 1, translate: "0 0" },
					],
					{ duration: ARRIVAL_MS, easing: "ease-out" },
				);
			}
			await sleep(HOLD_MS + (motion ? ARRIVAL_MS : 0));
			if (!alive()) return;
		}
		this.dismiss();
	}
}
