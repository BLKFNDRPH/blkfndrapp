// Server-side reads of a vault's vote, for the stage vote panel.

import { simulate, vaultClient } from "@/lib/stellar-clients";
import { cachedRead } from "@/lib/read-cache";
import {
  isMissingFunction,
  milestonesToCount,
  type MilestoneStake,
  type MilestoneWallets,
  type MyVotes,
  type PanelMilestone,
  type VoteTally,
} from "@/lib/vote-panel";

/**
 * Weight behind a milestone, the weight a release needs, and whether the
 * window is open. The required weight is the contract's own: half the raise
 * on vaults deployed before the wallet floor, half the capped total after.
 * Null when the read fails, including a contract error such as an unknown id.
 */
async function readMilestoneVote(vaultAddress: string, milestoneId: number) {
  const result = await simulate(
    () => vaultClient(vaultAddress).get_milestone_vote({ milestone_id: milestoneId }),
    `get_milestone_vote(${vaultAddress}, ${milestoneId})`,
  );
  // A contract error comes back as an Err value rather than a throw.
  if (!Array.isArray(result)) return null;
  const [approved, required, open] = result;
  return [BigInt(approved), BigInt(required), Boolean(open)] as const;
}

/**
 * Distinct wallets behind a milestone and how many a release needs. Not
 * routed through `simulate`, which flattens every failure to null: this read
 * has to tell a vault without the function apart from one that did not
 * answer. Null means the answer is unknown.
 */
async function readMilestoneWallets(
  vaultAddress: string,
  milestoneId: number,
): Promise<MilestoneWallets | null> {
  const label = `get_milestone_wallets(${vaultAddress}, ${milestoneId})`;
  try {
    const tx = await vaultClient(vaultAddress).get_milestone_wallets({
      milestone_id: milestoneId,
    });
    const result: unknown = tx.result;
    if (!Array.isArray(result)) {
      console.warn(`[stellar] ${label} returned`, result);
      return null;
    }
    return { supported: true, approvals: Number(result[0]), required: Number(result[1]) };
  } catch (error) {
    if (isMissingFunction(error)) return { supported: false };
    console.warn(`[stellar] ${label} failed:`, error);
    return null;
  }
}

/**
 * The approvers' combined stake behind a milestone and the least a release
 * needs. Read like `readMilestoneWallets`, so a vault without the money
 * majority is told apart from one that did not answer. Null means unknown.
 */
async function readMilestoneStake(
  vaultAddress: string,
  milestoneId: number,
): Promise<MilestoneStake | null> {
  const label = `get_milestone_stake(${vaultAddress}, ${milestoneId})`;
  try {
    const tx = await vaultClient(vaultAddress).get_milestone_stake({
      milestone_id: milestoneId,
    });
    const result: unknown = tx.result;
    if (!Array.isArray(result)) {
      console.warn(`[stellar] ${label} returned`, result);
      return null;
    }
    return { supported: true, approved: BigInt(result[0]), required: BigInt(result[1]) };
  } catch (error) {
    if (isMissingFunction(error)) return { supported: false };
    console.warn(`[stellar] ${label} failed:`, error);
    return null;
  }
}

/** The tally everyone sees. Null when the vault could not be read. */
export async function readVoteTally(vaultAddress: string): Promise<VoteTally | null> {
  const info: any = await simulate(
    () => vaultClient(vaultAddress).get_info(),
    `get_info(${vaultAddress})`,
  );
  if (!info) return null;

  const milestones: PanelMilestone[] = (info.milestones ?? []).map((m: any) => ({
    id: Number(m.id),
    amount: BigInt(m.amount ?? 0),
    released: Boolean(m.released),
    failed: Boolean(m.failed),
    vote_opens_at: BigInt(m.vote_opens_at ?? 0),
    approved_weight: BigInt(m.approved_weight ?? 0),
  }));
  const counted = milestonesToCount(milestones);

  const [vote, wallets, stakes] = await Promise.all([
    // The bar is the same for every milestone of a vault; one read serves all.
    milestones.length > 0 ? readMilestoneVote(vaultAddress, milestones[0].id) : null,
    Promise.all(counted.map(async (m) => [m.id, await readMilestoneWallets(vaultAddress, m.id)] as const)),
    Promise.all(counted.map(async (m) => [m.id, await readMilestoneStake(vaultAddress, m.id)] as const)),
  ]);

  return {
    milestones,
    raised: BigInt(info.raised_amount ?? 0),
    windowSecs: Number(info.voting_window_secs ?? 0),
    token: info.token ? String(info.token) : null,
    requiredWeight: vote ? vote[1] : null,
    wallets: Object.fromEntries(wallets),
    stakes: Object.fromEntries(stakes),
  };
}

/** How long a vote tally is served from the cache to browsers. */
export const VOTE_TALLY_TTL_MS = 10_000;

/** readVoteTally through the read cache; `fresh` reads again. */
export function readVoteTallyCached(vaultAddress: string, options: { fresh?: boolean } = {}) {
  return cachedRead(
    `vote-tally:${vaultAddress}`,
    VOTE_TALLY_TTL_MS,
    () => readVoteTally(vaultAddress),
    options,
  );
}

/**
 * One stakeholder's side: their weight after the cap, and which of these
 * milestones they have voted on. Never cached: it is theirs, and it changes
 * the moment they vote.
 */
export async function readMyVotes(
  vaultAddress: string,
  contributor: string,
  milestoneIds: number[],
): Promise<MyVotes> {
  const vault = vaultClient(vaultAddress);
  const [weight, voted] = await Promise.all([
    simulate(() => vault.get_voting_weight({ contributor }), `get_voting_weight(${vaultAddress})`),
    Promise.all(
      milestoneIds.map(async (id) => [
        id,
        Boolean(
          await simulate(
            () => vault.has_voted({ milestone_id: id, contributor }),
            `has_voted(${vaultAddress})`,
          ),
        ),
      ] as const),
    ),
  ]);
  return {
    weight: BigInt((weight as bigint | null) ?? 0n),
    voted: Object.fromEntries(voted),
  };
}

/**
 * What a stakeholder still has in the vault, in its token's base units: what
 * they put in, less any refund already collected. Null when the vault did not
 * answer. Never cached: it is theirs, and it changes when they act.
 */
export async function readContributorBalance(
  vaultAddress: string,
  contributor: string,
): Promise<bigint | null> {
  const balance = await simulate(
    () => vaultClient(vaultAddress).get_balance({ contributor }),
    `get_balance(${vaultAddress})`,
  );
  return balance === null ? null : BigInt(balance as bigint);
}
