/**
 * What a stakeholder's refund comes to, worked out the way the vault's
 * claim_refund works it out (contracts/blkfndr-vault/src/lib.rs), in base
 * units, truncating where the contract truncates. The refund sheet shows these
 * figures, so the number on its button is the number that arrives.
 *
 *   Failed (deadline passed short of the goal): the whole stake comes back.
 *     The builder's deposit returns to the builder separately.
 *   Refunding (a stage failed its vote, or the builder went quiet): the stake
 *     as a share of everything staked, applied to what is left in the vault and
 *     to the builder's deposit.
 *
 * The last stakeholder to collect from a Refunding vault also sweeps the
 * fractions left behind by everyone else's rounding, so their figure can be a
 * few stroops higher than this. Nothing here can be lower than what arrives.
 */

export const VAULT_STATE_FAILED = 3;
export const VAULT_STATE_REFUNDING = 4;

export interface RefundBreakdown {
  /** The whole stake comes back (a missed goal). */
  full: boolean;
  /** The stake, as the vault holds it. */
  stake: bigint;
  /** The stake's share of what is still in the vault. */
  stakeShare: bigint;
  /** The stake's part of what was already paid to the builder. */
  paidOut: bigint;
  /** The stake's share of the builder's deposit. */
  depositShare: bigint;
  /** What arrives in the wallet. */
  total: bigint;
}

export function refundBreakdown(
  state: number,
  stake: bigint,
  raised: bigint,
  released: bigint,
  bond: bigint,
): RefundBreakdown {
  if (state === VAULT_STATE_FAILED || raised <= 0n) {
    return { full: true, stake, stakeShare: stake, paidOut: 0n, depositShare: 0n, total: stake };
  }
  const remaining = raised - released;
  const stakeShare = (stake * remaining) / raised;
  const depositShare = (stake * bond) / raised;
  return {
    full: false,
    stake,
    stakeShare,
    paidOut: stake - stakeShare,
    depositShare,
    total: stakeShare + depositShare,
  };
}
