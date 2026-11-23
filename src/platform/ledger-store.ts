import { deposit, type Ledger, parseLedger } from "../core/ledger.ts";
import type { SessionRecord } from "../core/timer.ts";

const KEY = "lockin.ledger.v1";
const LOCK = "lockin.ledger";

export interface DepositResult {
	readonly before: Ledger;
	readonly after: Ledger;
}

export interface LedgerStore {
	read(): Ledger;
	/** Appends a session, serialised across tabs so the chain never forks. */
	deposit(session: SessionRecord): Promise<DepositResult>;
	replace(ledger: Ledger): void;
	/** Fires when another tab changes the ledger. */
	subscribe(listener: (ledger: Ledger) => void): () => void;
}

function read(): Ledger {
	let raw: string | null;
	try {
		raw = localStorage.getItem(KEY);
	} catch {
		return [];
	}
	if (raw === null) return [];
	try {
		const ledger = parseLedger(JSON.parse(raw));
		if (ledger) return ledger;
	} catch {
		// Not JSON at all: handled below with everything else unreadable.
	}
	// Whatever this is, it may be someone's hours. Park it under another key
	// before a fresh ledger gets written over it.
	try {
		localStorage.setItem(`${KEY}.unreadable.${Date.now()}`, raw);
		localStorage.removeItem(KEY);
	} catch {
		// Nothing more can be done from here.
	}
	return [];
}

function write(ledger: Ledger): void {
	localStorage.setItem(KEY, JSON.stringify(ledger));
}

/** Runs `task` while holding the cross-tab ledger lock, where the browser has one. */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
	return navigator.locks ? navigator.locks.request(LOCK, task) : task();
}

export function ledgerStore(): LedgerStore {
	return {
		read,
		deposit: (session) =>
			exclusive(async () => {
				// Read inside the lock: another tab may have deposited since we last looked.
				const before = read();
				const after = await deposit(before, session);
				if (after !== before) write(after);
				return { before, after };
			}),
		replace: write,
		subscribe(listener) {
			const onStorage = (event: StorageEvent) => {
				if (event.storageArea === localStorage && event.key === KEY) listener(read());
			};
			addEventListener("storage", onStorage);
			return () => removeEventListener("storage", onStorage);
		},
	};
}
