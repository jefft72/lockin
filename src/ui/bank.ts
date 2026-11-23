import { spanText } from "../core/format.ts";
import type { Audit, Ledger, LedgerEntry } from "../core/ledger.ts";
import { REWARDS } from "../core/rewards.ts";
import { type Day, recentDays, summarize } from "../core/stats.ts";
import { MINUTE } from "../core/timer.ts";
import { ACTIVITY_DAYS, BankInsights } from "./bank-insights.ts";
import { button, el, reducedMotion } from "./dom.ts";
import { FlipText } from "./flip-text.ts";

export interface BankActions {
	exportLedger(): void;
	importLedger(file: File): void;
}

const DAYS_SHOWN = 7;
const CHART_HEIGHT = 168;
/** Tallest a block is allowed to be drawn, in pixels per banked minute. */
const MAX_SCALE = 1.2;
const BLOCK_GAP = 2;

const timeOf = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateOf = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const weekdayOf = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

type Tab = "sessions" | "rewards";

/** The right side of the screen: everything banked so far, stacked by day. */
export class BankView {
	readonly el: HTMLElement;
	private readonly total = new FlipText("0m");
	private readonly today = el("p");
	private readonly streak = el("p");
	private readonly insights = new BankInsights();
	private readonly chart = el("div", { class: "stacks", role: "img" });
	private readonly list = el("ol", { class: "list" });
	private readonly tabs = new Map<Tab, HTMLButtonElement>();
	private readonly auditLine = el("p", { class: "audit", "aria-live": "polite" });
	private readonly notice = el("p", { class: "notice", "aria-live": "polite" });
	private tab: Tab = "sessions";
	private ledger: Ledger = [];
	private now = 0;

	constructor(actions: BankActions) {
		const tabs = el("nav", { class: "row tabs", "aria-label": "bank" });
		for (const tab of ["sessions", "rewards"] as const) {
			const control = button(tab);
			control.addEventListener("click", () => {
				this.tab = tab;
				this.renderList();
			});
			this.tabs.set(tab, control);
			tabs.append(control);
		}

		const picker = el("input", { type: "file", accept: "application/json,.json", hidden: "" });
		picker.addEventListener("change", () => {
			const file = picker.files?.[0];
			if (file) actions.importLedger(file);
			picker.value = "";
		});
		const exportButton = button("export");
		exportButton.addEventListener("click", () => actions.exportLedger());
		const importButton = button("import");
		importButton.addEventListener("click", () => picker.click());

		this.total.el.classList.add("total");
		this.el = el(
			"aside",
			{ class: "bank", "aria-label": "bank" },
			el("header", {}, el("p", {}, "bank"), this.total.el, this.today, this.streak),
			el("div", { class: "bank-activity" }, this.chart, this.insights.el),
			tabs,
			this.list,
			el(
				"footer",
				{},
				this.auditLine,
				el("div", { class: "row" }, exportButton, importButton, picker),
				this.notice,
			),
		);
	}

	/** Redraws from the ledger. `droppedId` names a session to drop onto its stack. */
	render(ledger: Ledger, now: number, droppedId?: string): void {
		this.ledger = ledger;
		this.now = now;
		const summary = summarize(ledger, now);
		this.total.set(spanText(summary.totalMs));
		this.today.replaceChildren(
			"today ",
			el("b", {}, spanText(summary.todayMs)),
			` · ${summary.todaySessions} ${summary.todaySessions === 1 ? "session" : "sessions"}`,
		);
		this.streak.replaceChildren(
			"streak ",
			el("b", {}, `${summary.streakDays} ${summary.streakDays === 1 ? "day" : "days"}`),
		);
		const days = recentDays(ledger, now, ACTIVITY_DAYS);
		this.renderChart(days.slice(-DAYS_SHOWN), droppedId);
		this.insights.render(days);
		this.renderList();
	}

