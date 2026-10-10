import { scValToNative, type xdr } from "@stellar/stellar-sdk";

/**
 * What one indexer pass reads, the order it handles it in, which events it
 * handles or retries, and how far its cursor may then move.
 *
 * Kept apart from event-indexer.ts, which writes to the database, so that this
 * part can run against a stand-in RPC and a stand-in event store
 * (indexer-scan.test.ts). It imports nothing but the SDK.
 */

const PAGE_SIZE = 200;
/** Enough empty scan windows to cross the RPC's whole retention (~120k ledgers). */
const MAX_PAGES = 60;
/** Contract ids per getEvents filter: the RPC's limit. */
const CHUNK = 5;
/**
 * How many passes may try one event. The cron runs a pass about every minute,
 * so this rides out an RPC or database hiccup without letting an event that
 * always fails hold every project's indexing behind it for good.
 */
export const MAX_ATTEMPTS = 5;

/** The fields of an RPC event the indexer reads. */
export interface RpcEvent {
  /** "<operation TOID>-<index within the operation>", both zero-padded. */
  id: string;
  ledger: number;
  ledgerClosedAt?: string;
  /** A Contract instance, not a string. */
  contractId?: { toString(): string };
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  pagingToken?: string;
}

export interface RpcEventPage {
  events?: RpcEvent[];
  cursor?: string;
  latestLedger?: number;
}

export type GetEvents = (request: {
  startLedger?: number;
  cursor?: string;
  filters: { type: "contract"; contractIds: string[] }[];
  limit: number;
}) => Promise<RpcEventPage>;

/** An event decoded into what contract_events stores. */
export interface ContractEvent {
  id: string;
  ledger: number;
  ledgerClosedAt: string | null;
  contractId: string;
  topic1: string;
  topic2: string;
  payload: unknown;
}

/**
 * The last ledger a getEvents cursor has fully scanned.
 *
 * A cursor is a TOID: the ledger sits in the high 32 bits. The RPC scans a
 * bounded window per request (10,000 ledgers on testnet) and, when that window
 * is empty, returns no events and a cursor at its end. Knowing where the cursor
 * stands is the only way to tell "nothing more" from "nothing in this window".
 */
export function cursorLedger(cursor: string): number {
  const [toid] = cursor.split("-");
  const id = BigInt(toid);
  const ledger = Number(id >> 32n);
  // Low bits all set mean the whole ledger was scanned; otherwise it stopped
  // partway through and only the ledger before is complete.
  return (id & 0xffffffffn) === 0xffffffffn ? ledger : ledger - 1;
}

function decode(raw: RpcEvent): ContractEvent {
  const topics = (raw.topic ?? []).map((t) => String(scValToNative(t)));
  return {
    id: raw.id,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt ?? null,
    // `contractId` arrives as a Contract instance, not a string. Passing it on
    // is silently destructive in both directions: it stores as a serialised
    // Buffer rather than an address, and `new Contract(<Contract>)` throws
    // "Invalid contract ID" — with the object's own toString in the message, so
    // the error names a perfectly valid address and reads like an RPC fault.
    // readVaultState catches that and returns null, and syncVault treats null as
    // nothing-to-do, so every vault state change was dropped without a trace and
    // a project's figures never moved past whatever DEPLOY first saw.
    contractId: String(raw.contractId),
    topic1: topics[0] ?? "",
    topic2: topics[1] ?? "",
    payload: scValToNative(raw.value),
  };
}

const isDeploy = (e: ContractEvent) => e.topic1 === "FACTORY" && e.topic2 === "DEPLOY";

/** The vault a FACTORY/DEPLOY names: [project_id, vault_address, creator, metadata_cid]. */
function deployedVault(e: ContractEvent): string | null {
  const vault = Array.isArray(e.payload) ? e.payload[1] : undefined;
  return vault ? String(vault) : null;
}

