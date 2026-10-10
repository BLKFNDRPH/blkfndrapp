import { test } from "node:test";
import assert from "node:assert/strict";
import { Address, Contract, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  MAX_ATTEMPTS,
  collectEvents,
  cursorAfterPass,
  handleEvents,
  type ContractEvent,
  type EventRow,
  type EventStore,
  type GetEvents,
  type RpcEvent,
} from "./indexer-scan.ts";

/**
 * One indexer pass's read, against a stand-in RPC that pages the way testnet's
 * does: each request scans at most 10,000 ledgers, a short page's cursor marks
 * the end of the window it scanned, and a full page's cursor is its last event.
 *
 * The deploy is project #22's, as testnet recorded it: create_vault in ledger
 * 5088601, whose call emitted two token transfers, the new vault's VAULT/INIT
 * and BOND/POSTED, and last the factory's FACTORY/DEPLOY. Before this pass read
 * new vaults, only the DEPLOY was stored.
 *
 * Run with `npm test`.
 */

const FACTORY = "CBRUIRJXRU6NGHOSF5KMPUOFIXIANCPI43QC6JX2PKNOKD3QSAHPLINO";
const KNOWN_VAULT = "CDP2DACVZYRRVU5DAP3PTARCTEQJG5ZYTAW7RV6HC7A5FXJKXV37EUTW";
const NEW_VAULT = "CDLUNKTDXPCCOEBKE4UCWVVQ2UUCLD43LSCLAO64NKQV2APS7TDTRXAK";
const BUILDER = "GAHZB3XQHP42PHAEM5MB2OQ4OWLYXQLW5B42TDFEQ5EWRCFHQMBCBAI7";
const CID = "bafkreidegkae223zigi4g5ssl3xdxd2nxvmbrahvqf5wb3jibaiqcbqz6y";
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 7));
const STAKER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));

const DEPLOY_LEDGER = 5_088_601;
const SCAN_WINDOW = 10_000;

