import { spanText } from "../core/format.ts";
import type { Day } from "../core/stats.ts";
import { MINUTE } from "../core/timer.ts";
import { button, el, setText } from "./dom.ts";
import "./bank-insights.css";

const DAYS_PER_WEEK = 7;
export const ACTIVITY_DAYS = 4 * DAYS_PER_WEEK;

const dateLabel = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	month: "short",
	day: "numeric",
});

/** Fixed time thresholds keep the same color on the same day as more time is banked. */
function intensity(ms: number): number {
	if (ms === 0) return 0;
	return ms < 30 * MINUTE ? 1 : ms < 60 * MINUTE ? 2 : ms < 120 * MINUTE ? 3 : 4;
}

/** A 28-day local-calendar view of deposits, with one tab stop and arrow navigation. */
export class BankInsights {
	readonly el: HTMLElement;
	private readonly trend = el("span", { class: "bank-signal-trend" });
	private readonly detail = el("p", { class: "bank-signal-detail", "aria-live": "polite" });
	private readonly cells: HTMLButtonElement[] = [];
	private days: readonly Day[] = [];
	private pinnedKey: string | undefined;
	private previewIndex: number | undefined;

	constructor() {
		const grid = el("div", {
			class: "bank-signal-grid",
			role: "group",
			"aria-label": "Daily focus. Use arrow keys to move, Enter to select.",
		});
		for (let index = 0; index < ACTIVITY_DAYS; index++) {
			const cell = button("", { class: "bank-signal-cell", tabindex: "-1" });
			cell.addEventListener("click", () => {
				this.pinnedKey = this.days[index]?.key;
				this.updateSelection();
			});
			cell.addEventListener("focus", () => this.preview(index));
			cell.addEventListener("blur", () => this.preview());
			cell.addEventListener("pointerenter", ({ pointerType }) => {
				if (pointerType === "mouse") this.preview(index);
			});
			cell.addEventListener("pointerleave", () => {
				this.preview(document.activeElement === cell ? index : undefined);
			});
			this.cells.push(cell);
			grid.append(cell);
		}

		grid.addEventListener("keydown", (event) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (!(event.target instanceof HTMLButtonElement)) return;
			const index = this.cells.indexOf(event.target);
			if (index < 0) return;
			const offsets: Record<string, number> = {
				ArrowLeft: -1,
				ArrowRight: 1,
				ArrowUp: -DAYS_PER_WEEK,
				ArrowDown: DAYS_PER_WEEK,
				Home: -index,
				End: this.cells.length - 1 - index,
			};
			const offset = Object.hasOwn(offsets, event.key) ? offsets[event.key] : undefined;
			if (offset === undefined) return;
			event.preventDefault();
			// Arrow keys belong to the chart here, not the focus timer.
			event.stopPropagation();
			const target = Math.max(0, Math.min(this.cells.length - 1, index + offset));
			this.cells[target]?.focus();
		});

		const legend = el(
			"div",
			{ class: "bank-signal-legend", "aria-hidden": "true", title: "0, <30m, 30m, 1h, 2h+" },
			"Less",
			...Array.from({ length: 5 }, (_, level) => el("i", { "data-level": String(level) })),
			"More",
		);
		this.el = el(
			"section",
			{ class: "bank-signal", "aria-label": "28-day focus activity" },
			el(
				"div",
				{ class: "bank-signal-heading" },
				el("h2", {}, "Focus signal"),
				el("span", {}, "28 days"),
			),
			grid,
			el("div", { class: "bank-signal-caption" }, this.detail, legend),
			this.trend,
		);
	}

	render(days: readonly Day[]): void {
		this.days = days;
		this.cells.forEach((cell, index) => {
			const day = days[index];
			if (!day) return;
			cell.dataset.level = String(intensity(day.focusMs));
			cell.setAttribute("aria-current", index === days.length - 1 ? "date" : "false");
			cell.setAttribute("aria-label", this.describe(day));
		});

		const banked = (range: readonly Day[]) => range.reduce((total, day) => total + day.focusMs, 0);
		const latest = banked(days.slice(-DAYS_PER_WEEK));
		const prior = banked(days.slice(-2 * DAYS_PER_WEEK, -DAYS_PER_WEEK));
		const deltaMinutes = Math.trunc((latest - prior) / MINUTE);
		this.trend.dataset.direction = deltaMinutes > 0 ? "up" : deltaMinutes < 0 ? "down" : "flat";
		this.trend.textContent = deltaMinutes
			? `${deltaMinutes > 0 ? "+" : "−"}${spanText(Math.abs(deltaMinutes) * MINUTE)} vs prior 7d`
			: `${spanText(latest)} banked in last 7d`;
		this.updateSelection();
	}

	private describe(day: Day): string {
		const count = day.entries.length;
		const sessions = `${count} ${count === 1 ? "session" : "sessions"}`;
		return `${dateLabel.format(day.time)} · ${spanText(day.focusMs)} · ${sessions}`;
	}

	private preview(index?: number): void {
		this.previewIndex = index;
		this.updateSelection();
	}

	private updateSelection(): void {
		const pinned = this.days.findIndex((day) => day.key === this.pinnedKey);
		const selected = pinned < 0 ? this.days.length - 1 : pinned;
		const shown = this.previewIndex ?? selected;
		this.cells.forEach((cell, index) => {
			cell.tabIndex = index === shown ? 0 : -1;
			cell.setAttribute("aria-pressed", String(index === selected));
		});
		const day = this.days[shown];
		if (day) setText(this.detail, this.describe(day));
	}
}