/** Page one group of contracts from `startLedger` to the latest ledger. */
async function scanGroup(
  getEvents: GetEvents,
  contractIds: string[],
  startLedger: number,
  latestLedger: number,
) {
  const events: RpcEvent[] = [];
  let cursor: string | undefined;
  let through = startLedger - 1;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const response = await getEvents({
        ...(cursor ? { cursor } : { startLedger }),
        filters: [{ type: "contract", contractIds }],
        limit: PAGE_SIZE,
      });

      const batch = response?.events ?? [];
      events.push(...batch);

      const next = response?.cursor ?? batch[batch.length - 1]?.pagingToken;
      if (!next || next === cursor) break;
      cursor = next;
      through = cursorLedger(next);

      // A short page only means this scan window is exhausted, not the chain.
      if (batch.length < PAGE_SIZE && through >= (response?.latestLedger ?? latestLedger)) {
        break;
      }
    } catch (err) {
      console.error(`[Indexer] getEvents failed for ${contractIds.join(", ")}:`, err);
      break;
    }
  }

  return { events, through };
}

/**
 * Ledger order, which an event id gives directly. One exception: within one
 * call the factory emits DEPLOY last, after the new vault's own VAULT/INIT and
 * BOND/POSTED, yet DEPLOY is what creates the vault's project row. Handled
 * first, the row exists under its project id before the vault's events re-read
 * it; otherwise syncVault finds no row and files the vault under its address.
 */
export function chainOrder(a: ContractEvent, b: ContractEvent): number {
  const [opA, indexA] = a.id.split("-");
  const [opB, indexB] = b.id.split("-");
  if (opA !== opB) return BigInt(opA) < BigInt(opB) ? -1 : 1;
  if (isDeploy(a) !== isDeploy(b)) return isDeploy(a) ? -1 : 1;
  return Number(indexA) - Number(indexB);
}

/**
 * Every event the watched contracts emitted from `startLedger` on, decoded and
 * in the order to handle them, with the highest ledger every one of them has
 * been scanned through.
 *
 * A vault deployed inside the range is read too, from its DEPLOY's ledger. It
 * cannot be among `contractIds`: its address reaches `projects` only once this
 * pass handles the DEPLOY. Yet its first events — VAULT/INIT and BOND/POSTED,
 * which `initialize` emits in the very transaction that deploys it — sit in
 * that ledger, and any stake made before the next pass sits after it. Skipping
 * the vault here let the cursor move past all of them for good, which is how
 * nearly every vault's Record lost the line saying its builder locked a deposit.
 */
export async function collectEvents({
  getEvents,
  contractIds,
  startLedger,
  latestLedger,
}: {
  getEvents: GetEvents;
  contractIds: string[];
  startLedger: number;
  latestLedger: number;
}) {
  const watched = new Set(contractIds);
  const byId = new Map<string, ContractEvent>();
  // The highest ledger every group has been scanned through. The cursor may move
  // this far even when nothing happened — without that, a quiet stretch longer
  // than one RPC scan window left every later run rescanning the same empty
  // window, and new projects never reached the database.
  let scannedThrough = latestLedger;

  const read = async (group: string[], from: number) => {
    const { events, through } = await scanGroup(getEvents, group, from, latestLedger);
    for (const raw of events) byId.set(raw.id, decode(raw));
    scannedThrough = Math.min(scannedThrough, through);
  };

  for (let i = 0; i < contractIds.length; i += CHUNK) {
    await read(contractIds.slice(i, i + CHUNK), startLedger);
  }

  // Repeats only if a vault read here deployed a vault in turn, which none does.
  for (;;) {
    const deployed: { vault: string; ledger: number }[] = [];
    for (const event of byId.values()) {
      const vault = isDeploy(event) ? deployedVault(event) : null;
      if (!vault || watched.has(vault)) continue;
      watched.add(vault);
      deployed.push({ vault, ledger: event.ledger });
    }
    if (deployed.length === 0) break;

    deployed.sort((a, b) => a.ledger - b.ledger);
    for (let i = 0; i < deployed.length; i += CHUNK) {
      const group = deployed.slice(i, i + CHUNK);
      await read(group.map((d) => d.vault), group[0].ledger);
    }
  }

  return { events: [...byId.values()].sort(chainOrder), scannedThrough };
}

/** What contract_events holds for an event a pass has read before. */
export interface EventRow {
  processedAt: string | null;
  /** Passes that have started handling it. */
  attempts: number;
  /** Why the last attempt failed, if one did. */
  error: string | null;
}

