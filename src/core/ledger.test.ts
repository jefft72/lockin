import { describe, expect, it } from "vitest";
import { audit, deposit, GENESIS, type Ledger, parseLedger } from "./ledger.ts";
import { MINUTE, type SessionRecord } from "./timer.ts";

const T0 = 1_800_000_000_000;

function session(n: number, overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		id: `session-${n}`,
		startedAt: T0 + n * 60 * MINUTE,
		endedAt: T0 + n * 60 * MINUTE + 25 * MINUTE,
		focusMs: 25 * MINUTE,
		plannedMs: 25 * MINUTE,
		kind: "full",
		...overrides,
	};
}

async function ledgerOf(count: number): Promise<Ledger> {
	let ledger: Ledger = [];
	for (let n = 1; n <= count; n++) ledger = await deposit(ledger, session(n));
	return ledger;
}

describe("deposit", () => {
	it("chains each entry to the one before it", async () => {
		const ledger = await ledgerOf(3);
		expect(ledger.map((entry) => entry.seq)).toEqual([1, 2, 3]);
		expect(ledger[0]?.prev).toBe(GENESIS);
		expect(ledger[1]?.prev).toBe(ledger[0]?.hash);
		expect(ledger[2]?.prev).toBe(ledger[1]?.hash);
		expect(new Set(ledger.map((entry) => entry.hash)).size).toBe(3);
	});

	it("is deterministic", async () => {
		expect(await ledgerOf(3)).toEqual(await ledgerOf(3));
	});

	it("ignores a session that is already banked", async () => {
		const ledger = await ledgerOf(2);
		expect(await deposit(ledger, session(1, { focusMs: 99 * MINUTE }))).toBe(ledger);
	});
});

describe("audit", () => {
	it("passes an empty and an honest ledger", async () => {
		expect(await audit([])).toEqual({ ok: true });
		expect(await audit(await ledgerOf(5))).toEqual({ ok: true });
	});

	it("catches an edited entry", async () => {
		const ledger = await ledgerOf(4);
		const padded = ledger.map((entry) =>
			entry.seq === 2 ? { ...entry, focusMs: 180 * MINUTE } : entry,
		);
		expect(await audit(padded)).toEqual({ ok: false, brokenAt: 2 });
	});

	it("catches a removed entry", async () => {
		const ledger = await ledgerOf(4);
		expect(await audit(ledger.filter((entry) => entry.seq !== 2))).toEqual({
			ok: false,
			brokenAt: 2,
		});
	});

	it("catches reordered entries", async () => {
		const [a, b, c] = await ledgerOf(3);
		expect(await audit([a, c, b] as Ledger)).toEqual({ ok: false, brokenAt: 2 });
	});

	it("catches a forged entry appended without the chain", async () => {
		const ledger = await ledgerOf(2);
		const forged = { ...session(3), seq: 3, prev: GENESIS, hash: "f".repeat(64) };
		expect(await audit([...ledger, forged])).toEqual({ ok: false, brokenAt: 3 });
	});
});

describe("parseLedger", () => {
	it("round-trips through JSON", async () => {
		const ledger = await ledgerOf(3);
		expect(parseLedger(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
	});

	it("accepts stopwatch sessions alongside countdowns", async () => {
		const timed = session(2, { plannedMs: 0, kind: "stopwatch" });
		const ledger = await deposit(await ledgerOf(1), timed);
		expect(parseLedger(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
		expect(await audit(ledger)).toEqual({ ok: true });
	});

	it("keeps a tampered but well-formed ledger so it can be reported", async () => {
		const ledger = await ledgerOf(2);
		const padded = ledger.map((entry) => ({ ...entry, focusMs: 60 * MINUTE }));
		expect(parseLedger(padded)).toEqual(padded);
	});

	it("rejects anything that is not a ledger", async () => {
		const [entry] = await ledgerOf(1);
		const bad: unknown[] = [
			null,
			{},
			"[]",
			[null],
			[{ ...entry, kind: "bonus" }],
			[{ ...entry, hash: "nope" }],
			[{ ...entry, focusMs: -1 }],
			[{ ...entry, id: "" }],
		];
		for (const value of bad) expect(parseLedger(value)).toBeNull();
	});
});