const pad = (n: bigint | number, width: number) => n.toString().padStart(width, "0");
const toid = (ledger: number, tx: number) => (BigInt(ledger) << 32n) | (BigInt(tx) << 12n);

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const vec = (...items: xdr.ScVal[]) => xdr.ScVal.scvVec(items);
const u64 = (n: number) => nativeToScVal(BigInt(n), { type: "u64" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const str = (s: string) => nativeToScVal(s, { type: "string" });
const addr = (a: string) => new Address(a).toScVal();

function event(
  contract: string,
  ledger: number,
  tx: number,
  index: number,
  topics: string[],
  value: xdr.ScVal,
): RpcEvent {
  return {
    id: `${pad(toid(ledger, tx), 19)}-${pad(index, 10)}`,
    ledger,
    ledgerClosedAt: "2026-10-08T13:36:32Z",
    // As the SDK hands it over: a Contract, not a string.
    contractId: new Contract(contract),
    topic: topics.map(sym),
    value,
  };
}

const CHAIN: RpcEvent[] = [
  // A stake in a vault the pass already watches, before the deploy.
  event(KNOWN_VAULT, DEPLOY_LEDGER - 3_000, 4, 1, ["DEPOSIT", "CONTRIB"], vec(u64(12), addr(STAKER), i128(500_000_000n), i128(500_000_000n))),
  // create_vault for project #22.
  event(TOKEN, DEPLOY_LEDGER, 19, 0, ["transfer"], i128(2_750_000_000n)),
  event(TOKEN, DEPLOY_LEDGER, 19, 1, ["transfer"], i128(10_000_000n)),
  event(NEW_VAULT, DEPLOY_LEDGER, 19, 2, ["VAULT", "INIT"], vec(u64(22), str(CID))),
  event(NEW_VAULT, DEPLOY_LEDGER, 19, 3, ["BOND", "POSTED"], vec(u64(22), i128(2_750_000_000n))),
  event(FACTORY, DEPLOY_LEDGER, 19, 4, ["FACTORY", "DEPLOY"], vec(u64(22), addr(NEW_VAULT), addr(BUILDER), str(CID))),
  // A stake in the new vault before the next pass.
  event(TOKEN, DEPLOY_LEDGER + 40, 3, 0, ["transfer"], i128(1_000_000_000n)),
  event(NEW_VAULT, DEPLOY_LEDGER + 40, 3, 1, ["DEPOSIT", "CONTRIB"], vec(u64(22), addr(STAKER), i128(1_000_000_000n), i128(1_000_000_000n))),
];

function compareIds(a: string, b: string) {
  const [opA, indexA] = a.split("-").map(BigInt);
  const [opB, indexB] = b.split("-").map(BigInt);
  if (opA !== opB) return opA < opB ? -1 : 1;
  return indexA < indexB ? -1 : indexA > indexB ? 1 : 0;
}

function standInRpc(chain: RpcEvent[], latestLedger: number, { unreachable }: { unreachable?: string } = {}) {
  const calls: { contractIds: string[]; startLedger?: number; cursor?: string }[] = [];

  const getEvents: GetEvents = async ({ startLedger, cursor, filters, limit }) => {
    const contractIds = filters.flatMap((f) => f.contractIds);
    calls.push({ contractIds, startLedger, cursor });
    assert.ok(contractIds.length <= 5, "the RPC takes at most five contract ids per filter");
    if (unreachable && contractIds.includes(unreachable)) throw new Error("RPC unavailable");

    const from = cursor ? Number(BigInt(cursor.split("-")[0]) >> 32n) : startLedger!;
    const end = Math.min(from + SCAN_WINDOW - 1, latestLedger);
    const matching = chain
      .filter((e) => contractIds.includes(String(e.contractId)))
      .filter((e) => e.ledger >= from && e.ledger <= end)
      .filter((e) => !cursor || compareIds(e.id, cursor) > 0)
      .sort((a, b) => compareIds(a.id, b.id));

    if (matching.length > limit) {
      const page = matching.slice(0, limit);
      return { events: page, cursor: page[page.length - 1].id, latestLedger };
    }
    const windowEnd = (BigInt(end) << 32n) | 0xffffffffn;
    return { events: matching, cursor: `${pad(windowEnd, 19)}-4294967295`, latestLedger };
  };

  return { getEvents, calls };
}

const kinds = (events: ContractEvent[]) => events.map((e) => `${e.topic1}/${e.topic2}`);

test("a vault deployed inside the range is read from its DEPLOY's ledger", async () => {
  // Three empty scan windows before the deploy, so the factory's group pages.
  const startLedger = DEPLOY_LEDGER - 25_000;
  const latestLedger = DEPLOY_LEDGER + 500;
  const rpc = standInRpc(CHAIN, latestLedger);

  const { events, scannedThrough } = await collectEvents({
    getEvents: rpc.getEvents,
    contractIds: [FACTORY, KNOWN_VAULT],
    startLedger,
    latestLedger,
  });

  assert.deepEqual(kinds(events), [
    "DEPOSIT/CONTRIB",
    // The DEPLOY creates the project row, so it goes before the events its
    // call emitted ahead of it.
    "FACTORY/DEPLOY",
    "VAULT/INIT",
    "BOND/POSTED",
    "DEPOSIT/CONTRIB",
  ]);
  assert.deepEqual(
    events.map((e) => e.contractId),
    [KNOWN_VAULT, FACTORY, NEW_VAULT, NEW_VAULT, NEW_VAULT],
  );

  const [, deploy, init, posted] = events;
  assert.equal(deploy.id, "0021855374877470720-0000000004");
  assert.equal(init.id, "0021855374877470720-0000000002");
  assert.equal(posted.id, "0021855374877470720-0000000003");
  assert.deepEqual(init.payload, [22n, CID]);
  assert.deepEqual(posted.payload, [22n, 2_750_000_000n]);
  assert.equal((deploy.payload as unknown[])[1], NEW_VAULT);

  // The new vault was asked for from its deploy ledger, not from the start.
  assert.ok(
    rpc.calls.some((c) => c.contractIds.join() === NEW_VAULT && c.startLedger === DEPLOY_LEDGER),
  );
  assert.equal(scannedThrough, latestLedger);
});

test("the cursor stops short of the deploy ledger when the new vault can't be read", async (t) => {
  t.mock.method(console, "error", () => {});
  const latestLedger = DEPLOY_LEDGER + 500;
  const rpc = standInRpc(CHAIN, latestLedger, { unreachable: NEW_VAULT });

  const { events, scannedThrough } = await collectEvents({
    getEvents: rpc.getEvents,
    contractIds: [FACTORY, KNOWN_VAULT],
    startLedger: DEPLOY_LEDGER - 25_000,
    latestLedger,
  });

  // The DEPLOY is still handled this pass. The next pass starts at its ledger
  // again, finds the vault watched, and reads its events then.
  assert.deepEqual(kinds(events), ["DEPOSIT/CONTRIB", "FACTORY/DEPLOY"]);
  assert.equal(scannedThrough, DEPLOY_LEDGER - 1);
});

test("a vault already watched is read once", async () => {
  const latestLedger = DEPLOY_LEDGER + 500;
  const rpc = standInRpc(CHAIN, latestLedger);

  const { events, scannedThrough } = await collectEvents({
    getEvents: rpc.getEvents,
    contractIds: [FACTORY, KNOWN_VAULT, NEW_VAULT],
    startLedger: DEPLOY_LEDGER - 100,
    latestLedger,
  });

  assert.deepEqual(kinds(events), ["FACTORY/DEPLOY", "VAULT/INIT", "BOND/POSTED", "DEPOSIT/CONTRIB"]);
  assert.equal(rpc.calls.length, 1);
  assert.equal(scannedThrough, latestLedger);
});

test("after a failure the cursor stops before the failed event's ledger", () => {
  // Everything handled: as far as the scan reached.
  assert.equal(cursorAfterPass({ scannedThrough: 900, handledThrough: 450, failedLedger: null }), 900);
  // The DEPLOY was handled, then the vault's VAULT/INIT in the same ledger
  // failed. Stopping on that ledger would skip BOND/POSTED, never recorded.
  assert.equal(cursorAfterPass({ scannedThrough: 900, handledThrough: 500, failedLedger: 500 }), 499);
  // A failure in a later ledger keeps what was handled before it.
  assert.equal(cursorAfterPass({ scannedThrough: 900, handledThrough: 450, failedLedger: 600 }), 450);
  // Never past a group that stopped scanning early.
  assert.equal(cursorAfterPass({ scannedThrough: 300, handledThrough: 450, failedLedger: 600 }), 300);
});

/**
 * contract_events as the pass sees it, in memory: a new event is recorded as
 * attempt 1, an existing one comes back as its row.
 */
function memoryStore({ failMarkHandled }: { failMarkHandled?: string } = {}) {
  const rows = new Map<string, EventRow>();
  const store: EventStore = {
    async record(event) {
      const row = rows.get(event.id);
      if (row) return { ...row };
      rows.set(event.id, { processedAt: null, attempts: 1, error: null });
      return null;
    },
    async countAttempt(eventId, attempts) {
      rows.get(eventId)!.attempts = attempts;
    },
    async markHandled(eventId) {
      if (eventId === failMarkHandled) {
        failMarkHandled = undefined;
        throw new Error("could not write processed_at");
      }
      Object.assign(rows.get(eventId)!, { processedAt: "2026-10-10T15:00:00Z", error: null });
    },
    async markFailed(eventId, error) {
      rows.get(eventId)!.error = error;
    },
  };
  return { rows, store };
}

/** One pass as runIndexer runs it: read, handle, then move the cursor. */
async function indexPass({
  rpc,
  store,
  handle,
  contractIds,
  startLedger,
  latestLedger,
}: {
  rpc: ReturnType<typeof standInRpc>;
  store: EventStore;
  handle: (event: ContractEvent) => Promise<void>;
  contractIds: string[];
  startLedger: number;
  latestLedger: number;
}) {
  const { events, scannedThrough } = await collectEvents({
    getEvents: rpc.getEvents,
    contractIds,
    startLedger,
    latestLedger,
  });
  const outcome = await handleEvents({ events, startLedger, store, handle });
  const cursor = cursorAfterPass({
    scannedThrough,
    handledThrough: outcome.handledThrough,
    failedLedger: outcome.failedLedger,
  });
  return { ...outcome, cursor: cursor >= startLedger ? cursor : startLedger - 1 };
}

const kind = (e: ContractEvent) => `${e.topic1}/${e.topic2}`;
const DEPLOY_ID = "0021855374877470720-0000000004";

test("a failed DEPLOY is retried by the next pass, ahead of its vault's events", async (t) => {
  t.mock.method(console, "error", () => {});
  const latestLedger = DEPLOY_LEDGER + 500;
  const rpc = standInRpc(CHAIN, latestLedger);
  const { rows, store } = memoryStore();

  const handled: string[] = [];
  const attemptsSeen: number[] = [];
  let deployCalls = 0;
  const handle = async (e: ContractEvent) => {
    if (kind(e) === "FACTORY/DEPLOY") {
      // Counted before the handler runs, so an attempt cut short still counts.
      attemptsSeen.push(rows.get(e.id)!.attempts);
      if (++deployCalls === 1) throw new Error("Vault is not readable");
    }
    handled.push(kind(e));
  };
  // The vault's address reaches `projects` only once its DEPLOY is handled.
  const contractIds = [FACTORY, KNOWN_VAULT];

  const first = await indexPass({ rpc, store, handle, contractIds, startLedger: DEPLOY_LEDGER - 25_000, latestLedger });
  assert.deepEqual(handled, ["DEPOSIT/CONTRIB"]);
  assert.equal(first.failed, 1);
  // The last ledger fully handled: the stake's, before the DEPLOY.
  assert.equal(first.cursor, DEPLOY_LEDGER - 3_000);
  assert.deepEqual(rows.get(DEPLOY_ID), { processedAt: null, attempts: 1, error: "Error: Vault is not readable" });
  // The failure stopped the pass before the vault's own events were recorded.
  assert.equal(rows.size, 2);

  handled.length = 0;
  const second = await indexPass({ rpc, store, handle, contractIds, startLedger: first.cursor + 1, latestLedger });
  // Retried, not skipped as seen, and handled before the vault's events, so
  // they find its project row under its id.
  assert.deepEqual(handled, ["FACTORY/DEPLOY", "VAULT/INIT", "BOND/POSTED", "DEPOSIT/CONTRIB"]);
  assert.equal(second.failed, 0);
  assert.equal(second.processed, 4);
  assert.equal(second.cursor, latestLedger);
  assert.deepEqual(rows.get(DEPLOY_ID), { processedAt: "2026-10-10T15:00:00Z", attempts: 2, error: null });
  assert.deepEqual(attemptsSeen, [1, 2]);

  // Read again from the start, everything is found handled and nothing re-runs.
  handled.length = 0;
  const third = await indexPass({ rpc, store, handle, contractIds, startLedger: DEPLOY_LEDGER - 25_000, latestLedger });
  assert.deepEqual(handled, []);
  assert.equal(third.processed, 0);
  assert.equal(third.cursor, latestLedger);
});

test(`after ${MAX_ATTEMPTS} failed attempts the event is left unprocessed and the cursor moves past it`, async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const latestLedger = DEPLOY_LEDGER + 500;
  const rpc = standInRpc(CHAIN, latestLedger);
  const { rows, store } = memoryStore();

  const handled: string[] = [];
  let deployCalls = 0;
  const handle = async (e: ContractEvent) => {
    if (kind(e) === "FACTORY/DEPLOY") {
      deployCalls++;
      throw new TypeError("(metadata?.milestones ?? []).find is not a function");
    }
    handled.push(kind(e));
  };
  const contractIds = [FACTORY, KNOWN_VAULT];

  let startLedger = DEPLOY_LEDGER - 25_000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const pass = await indexPass({ rpc, store, handle, contractIds, startLedger, latestLedger });
    assert.equal(pass.failed, 1, `pass ${attempt} fails on the DEPLOY`);
    assert.deepEqual(pass.gaveUp, []);
    assert.equal(pass.cursor, DEPLOY_LEDGER - 3_000, `pass ${attempt} holds the cursor before it`);
    assert.equal(rows.get(DEPLOY_ID)!.attempts, attempt);
    startLedger = pass.cursor + 1;
  }
  assert.deepEqual(handled, ["DEPOSIT/CONTRIB"], "nothing after the DEPLOY ran while it was retried");

  handled.length = 0;
  const last = await indexPass({ rpc, store, handle, contractIds, startLedger, latestLedger });
  assert.equal(deployCalls, MAX_ATTEMPTS, "the handler is not run again once the attempts are spent");
  assert.deepEqual(last.gaveUp, [
    {
      id: DEPLOY_ID,
      kind: "FACTORY/DEPLOY",
      contractId: FACTORY,
      ledger: DEPLOY_LEDGER,
      attempts: MAX_ATTEMPTS,
      error: "TypeError: (metadata?.milestones ?? []).find is not a function",
    },
  ]);
  // The pass moves on: the vault's events are handled and the cursor passes it.
  assert.deepEqual(handled, ["VAULT/INIT", "BOND/POSTED", "DEPOSIT/CONTRIB"]);
  assert.equal(last.failed, 0);
  assert.equal(last.cursor, latestLedger);
  // Left unprocessed with its last error, for the health view to count.
  assert.deepEqual(rows.get(DEPLOY_ID), {
    processedAt: null,
    attempts: MAX_ATTEMPTS,
    error: "TypeError: (metadata?.milestones ?? []).find is not a function",
  });
  assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).startsWith(`[Indexer] Gave up on FACTORY/DEPLOY ${DEPLOY_ID}`)));
});

