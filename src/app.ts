import { clockText, spanText } from "./core/format.ts";
import { audit, type Ledger, parseLedger } from "./core/ledger.ts";
import { newlyEarned } from "./core/rewards.ts";
import { dayKey } from "./core/stats.ts";
import {
	initialState,
	MINUTE,
	PHASES,
	parseState,
	reduce,
	remainingMs,
	type SessionRecord,
	STRETCHES,
	type TimerEffect,
	type TimerEvent,
	type TimerState,
} from "./core/timer.ts";
import { Chime } from "./platform/chime.ts";
import { ledgerStore } from "./platform/ledger-store.ts";
import { watchNowPlaying } from "./platform/now-playing-client.ts";
import { jsonStore } from "./platform/storage.ts";
import { startTicker } from "./platform/ticker.ts";
import { ScreenAwake } from "./platform/wakelock.ts";
import { BankView } from "./ui/bank.ts";
import { Board } from "./ui/board.ts";
import { button } from "./ui/dom.ts";
import { NowPlayingView } from "./ui/now-playing.ts";
import { Stage } from "./ui/stage.ts";

/** How long typed digits keep accumulating into one number of minutes. */
const TYPING_WINDOW_MS = 1500;

/** Time for a freshly banked block to fall and settle before any reward is shown. */
const BOARD_DELAY_MS = 1200;

interface Prefs {
	readonly sound: boolean;
}

function parsePrefs(value: unknown): Prefs | null {
	if (typeof value !== "object" || value === null) return null;
	const { sound } = value as Record<string, unknown>;
	return typeof sound === "boolean" ? { sound } : null;
}

function download(name: string, text: string): void {
	const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}

export function startApp(root: HTMLElement): void {
	const timerStore = jsonStore("lockin.timer.v1", parseState);
	let state: TimerState = timerStore.load() ?? initialState;

	const prefsStore = jsonStore("lockin.prefs.v1", parsePrefs);
	const chime = new Chime();
	chime.enabled = prefsStore.load()?.sound ?? true;
	const awake = new ScreenAwake();
	const board = new Board();

	const stage = new Stage(state, Date.now(), {
		toggle: () => {
			const now = Date.now();
			chime.unlock();
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

	const soundButton = button("");
	const setSound = (on: boolean) => {
		chime.enabled = on;
		soundButton.textContent = on ? "sound on" : "sound off";
		soundButton.setAttribute("aria-pressed", String(on));
	};
	setSound(chime.enabled);
	soundButton.addEventListener("click", () => {
		setSound(!chime.enabled);
		prefsStore.save({ sound: chime.enabled });
		chime.unlock();
	});

	const nowPlaying = new NowPlayingView((command) => music.send(command));
	const music = watchNowPlaying((sample, at) => nowPlaying.update(sample, at));
	stage.footer.append(nowPlaying.el, soundButton);

	const bankStore = ledgerStore();
	let ledger: Ledger = bankStore.read();
	let today = dayKey(Date.now());
	const bank = new BankView({
		exportLedger: () => {
			download(`lockin-ledger-${dayKey(Date.now())}.json`, JSON.stringify(ledger, null, "\t"));
		},
		importLedger: (file) => void importLedger(file),
	});

	/** Redraws the bank and re-verifies the chain behind it. */
	function showLedger(next: Ledger, droppedId?: string): void {
		ledger = next;
		bank.render(ledger, Date.now(), droppedId);
		void audit(next).then((result) => {
			// A newer ledger may have arrived while this one was being hashed.
			if (ledger === next) bank.setAudit(result, next.length);
		});
	}

	async function bankSession(session: SessionRecord): Promise<void> {
		const { before, after } = await bankStore.deposit(session);
		showLedger(after, session.id);
		// If another tab banked this same session first, nothing is new here and
		// that tab does the celebrating.
		if (after === before) return;
		stage.announce(`banked ${spanText(session.focusMs)}`);
		// Let the block land on its stack before the board covers the screen.
		const rewards = newlyEarned(before, after).map((reward) => reward.label);
		setTimeout(() => board.announce(rewards), BOARD_DELAY_MS);
	}

	async function importLedger(file: File): Promise<void> {
		let imported: Ledger | null = null;
		try {
			imported = parseLedger(JSON.parse(await file.text()));
		} catch {
			// Reported below along with every other unreadable file.
		}
		if (!imported) return bank.say("import refused: not a ledger file");
		const result = await audit(imported);
		if (!result.ok) return bank.say(`import refused: chain broken at #${result.brokenAt}`);
		// Importing a longer copy of the same chain is a plain restore. Anything
		// else throws banked sessions away, so it has to be said out loud.
		const extendsCurrent = ledger.every((entry, i) => imported[i]?.hash === entry.hash);
		if (!extendsCurrent) {
			const ok = confirm(
				`Replace the ${ledger.length} banked sessions here with the ${imported.length} in this file?`,
			);
			if (!ok) return;
		}
		bankStore.replace(imported);
		showLedger(imported);
		bank.say(`imported ${imported.length} ${imported.length === 1 ? "entry" : "entries"}`);
	}

	root.append(stage.el, bank.el, board.el);
	showLedger(ledger);
	bankStore.subscribe((next) => showLedger(next));

	function render(spin: boolean): void {
		const now = Date.now();
		stage.render(state, now, spin);
		const label = state.phase === "focus" ? "focus" : "break";
		document.title = state.run ? `${clockText(remainingMs(state, now))} ${label}` : "lockin";
		awake.set(state.run?.clock.kind === "running");
		nowPlaying.tick(now);
		// The bank is drawn relative to today, so it turns over at midnight.
		if (dayKey(now) !== today) {
			today = dayKey(now);
			bank.render(ledger, now);
		}
	}

	function handle(effect: TimerEffect): void {
		switch (effect.type) {
			case "checkpoint":
				chime.checkpoint();
				stage.markCheckpoint(effect.index);
				stage.announce(`checkpoint ${effect.index}/${STRETCHES - 1}`);
				break;
			case "finished":
				chime.finish();
				stage.flash();
				if (effect.session) void bankSession(effect.session);
				else stage.announce("break over");
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

	// A mouse click should not leave focus parked on the button, or the next
	// press of space would repeat that click instead of starting the timer.
	// Keyboard focus (detail 0) is left alone so tabbing still works.
	addEventListener("click", (event) => {
		if (event.detail > 0 && event.target instanceof HTMLButtonElement) event.target.blur();
	});

	let typed = "";
	let typedAt = 0;
	addEventListener("keydown", (event) => {
		if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
		if (board.open) {
			// Any key clears the board, and only that: no stray start or reset.
			board.dismiss();
			event.preventDefault();
			return;
		}
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
			case "m":
				soundButton.click();
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
