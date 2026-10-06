/**
 * A vault's record as lines a person reads: "Stakeholder #3 staked $25",
 * "$1,000 paid to the builder for Stage 1: Foundations". Pure: takes the
 * entries /api/projects/[id]/record returns, and words.
 *
 * Nobody is named by an address. Stakeholders are numbered in the order they
 * first staked, so a number keeps meaning the same person down the page, and
 * the viewer's own lines say "You".
 */

// Type only, so the server-only module is erased rather than bundled.
import type { RecordEntry, RecordKind } from "@/lib/data/vault-record";
import { describeMoney, rawToUnits } from "@/lib/money";

export type RecordFilter = "all" | "in" | "out" | "votes" | "builder";

export const RECORD_FILTERS: { value: RecordFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in", label: "Money in" },
  { value: "out", label: "Money out" },
  { value: "votes", label: "Votes" },
  { value: "builder", label: "Builder" },
];

/** Which chips each kind of line answers to; every line is also under "All". */
const FILTERS: Record<RecordKind, RecordFilter[]> = {
  opened: ["builder"],
  "deposit-posted": ["in", "builder"],
  staked: ["in"],
  funded: [],
  "vote-opened": ["votes", "builder"],
  voted: ["votes"],
  paid: ["out", "builder"],
  "stage-failed": ["votes"],
  "deposit-shared": ["builder"],
  "deposit-returned": ["out", "builder"],
  "goal-missed": [],
  stalled: ["builder"],
  refunded: ["out"],
};

export interface RecordLine {
  id: string;
  at: string | null;
  kind: RecordKind;
  sentence: string;
  /** The money the line is about, or null. */
  amount: string | null;
  filters: RecordFilter[];
  /** The viewer's own stake, vote or refund. */
  mine: boolean;
}

export function describeRecord(
  entries: RecordEntry[],
  options: {
    currency: string;
    xlmUsd: number | null;
    /** "Stage 1: Foundations" for a stage id. */
    stageName: (id: number) => string;
    /** The viewer's wallet, to say "You". */
    me: string | null;
  },
): RecordLine[] {
  const { currency, xlmUsd, stageName, me } = options;
  const money = (raw: string | undefined) => {
    if (raw === undefined) return null;
    try {
      return describeMoney(rawToUnits(BigInt(raw)), currency, xlmUsd, "auto").primary;
    } catch {
      return null;
    }
  };

  // Numbered by first stake, oldest first, whatever order the page shows.
  const numbers = new Map<string, number>();
  for (const e of [...entries].reverse()) {
    if (e.kind === "staked" && e.account && !numbers.has(e.account)) {
      numbers.set(e.account, numbers.size + 1);
    }
  }
  const who = (account: string | undefined) => {
    if (account && me && account === me) return "You";
    const n = account ? numbers.get(account) : undefined;
    return n ? `Stakeholder #${n}` : "A stakeholder";
  };
  const stage = (id: number | undefined) => (id === undefined || Number.isNaN(id) ? "a stage" : stageName(id));
  const day = (secs: number | undefined) =>
    secs ? new Date(secs * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";

  return entries.map((e) => {
    const amount = money(e.amountRaw);
    const total = money(e.totalRaw);
    let sentence: string;
    switch (e.kind) {
      case "opened":
        sentence = "Vault opened by the builder.";
        break;
      case "deposit-posted":
        sentence = amount
          ? `The builder locked a ${amount} deposit in the vault.`
          : "The builder locked their deposit in the vault.";
        break;
      case "staked":
        sentence = `${who(e.account)} staked ${amount ?? "in the vault"}.`;
        break;
      case "funded":
        sentence = total ? `Goal reached with ${total} staked. Stakes are closed.` : "Goal reached. Stakes are closed.";
        break;
      case "vote-opened":
        sentence = `Vote opened on ${stage(e.stage)}.${e.closesAt ? ` It closes ${day(e.closesAt)}.` : ""}`;
        break;
      case "voted":
        sentence = `${who(e.account)} voted yes on ${stage(e.stage)}.`;
        break;
      case "paid":
        sentence = `${amount ?? "A payout"} paid to the builder for ${stage(e.stage)}.`;
        break;
      case "stage-failed":
        sentence = `${stage(e.stage)} vote ended short of a majority. Refunds opened, with a share of the builder's deposit.`;
        break;
      case "deposit-shared":
        sentence = amount
          ? `The builder's ${amount} deposit was set aside for stakeholders.`
          : "The builder's deposit was set aside for stakeholders.";
        break;
      case "deposit-returned":
        sentence = amount
          ? `The builder's ${amount} deposit went back to them.`
          : "The builder's deposit went back to them.";
        break;
      case "goal-missed":
        sentence = "The deadline passed short of the goal. Everyone who staked can collect their stake.";
        break;
      case "stalled":
        sentence = "No progress for 90 days, so the vault closed. Refunds opened.";
        break;
      case "refunded":
        sentence = `${who(e.account)} collected ${amount ?? "a refund"}.`;
        break;
    }
    const mine = Boolean(me && e.account === me && (e.kind === "staked" || e.kind === "voted" || e.kind === "refunded"));
    return {
      id: e.id,
      at: e.at,
      kind: e.kind,
      sentence,
      // A total says how much was staked; a vault that missed its goal with
      // nothing staked has no amount worth showing.
      amount:
        e.kind === "funded" || e.kind === "goal-missed"
          ? e.totalRaw && e.totalRaw !== "0"
            ? total
            : null
          : amount,
      filters: ["all", ...FILTERS[e.kind]],
      mine,
    };
  });
}

/**
 * The ledger operation behind an event, for "Verify this": Soroban's event id
 * starts with the operation's TOID counting operations from 0, and Horizon
 * counts them from 1. Checked against two events on 6 Oct 2026.
 */
export function horizonOperationId(eventId: string): string | null {
  const toid = eventId.split("-")[0];
  if (!/^\d+$/.test(toid)) return null;
  return (BigInt(toid) + BigInt(1)).toString();
}