test("an event handled but not marked handled is retried rather than taken for done", async (t) => {
  t.mock.method(console, "error", () => {});
  const latestLedger = DEPLOY_LEDGER + 500;
  const rpc = standInRpc(CHAIN, latestLedger);
  const { rows, store } = memoryStore({ failMarkHandled: DEPLOY_ID });
  const handled: string[] = [];
  const handle = async (e: ContractEvent) => {
    handled.push(kind(e));
  };
  const contractIds = [FACTORY, KNOWN_VAULT];

  const first = await indexPass({ rpc, store, handle, contractIds, startLedger: DEPLOY_LEDGER - 100, latestLedger });
  assert.equal(first.failed, 1);
  assert.equal(first.cursor, DEPLOY_LEDGER - 101, "the cursor did not move");
  assert.deepEqual(rows.get(DEPLOY_ID), {
    processedAt: null,
    attempts: 1,
    error: "Error: could not write processed_at",
  });

  const second = await indexPass({ rpc, store, handle, contractIds, startLedger: first.cursor + 1, latestLedger });
  assert.equal(second.failed, 0);
  assert.equal(rows.get(DEPLOY_ID)!.attempts, 2);
  assert.notEqual(rows.get(DEPLOY_ID)!.processedAt, null);
  assert.deepEqual(handled, ["FACTORY/DEPLOY", "FACTORY/DEPLOY", "VAULT/INIT", "BOND/POSTED", "DEPOSIT/CONTRIB"]);
});

