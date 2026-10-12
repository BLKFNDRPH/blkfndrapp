/**
 * A vault's state rebuilt from its stored events alone, and the comparison of
 * that rebuild with what the vault itself reports.
 *
 * The indexer uses an event as the signal to re-read a vault (event-indexer.ts),
 * so the figures it stores come from the ledger. This module shows the events
 * are enough on their own: replay them in order and every figure that changes
 * after a vault opens — status, amount raised, payouts, stages, votes, the
 * deposit, each staker's balance — comes out the same as the vault's own.
 *
 * What no event carries are the terms fixed when the vault opens: its goal,
 * its deadline and its stage ids. FACTORY/DEPLOY and VAULT/INIT carry only the
 * metadata CID, and the metadata document is the builder's word, not the
 * vault's. So the terms are read from the vault once, and everything else is
 * replayed.
 *
 * Every rule below mirrors contracts/blkfndr-vault/src/lib.rs. Kept free of
 * imports so it runs under `npm test` and from scripts/replay-check.mjs.
 */

/** VaultState in the contract, by its discriminant. */
export const VAULT_STATES = [
  "raising",
  "funded",
  "active",
  "failed",
  "refunding",
  "completed",
] as const;

const RAISING = 0;
const FUNDED = 1;
const ACTIVE = 2;
const FAILED = 3;
const REFUNDING = 4;
const COMPLETED = 5;

/** A contract_events row, as PostgREST returns it. */
export interface StoredEvent {
  /** "<operation TOID>-<index>", both zero-padded, so it sorts in chain order. */
  event_id: string;
  ledger: number;
  contract_id: string;
  topic1: string;
  topic2: string;
  /** i128 and u64 values arrive as decimal strings, u32 values as numbers. */
  payload: unknown[];
}

/** What the vault fixes when it opens and no event repeats. */
export interface VaultTerms {
  goal: bigint;
  /** Unix seconds. */
  deadline: bigint;
  /** In the vault's order, which settle_stalled walks. */
  milestoneIds: number[];
}

export interface ReplayedMilestone {
  id: number;
  released: boolean;
  failed: boolean;
  /** Unix seconds; 0 until its vote opens. */
  voteOpensAt: bigint;
  approvedWeight: bigint;
  approvals: number;
}

export interface ReplayedVault {
  /** Index into VAULT_STATES, as `get_state` would answer at `now`. */
  state: number;
  raised: bigint;
  releasedTotal: bigint;
  bondAmount: bigint;
  bondPosted: boolean;
  bondReturned: boolean;
  /** Stakes not yet refunded. */
  unclaimed: bigint;
  milestones: ReplayedMilestone[];
  /** Every staker's balance; a refunded staker's is 0. */
  balances: Map<string, bigint>;
  /** Events replayed. */
  events: number;
  /**
   * Places where the events disagree with themselves: a running total in a
   * payload that is not the sum of the amounts before it, or an event for a
   * stage the vault does not have. Empty for a consistent history.
   */
  selfCheck: string[];
}

const big = (value: unknown): bigint => BigInt(String(value ?? 0));