	setAudit(audit: Audit, entries: number): void {
		this.auditLine.classList.toggle("broken", !audit.ok);
		this.auditLine.textContent = audit.ok
			? `ledger verified · ${entries} ${entries === 1 ? "entry" : "entries"}`
			: `ledger broken at #${audit.brokenAt}`;
	}

	say(text: string): void {
		this.notice.textContent = text;
	}

	private renderChart(days: readonly Day[], droppedId?: string): void {
		const busiest = Math.max(...days.map((day) => day.focusMs)) / MINUTE;
		const scale = Math.min(MAX_SCALE, CHART_HEIGHT / Math.max(busiest, 1));
		const banked = days.reduce((total, day) => total + day.focusMs, 0);
		this.chart.setAttribute(
			"aria-label",
			`${spanText(banked)} banked in the last ${DAYS_SHOWN} days`,
		);

		this.chart.replaceChildren(
			...days.map((day, index) => {
				const stack = el("div", { class: "stack" });
				for (const entry of day.entries) {
					const height = Math.max(3, (entry.focusMs / MINUTE) * scale - BLOCK_GAP);
					const block = el("i", {
						class: entry.kind,
						style: `height:${height.toFixed(1)}px`,
						title: `${spanText(entry.focusMs)} · ${timeOf.format(entry.endedAt)}`,
					});
					if (entry.id === droppedId) drop(block);
					stack.append(block);
				}
				const isToday = index === days.length - 1;
				const label = el("span", isToday ? { class: "now" } : {}, weekdayOf.format(day.time));
				return el("div", { class: "day", title: dateOf.format(day.time) }, stack, label);
			}),
		);
	}

	private renderList(): void {
		for (const [tab, control] of this.tabs)
			control.setAttribute("aria-pressed", String(tab === this.tab));
		this.list.replaceChildren(
			...(this.tab === "sessions" ? this.sessionRows() : this.rewardRows()),
		);
	}

	private sessionRows(): HTMLElement[] {
		if (this.ledger.length === 0) return [el("li", { class: "empty" }, "nothing banked yet")];
		return this.ledger
			.toReversed()
			.map((entry: LedgerEntry) =>
				el(
					"li",
					{ class: "session" },
					el("span", {}, `#${entry.seq}`),
					el("span", {}, `${dateOf.format(entry.endedAt)} ${timeOf.format(entry.endedAt)}`),
					el("b", {}, spanText(entry.focusMs) + (entry.kind === "partial" ? "*" : "")),
					el("span", { class: "hash", title: entry.hash }, entry.hash.slice(0, 8)),
				),
			);
	}

	private rewardRows(): HTMLElement[] {
		const summary = summarize(this.ledger, this.now);
		const scored = REWARDS.map((reward) => ({ reward, progress: reward.progress(summary) }));
		const earnedCount = scored.filter((row) => row.progress >= 1).length;
		const heading = el("li", { class: "empty" }, `${earnedCount} of ${REWARDS.length} earned`);
		const rows = scored.map(({ reward, progress }) =>
			progress >= 1
				? el("li", { class: "reward earned" }, el("b", {}, reward.label.toLowerCase()))
				: el(
						"li",
						{ class: "reward" },
						el("span", {}, reward.hint),
						el("span", {}, `${Math.floor(progress * 100)}%`),
					),
		);
		return [heading, ...rows];
	}
}

/** A banked session falls onto its stack and settles. */
function drop(block: HTMLElement): void {
	if (reducedMotion()) return;
	// Animate once the block is in the page and has a size.
	requestAnimationFrame(() => {
		block.animate(
			[
				{ transform: `translateY(-${CHART_HEIGHT}px)`, easing: "cubic-bezier(0.5, 0, 1, 0.6)" },
				{ transform: "translateY(0)", offset: 0.7, easing: "ease-out" },
				{ transform: "translateY(-7px)", offset: 0.85, easing: "ease-in" },
				{ transform: "translateY(0)" },
			],
			{ duration: 620, delay: 250, fill: "backwards" },
		);
	});
}