test("a NUL in a builder's metadata CID is stored as U+FFFD", async () => {
  const cid = "bafy\u0000\u0000x";
  // Through XDR and back, as the RPC hands values over.
  const wire = (v: xdr.ScVal) => xdr.ScVal.fromXDR(v.toXDR());
  const chain = [
    event(NEW_VAULT, DEPLOY_LEDGER, 19, 2, ["VAULT", "INIT"], wire(vec(u64(23), str(cid)))),
    event(FACTORY, DEPLOY_LEDGER, 19, 4, ["FACTORY", "DEPLOY"], wire(vec(u64(23), addr(NEW_VAULT), addr(BUILDER), str(cid)))),
  ];
  const rpc = standInRpc(chain, DEPLOY_LEDGER + 10);

  const { events } = await collectEvents({
    getEvents: rpc.getEvents,
    contractIds: [FACTORY],
    startLedger: DEPLOY_LEDGER,
    latestLedger: DEPLOY_LEDGER + 10,
  });

  assert.deepEqual(kinds(events), ["FACTORY/DEPLOY", "VAULT/INIT"]);
  const [deploy, init] = events;
  assert.equal((deploy.payload as unknown[])[3], "bafy\uFFFD\uFFFDx");
  assert.equal((init.payload as unknown[])[1], "bafy\uFFFD\uFFFDx");
  // Nothing Postgres refuses is left to send.
  for (const e of events) {
    const body = JSON.stringify(e.payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    assert.ok(!body.includes("\\u0000"), `${kind(e)} would still be refused`);
  }
});