/** Replay one vault's events, oldest first, as of `now` (unix seconds). */
export function replayVault(
  terms: VaultTerms,
  events: StoredEvent[],
  now: bigint,
): ReplayedVault {
  const vault: ReplayedVault = {
    state: RAISING,
    raised: 0n,
    releasedTotal: 0n,
    bondAmount: 0n,
    bondPosted: false,
    bondReturned: false,
    unclaimed: 0n,
    milestones: terms.milestoneIds.map((id) => ({
      id,
      released: false,
      failed: false,
      voteOpensAt: 0n,
      approvedWeight: 0n,
      approvals: 0,
    })),
    balances: new Map(),
    events: 0,
    selfCheck: [],
  };

  const stage = (event: StoredEvent): ReplayedMilestone | undefined => {
    const id = Number(event.payload[1]);
    const found = vault.milestones.find((m) => m.id === id);
    if (!found) vault.selfCheck.push(`${event.event_id}: no stage ${id} on this vault`);
    return found;
  };

  const ordered = [...events].sort((a, b) => (a.event_id < b.event_id ? -1 : 1));

  for (const event of ordered) {
    vault.events += 1;
    const p = event.payload;

    switch (`${event.topic1}/${event.topic2}`) {
      case "VAULT/INIT":
        vault.state = RAISING;
        break;

      case "BOND/POSTED":
        vault.bondPosted = true;
        vault.bondAmount = big(p[1]);
        break;

      case "DEPOSIT/CONTRIB": {
        // [project_id, contributor, amount, raised_amount]
        const who = String(p[1]);
        const amount = big(p[2]);
        vault.balances.set(who, (vault.balances.get(who) ?? 0n) + amount);
        vault.raised += amount;
        vault.unclaimed += amount;
        if (big(p[3]) !== vault.raised) {
          vault.selfCheck.push(
            `${event.event_id}: stake says ${p[3]} raised, the stakes before it add up to ${vault.raised}`,
          );
        }
        break;
      }

      // Emitted by contribute when a stake reaches the goal, or by any call
      // that first runs after the deadline (sync_state).
      case "VAULT/FUNDED":
        vault.state = FUNDED;
        break;

      case "VAULT/FAILED":
        vault.state = FAILED;
        break;

      case "MILESTN/VOTEOPEN": {
        // [project_id, milestone_id, opens_at, closes_at]
        const m = stage(event);
        if (m) m.voteOpensAt = big(p[2]);
        break;
      }

      case "MILESTN/APPROVE": {
        // [project_id, milestone_id, contributor, weight, running]
        const m = stage(event);
        if (!m) break;
        m.approvals += 1;
        m.approvedWeight += big(p[3]);
        if (big(p[4]) !== m.approvedWeight) {
          vault.selfCheck.push(
            `${event.event_id}: approval says ${p[4]} behind stage ${m.id}, the approvals add up to ${m.approvedWeight}`,
          );
        }
        break;
      }

      case "MILESTN/RELEASE": {
        // [project_id, milestone_id, tranche, released_total]
        const m = stage(event);
        if (m) m.released = true;
        vault.releasedTotal += big(p[2]);
        if (big(p[3]) !== vault.releasedTotal) {
          vault.selfCheck.push(
            `${event.event_id}: payout says ${p[3]} paid in all, the payouts add up to ${vault.releasedTotal}`,
          );
        }
        const allReleased = vault.milestones.every((x) => x.released);
        vault.state = allReleased ? COMPLETED : ACTIVE;
        // The last payout hands back the deposit, and marks it returned even
        // when the deposit is 0 and no BOND/RETURNED follows.
        if (allReleased) vault.bondReturned = true;
        break;
      }

      // settle_lapsed_milestone: the stage's vote ended short.
      case "MILESTN/FAILED": {
        const m = stage(event);
        if (m) m.failed = true;
        vault.state = REFUNDING;
        break;
      }

      // settle_stalled fails the first stage still open, which its payload
      // does not name, then moves the vault to refunding.
      case "VAULT/STALLED": {
        const next = vault.milestones.find((x) => !x.released && !x.failed);
        if (next) next.failed = true;
        vault.state = REFUNDING;
        break;
      }

      case "BOND/RETURNED":
        vault.bondReturned = true;
        break;

      // The deposit is kept for the stakers' refunds; bond_returned stays false
      // until the last refund sweeps what is left.
      case "BOND/SLASHED":
        break;

      case "DEPOSIT/REFUND": {
        // [project_id, contributor, refund_total]. The vault removes the whole
        // balance; the refund itself can differ from it (a share of what is
        // left, plus a share of the deposit).
        const who = String(p[1]);
        const balance = vault.balances.get(who) ?? 0n;
        vault.balances.set(who, 0n);
        vault.unclaimed -= balance;
        if (vault.state === FAILED && big(p[2]) !== balance) {
          vault.selfCheck.push(
            `${event.event_id}: refund of ${p[2]} after a missed goal, but the stake was ${balance}`,
          );
        }
        // The last claimant in a refunding vault sweeps the remainder,
        // deposit included, with no BOND event.
        if (vault.state === REFUNDING && vault.unclaimed === 0n) vault.bondReturned = true;
        break;
      }

      default:
        vault.events -= 1;
    }
  }

  // get_state reports what the state should be now, before anyone settles: a
  // raise past its deadline reads as funded or failed with no event yet.
  if (vault.state === RAISING && now >= terms.deadline) {
    vault.state = vault.raised >= terms.goal ? FUNDED : FAILED;
  }

  return vault;
}

