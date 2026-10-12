/**
 * What the stage vote panel shows, as the vault reports it, and its JSON form.
 *
 * The panel used to make these reads from the browser, one RPC round trip
 * each. /api/projects/[id]/votes now makes them on the server and sends this
 * shape. Contract figures are bigints; JSON has none, so they travel as
 * decimal strings and are turned back here.
 *
 * Self-contained so node --test can load it.
 */

/**
 * The simulation reached the contract and the contract has no such function.
 *
 * Soroban reports this as `Error(WasmVm, MissingValue)`, with a diagnostic
 * event naming the "non-existent contract function". Network and RPC failures
 * never get this far — they surface from the HTTP client — and a contract that
 * has the function but panics reports a `Contract` error, so neither matches.
 * This is how a vault that predates a rule is told apart from one that did not
 * answer.
 */
export function isMissingFunction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Error(WasmVm, MissingValue)") ||
    message.includes("non-existent contract function")
  );
}

/**
 * A milestone's distinct approving wallets against the number a release needs.
 *
 * `supported: false` is a definite answer, not a failed read: the vault was
 * deployed before the wallet floor existed and releases on weight alone. A
 * read that failed for any other reason is `null` instead, so a flaky RPC can
 * never make a vault that has the floor look like one without.
 */
export type MilestoneWallets =
  | { supported: true; approvals: number; required: number }
  | { supported: false };

/**
 * What a milestone's approvers put in between them, counted whole, against
 * the least a release needs: more than half the raise.
 *
 * `supported: false` is a definite answer: the vault predates the money
 * majority and releases on weight and wallets alone. A failed read is `null`
 * instead, for the same reason as `MilestoneWallets`.
 */
export type MilestoneStake =
  | { supported: true; approved: bigint; required: bigint }
  | { supported: false };

export interface PanelMilestone {
  id: number;
  amount: bigint;
  released: boolean;
  failed: boolean;
  /** Unix seconds the vote opened; 0 when it has not. */
  vote_opens_at: bigint;
  approved_weight: bigint;
}

/** Everything the panel shows that is the same for every visitor. */
export interface VoteTally {
  milestones: PanelMilestone[];
  raised: bigint;
  windowSecs: number;
  token: string | null;
  /** The vault's own bar (the same for every milestone); null when unread. */
  requiredWeight: bigint | null;
  /** Per milestone id: only the milestones being counted are present. */
  wallets: Record<number, MilestoneWallets | null>;
  stakes: Record<number, MilestoneStake | null>;
}

/** The viewer's own side: what their vote is worth, and where they voted. */
export interface MyVotes {
  weight: bigint;
  voted: Record<number, boolean>;
}

export interface VotePanel {
  tally: VoteTally;
  /** Null when no address was asked about. */
  mine: MyVotes | null;
}

type Wire<T> = T extends bigint
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

/** VotePanel as JSON carries it: every bigint a decimal string. */
export type VotePanelJson = Wire<VotePanel>;

function encodeStake(stake: MilestoneStake | null): Wire<MilestoneStake> | null {
  if (!stake || !stake.supported) return stake;
  return { supported: true, approved: stake.approved.toString(), required: stake.required.toString() };
}

function decodeStake(stake: Wire<MilestoneStake> | null): MilestoneStake | null {
  if (!stake || !stake.supported) return stake;
  return { supported: true, approved: BigInt(stake.approved), required: BigInt(stake.required) };
}

function mapValues<A, B>(record: Record<number, A>, map: (value: A) => B): Record<number, B> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [Number(key), map(value)]),
  );
}

export function encodeVotePanel(panel: VotePanel): VotePanelJson {
  const { tally, mine } = panel;
  return {
    tally: {
      milestones: tally.milestones.map((m) => ({
        ...m,
        amount: m.amount.toString(),
        vote_opens_at: m.vote_opens_at.toString(),
        approved_weight: m.approved_weight.toString(),
      })),
      raised: tally.raised.toString(),
      windowSecs: tally.windowSecs,
      token: tally.token,
      requiredWeight: tally.requiredWeight === null ? null : tally.requiredWeight.toString(),
      wallets: tally.wallets,
      stakes: mapValues(tally.stakes, encodeStake),
    },
    mine: mine && { weight: mine.weight.toString(), voted: mine.voted },
  };
}

export function decodeVotePanel(json: VotePanelJson): VotePanel {
  const { tally, mine } = json;
  return {
    tally: {
      milestones: tally.milestones.map((m) => ({
        ...m,
        amount: BigInt(m.amount),
        vote_opens_at: BigInt(m.vote_opens_at),
        approved_weight: BigInt(m.approved_weight),
      })),
      raised: BigInt(tally.raised),
      windowSecs: tally.windowSecs,
      token: tally.token,
      requiredWeight: tally.requiredWeight === null ? null : BigInt(tally.requiredWeight),
      wallets: mapValues(tally.wallets, (w) => w),
      stakes: mapValues(tally.stakes, decodeStake),
    },
    mine: mine && { weight: BigInt(mine.weight), voted: mapValues(mine.voted, (v) => v) },
  };
}

/**
 * The milestones worth counting: only a vote that has opened and not settled
 * can still carry. With none, the first is asked about anyway, because the
 * answer also says which rule this vault runs, and the panel's header
 * explains it.
 */
export function milestonesToCount(milestones: PanelMilestone[]): PanelMilestone[] {
  const live = milestones.filter((m) => !m.released && !m.failed && m.vote_opens_at !== 0n);
  return live.length > 0 ? live : milestones.slice(0, 1);
}
