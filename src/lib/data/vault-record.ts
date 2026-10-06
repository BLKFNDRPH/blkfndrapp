import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectById } from "@/lib/data/projects";

/**
 * A vault's public record: every event it has emitted, as the indexer stored
 * it, normalised into entries the Record tab turns into sentences.
 *
 * The events are public on the ledger already; contract_events is
 * service-role only because it is the indexer's working table, not because
 * its contents are private. Visibility follows the project instead: the
 * project is read through the caller's own client first, so a project hidden
 * from them returns nothing here either.
 */

export type RecordKind =
  | "opened"
  | "deposit-posted"
  | "staked"
  | "funded"
  | "vote-opened"
  | "voted"
  | "paid"
  | "stage-failed"
  | "deposit-shared"
  | "deposit-returned"
  | "goal-missed"
  | "stalled"
  | "refunded";

export interface RecordEntry {
  /** Soroban's event id: the operation's TOID and the event's index. */
  id: string;
  /** When its ledger closed. */
  at: string | null;
  kind: RecordKind;
  stage?: number;
  /** Base units, as a string. */
  amountRaw?: string;
  /** A running total the event carries (raised so far), base units. */
  totalRaw?: string;
  /** The account that acted, where the event names one. */
  account?: string;
  /** When a vote closes, epoch seconds. */
  closesAt?: number;
}

export interface VaultRecord {
  entries: RecordEntry[];
  /** When the indexer last finished a pass, so the page can say how fresh this is. */
  indexedAt: string | null;
}

type Row = {
  event_id: string;
  ledger_closed_at: string | null;
  topic1: string;
  topic2: string;
  payload: unknown;
};

const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));

function toEntry(row: Row): RecordEntry | null {
  const p = Array.isArray(row.payload) ? row.payload : [];
  const base = { id: row.event_id, at: row.ledger_closed_at };
  switch (`${row.topic1}/${row.topic2}`) {
    case "FACTORY/DEPLOY":
      return { ...base, kind: "opened", account: str(p[2]) };
    case "BOND/POSTED":
      return { ...base, kind: "deposit-posted", amountRaw: str(p[1]) };
    case "DEPOSIT/CONTRIB":
      return { ...base, kind: "staked", account: str(p[1]), amountRaw: str(p[2]), totalRaw: str(p[3]) };
    case "VAULT/FUNDED":
      return { ...base, kind: "funded", totalRaw: str(p[1]) };
    case "MILESTN/VOTEOPEN":
      return { ...base, kind: "vote-opened", stage: Number(p[1]), closesAt: Number(p[3]) };
    case "MILESTN/APPROVE":
      return { ...base, kind: "voted", stage: Number(p[1]), account: str(p[2]) };
    case "MILESTN/RELEASE":
      return { ...base, kind: "paid", stage: Number(p[1]), amountRaw: str(p[2]) };
    case "MILESTN/FAILED":
      return { ...base, kind: "stage-failed", stage: Number(p[1]) };
    case "BOND/SLASHED":
      return { ...base, kind: "deposit-shared", amountRaw: str(p[1]) };
    case "BOND/RETURNED":
      return { ...base, kind: "deposit-returned", amountRaw: str(p[1]) };
    case "VAULT/FAILED":
      return { ...base, kind: "goal-missed", totalRaw: str(p[1]) };
    case "VAULT/STALLED":
      return { ...base, kind: "stalled" };
    case "DEPOSIT/REFUND":
      return { ...base, kind: "refunded", account: str(p[1]), amountRaw: str(p[2]) };
    default:
      // VAULT/INIT repeats the deploy; anything newer than this list is left
      // out rather than shown as a raw topic.
      return null;
  }
}

/** The record for a project the caller can see, newest first, or null when they can't. */
export async function getVaultRecord(projectId: string): Promise<VaultRecord | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;

  const admin = createAdminClient();
  const { data: state } = await admin
    .from("indexer_state")
    .select("updated_at")
    .eq("key", "last_processed_ledger")
    .maybeSingle();
  const indexedAt = state?.updated_at ?? null;

  const vault = project.vaultAddress;
  if (!vault) return { entries: [], indexedAt };

  const columns = "event_id, ledger, ledger_closed_at, topic1, topic2, payload";
  const [own, deploy] = await Promise.all([
    admin
      .from("contract_events")
      .select(columns)
      .eq("contract_id", vault)
      .order("ledger", { ascending: false })
      .limit(1000),
    // The vault's opening is the factory's event, naming the vault in its payload.
    admin
      .from("contract_events")
      .select(columns)
      .eq("topic1", "FACTORY")
      .eq("topic2", "DEPLOY")
      .contains("payload", JSON.stringify([vault]))
      .limit(1),
  ]);
  if (own.error) throw new Error(`Could not read the vault's record: ${own.error.message}`);

  const rows = [...(own.data ?? []), ...(deploy.data ?? [])] as Row[];
  const entries = rows.map(toEntry).filter((e): e is RecordEntry => e !== null);
  entries.sort(newestFirst);
  return { entries, indexedAt };
}

/**
 * Newest first. An event id is "<operation TOID>-<index>", and the TOID orders
 * ledgers and the transactions inside them. Events from the same call happen
 * at the same moment, and the contract emits a consequence before its cause
 * (the goal reached before the stake that reached it, the deposit returned
 * before the last payout), so within one call the consequence is put on top.
 * The deposit is locked in the same call that opens the vault, so it reads
 * above "Vault opened" too.
 */
const CONSEQUENCES = new Set<RecordKind>(["funded", "deposit-returned", "deposit-shared", "deposit-posted"]);

function newestFirst(a: RecordEntry, b: RecordEntry): number {
  const [ta, ia] = a.id.split("-");
  const [tb, ib] = b.id.split("-");
  if (ta !== tb) return BigInt(tb) > BigInt(ta) ? 1 : -1;
  const ca = CONSEQUENCES.has(a.kind) ? 0 : 1;
  const cb = CONSEQUENCES.has(b.kind) ? 0 : 1;
  if (ca !== cb) return ca - cb;
  return Number(ib) - Number(ia);
}