/** What the vault itself answers, from get_state, get_info and get_balance. */
export interface ChainVault {
  state: number;
  info: {
    raised_amount: unknown;
    released_total: unknown;
    bond_amount: unknown;
    bond_posted: unknown;
    /** Missing from vault code that predates it; skipped then. */
    bond_returned?: unknown;
    unclaimed_contributions?: unknown;
    milestones: {
      id: unknown;
      released: unknown;
      failed?: unknown;
      vote_opens_at?: unknown;
      approved_weight?: unknown;
    }[];
  };
  /** Missing from vault code that predates it; skipped then. */
  contributorCount?: number;
  balances: Map<string, bigint>;
}

export interface Difference {
  field: string;
  replayed: string;
  chain: string;
}

/** Every field where the replay and the vault disagree. Empty means they match. */
export function compareWithChain(replayed: ReplayedVault, chain: ChainVault): Difference[] {
  const out: Difference[] = [];
  const check = (field: string, mine: unknown, theirs: unknown) => {
    if (theirs === undefined) return;
    const a = String(mine);
    const b = String(theirs);
    if (a !== b) out.push({ field, replayed: a, chain: b });
  };

  check("state", VAULT_STATES[replayed.state], VAULT_STATES[chain.state] ?? chain.state);
  check("raised_amount", replayed.raised, big(chain.info.raised_amount));
  check("released_total", replayed.releasedTotal, big(chain.info.released_total));
  check("bond_amount", replayed.bondAmount, big(chain.info.bond_amount));
  check("bond_posted", replayed.bondPosted, Boolean(chain.info.bond_posted));
  if (chain.info.bond_returned !== undefined) {
    check("bond_returned", replayed.bondReturned, Boolean(chain.info.bond_returned));
  }
  if (chain.info.unclaimed_contributions !== undefined) {
    check("unclaimed_contributions", replayed.unclaimed, big(chain.info.unclaimed_contributions));
  }

  const chainIds = chain.info.milestones.map((m) => Number(m.id));
  check("stages", replayed.milestones.map((m) => m.id).join(","), chainIds.join(","));
  for (const theirs of chain.info.milestones) {
    const id = Number(theirs.id);
    const mine = replayed.milestones.find((m) => m.id === id);
    if (!mine) continue;
    check(`stage ${id} released`, mine.released, Boolean(theirs.released));
    if (theirs.failed !== undefined) check(`stage ${id} failed`, mine.failed, Boolean(theirs.failed));
    if (theirs.vote_opens_at !== undefined) {
      check(`stage ${id} vote_opens_at`, mine.voteOpensAt, big(theirs.vote_opens_at));
    }
    if (theirs.approved_weight !== undefined) {
      check(`stage ${id} approved_weight`, mine.approvedWeight, big(theirs.approved_weight));
    }
  }

  check("contributor_count", replayed.balances.size, chain.contributorCount);
  for (const [who, balance] of replayed.balances) {
    check(`balance ${who}`, balance, chain.balances.get(who));
  }

  return out;
}