/** Where a pass keeps what it did with each event: contract_events in production. */
export interface EventStore {
  /**
   * Record a new event as its first attempt and return null. An event recorded
   * before is left as it is, and its row comes back instead.
   */
  record(event: ContractEvent): Promise<EventRow | null>;
  /** Count another attempt on a recorded event, before its handler runs. */
  countAttempt(eventId: string, attempts: number): Promise<void>;
  markHandled(eventId: string): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;
}

/** An event the indexer has stopped retrying. Its row keeps its last error. */
export interface GivenUpEvent {
  id: string;
  kind: string;
  contractId: string;
  ledger: number;
  attempts: number;
  error: string | null;
}

/**
 * Handle a pass's events in order, retrying the ones an earlier pass failed.
 *
 * A failed event used to be skipped for good. The next pass read it again, since
 * the cursor stops before it, but found its row and took it for handled. A
 * vault's figures then waited for its next event to be re-read. A failed DEPLOY
 * never made its project's row, and the vault's own events filed the project
 * under its vault address instead.
 *
 * Now a row without `processed_at` is retried, with each attempt counted before
 * its handler runs, so one that dies mid-handler, in a redeploy say, counts too.
 * A failure still stops the pass. After MAX_ATTEMPTS the event is skipped and
 * left unprocessed with its last error, where the console's health view shows
 * it. Retrying it forever would hold every project's indexing behind one event,
 * and the factory is permissionless: anyone can deploy a vault.
 */
export async function handleEvents({
  events,
  startLedger,
  store,
  handle,
}: {
  events: ContractEvent[];
  startLedger: number;
  store: EventStore;
  handle: (event: ContractEvent) => Promise<void>;
}) {
  let processed = 0;
  let failed = 0;
  const gaveUp: GivenUpEvent[] = [];
  // Only advances past events that were handled, now or before, or given up on.
  let handledThrough = startLedger - 1;
  let failedLedger: number | null = null;

  for (const event of events) {
    const earlier = await store.record(event);
    let attempt = 1;

    if (earlier) {
      if (earlier.processedAt !== null) {
        handledThrough = Math.max(handledThrough, event.ledger);
        continue;
      }
      if (earlier.attempts >= MAX_ATTEMPTS) {
        const kind = `${event.topic1}/${event.topic2}`;
        gaveUp.push({
          id: event.id,
          kind,
          contractId: event.contractId,
          ledger: event.ledger,
          attempts: earlier.attempts,
          error: earlier.error,
        });
        console.error(
          `[Indexer] Gave up on ${kind} ${event.id} after ${earlier.attempts} attempts; ` +
            `leaving it unprocessed. Last error: ${earlier.error ?? "none recorded"}`,
        );
        handledThrough = Math.max(handledThrough, event.ledger);
        continue;
      }
      attempt = earlier.attempts + 1;
      await store.countAttempt(event.id, attempt);
    }

    try {
      await handle(event);
      await store.markHandled(event.id);
      processed++;
      handledThrough = Math.max(handledThrough, event.ledger);
    } catch (err) {
      // Recorded and visible, and the cursor stops short of its ledger, so the
      // next pass reads it again and retries it.
      failed++;
      failedLedger = event.ledger;
      console.error(`[Indexer] Failed to handle ${event.id} (attempt ${attempt} of ${MAX_ATTEMPTS}):`, err);
      await store
        .markFailed(event.id, String(err))
        .catch((markError) => console.error(`[Indexer] Could not record that ${event.id} failed:`, markError));
      break;
    }
  }

  return { processed, failed, gaveUp, handledThrough, failedLedger };
}

/**
 * Where the cursor moves once a pass has handled its events. With every one
 * handled, to where the scan reached, quiet ledgers included. After a failure,
 * to the last ledger before the failed event's: the events after it in its
 * ledger were never even recorded, so stopping on that ledger skipped them, and
 * a new vault's VAULT/INIT and BOND/POSTED share their ledger with its DEPLOY.
 * Never past a group that did not finish scanning.
 */
export function cursorAfterPass({
  scannedThrough,
  handledThrough,
  failedLedger,
}: {
  scannedThrough: number;
  /** The highest ledger of an event this pass handled, found handled before, or gave up on. */
  handledThrough: number;
  /** The ledger of the event that failed, if one did. */
  failedLedger: number | null;
}): number {
  if (failedLedger === null) return scannedThrough;
  return Math.min(handledThrough, failedLedger - 1, scannedThrough);
}
