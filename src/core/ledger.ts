import type { SessionRecord } from "./timer.ts";

/**
 * The bank is an append-only ledger. Each entry commits to the one before it
 * by hash, so a session cannot be edited, removed or slipped in after the fact
 * without breaking every entry that follows. Nobody can quietly pad the bank,
 * including its owner.
 */
export interface LedgerEntry extends SessionRecord {
	readonly seq: number;
	readonly prev: string;
	readonly hash: string;
}

export type Ledger = readonly LedgerEntry[];

export type Audit = { readonly ok: true } | { readonly ok: false; readonly brokenAt: number };

export const GENESIS = "0".repeat(64);

type Unsealed = Omit<LedgerEntry, "hash">;

async function seal(entry: Unsealed): Promise<string> {
	// A JSON array is an unambiguous encoding: no field can bleed into the next.
	const canonical = JSON.stringify([
		entry.prev,
		entry.seq,
		entry.id,
		entry.startedAt,
		entry.endedAt,
		entry.focusMs,
		entry.plannedMs,
		entry.kind,
	]);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Appends a session. Idempotent on the session id: depositing the same session
 * twice (two tabs finishing the same run) returns the ledger unchanged.
 */
export async function deposit(ledger: Ledger, session: SessionRecord): Promise<Ledger> {
	if (ledger.some((entry) => entry.id === session.id)) return ledger;
	const unsealed: Unsealed = {
		...session,
		seq: ledger.length + 1,
		prev: ledger.at(-1)?.hash ?? GENESIS,
	};
	return [...ledger, { ...unsealed, hash: await seal(unsealed) }];
}

/** Recomputes the whole chain and reports the first entry that does not hold. */
export async function audit(ledger: Ledger): Promise<Audit> {
	let prev = GENESIS;
	const seen = new Set<string>();
	for (const [index, entry] of ledger.entries()) {
		const seq = index + 1;
		const { hash, ...unsealed } = entry;
		const intact =
			entry.seq === seq &&
			entry.prev === prev &&
			!seen.has(entry.id) &&
			hash === (await seal(unsealed));
		if (!intact) return { ok: false, brokenAt: seq };
		seen.add(entry.id);
		prev = hash;
	}
	return { ok: true };
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isHash(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function parseEntry(value: unknown): LedgerEntry | null {
	if (typeof value !== "object" || value === null) return null;
	const v = value as Record<string, unknown>;
	if (typeof v.id !== "string" || v.id === "") return null;
	if (!isCount(v.seq) || !isCount(v.startedAt) || !isCount(v.endedAt)) return null;
	if (!isCount(v.focusMs) || !isCount(v.plannedMs)) return null;
	if (v.kind !== "full" && v.kind !== "partial" && v.kind !== "stopwatch") return null;
	if (!isHash(v.prev) || !isHash(v.hash)) return null;
	return {
		id: v.id,
		startedAt: v.startedAt,
		endedAt: v.endedAt,
		focusMs: v.focusMs,
		plannedMs: v.plannedMs,
		kind: v.kind,
		seq: v.seq,
		prev: v.prev,
		hash: v.hash,
	};
}

/**
 * Checks the shape of stored or imported JSON. Shape only: whether the chain
 * holds is `audit`'s job, so a tampered ledger still loads and can be shown as
 * tampered rather than silently vanishing.
 */
export function parseLedger(value: unknown): Ledger | null {
	if (!Array.isArray(value)) return null;
	const entries: LedgerEntry[] = [];
	for (const item of value) {
		const entry = parseEntry(item);
		if (!entry) return null;
		entries.push(entry);
	}
	return entries;
}
