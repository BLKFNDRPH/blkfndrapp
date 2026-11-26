/**
 * Fee sponsorship: what /api/sponsor will pay the network fee for, and how much.
 *
 * BLKFNDR's ops key (OPS_FUNDING_SUBMITTER_SECRET, XLM only) wraps a stakeholder's
 * own signed transaction in a fee-bump and pays the fee. A fee-bump cannot change,
 * add to or replay what the inner transaction does: the inner envelope and its
 * signatures are carried byte for byte, and the ops key never signs the inner
 * transaction. So sponsorship only ever moves the ops key's XLM, and the risk to
 * guard is the budget being drained, not the user's money (design brief,
 * decision 6; sprint 2 plan, item 1.6 and risk "Sponsored fees can be drained").
 *
 * This file is the pure half: parsing the inner transaction, the allowlist, the
 * fee a bump would bid, the caps arithmetic and the kill switch. The route and
 * the database hold the rest. Self-contained (the Stellar SDK only) so node
 * --test can load it: policy.test.ts.
 *
 * The client always keeps the self-paid path: every refusal here is a reason to
 * fall back to paying the fee from the user's own wallet, never a dead end.
 */

import {
  Address,
  BASE_FEE,
  FeeBumpTransaction,
  Keypair,
  StrKey,
  TransactionBuilder,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";

// ── Refusals ────────────────────────────────────────────────────────────────

/**
 * Every reason /api/sponsor declines, as the code the client sees. The client
 * maps all of them to "pay the fee yourself"; `disabled` is the one the design
 * names "Fee sponsorship is unavailable right now".
 */
export const SPONSOR_REFUSALS = {
  /** The kill switch is off, or the ops key is not configured. HTTP 503. */
  disabled: 503,
  /** The account has no wallet set up. */
  no_linked_wallet: 409,
  /** The inner transaction's source is not the caller's linked wallet. */
  wrong_source: 409,
  /** Not a transaction envelope, or a fee-bump already. */
  bad_xdr: 400,
  /** Not signed by its source for this network. */
  wrong_network_or_unsigned: 400,
  /** Anything but exactly one InvokeHostFunction calling a contract. */
  not_single_contract_call: 400,
  /** The contract called is not on the sponsored list. */
  contract_not_listed: 400,
  /** The bump would bid more than the per-transaction maximum. */
  fee_too_high: 400,
  /** This account has used today's sponsored transactions. */
  account_cap: 429,
  /** Today's total sponsorship budget is spent. */
  budget_exhausted: 429,
  /** The network refused the fee-bump before it reached a ledger. */
  submit_rejected: 502,
} as const;

export type SponsorRefusal = keyof typeof SPONSOR_REFUSALS;

export class SponsorRefusalError extends Error {
  readonly code: SponsorRefusal;
  constructor(code: SponsorRefusal, message: string) {
    super(message);
    this.name = "SponsorRefusalError";
    this.code = code;
  }
  get status(): number {
    return SPONSOR_REFUSALS[this.code];
  }
}

// ── Configuration ───────────────────────────────────────────────────────────

/**
 * Defaults are placeholders pending decision D3 (sprint 2 plan: "daily cap per
 * account and total budget"), set low on purpose: a griefer who signs up many
 * accounts still meets the global budget first.
 */
export const SPONSOR_DEFAULTS = {
  /** Sponsored transactions per account per UTC day. */
  perAccountDaily: 20,
  /** Total fee bids per UTC day, in stroops: 10 XLM. */
  dailyBudgetStroops: 100_000_000n,
  /** The most one fee-bump may bid, in stroops: 0.1 XLM. */
  maxFeeStroops: 1_000_000n,
} as const;

export interface SponsorConfig {
  /** SPONSOR_ENABLED, the deploy-time half of the kill switch. */
  enabled: boolean;
  perAccountDaily: number;
  dailyBudgetStroops: bigint;
  maxFeeStroops: bigint;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function positiveBigInt(raw: string | undefined, fallback: bigint): bigint {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback;
  const n = BigInt(raw.trim());
  return n > 0n ? n : fallback;
}

/**
 * Read the sponsorship settings. Unset means off: SPONSOR_ENABLED must be
 * exactly "true" (or "1"). A malformed cap falls back to its default rather than
 * to "no cap".
 */
export function readSponsorConfig(env: Record<string, string | undefined>): SponsorConfig {
  const flag = (env.SPONSOR_ENABLED ?? "").trim().toLowerCase();
  return {
    enabled: flag === "true" || flag === "1",
    perAccountDaily: positiveInt(env.SPONSOR_PER_ACCOUNT_DAILY, SPONSOR_DEFAULTS.perAccountDaily),
    dailyBudgetStroops: positiveBigInt(
      env.SPONSOR_DAILY_BUDGET_STROOPS,
      SPONSOR_DEFAULTS.dailyBudgetStroops,
    ),
    maxFeeStroops: positiveBigInt(env.SPONSOR_MAX_FEE_STROOPS, SPONSOR_DEFAULTS.maxFeeStroops),
  };
}

/**
 * The kill switch has two halves and both must say yes: SPONSOR_ENABLED, set at
 * deploy, and platform_settings.sponsor_paused, which an operator can flip
 * without a redeploy. A pause flag that could not be read counts as paused.
 */
export function sponsorIsOn(input: {
  envEnabled: boolean;
  pausedInDatabase: boolean | null;
  opsKeyConfigured: boolean;
}): boolean {
  return input.envEnabled && input.opsKeyConfigured && input.pausedInDatabase === false;
}

// ── The inner transaction ───────────────────────────────────────────────────

export interface InnerCall {
  tx: Transaction;
  source: string;
  contractId: string;
  functionName: string;
}

/**
 * Parse and check the user's signed transaction. Throws SponsorRefusalError.
 *
 * - a plain transaction envelope (not already a fee-bump);
 * - its source is `expectedSource`, a G-address (no muxed accounts);
 * - it carries a valid signature by that source over its hash on
 *   `networkPassphrase`, which is also the network check: a transaction signed
 *   for another network does not verify here;
 * - exactly one operation, an InvokeHostFunction that invokes a contract (no
 *   payments, merges, set_options, wasm uploads or contract creation), with no
 *   operation source other than the transaction's own;
 * - the contract is in `allowed` (`isAllowed` for the ones looked up later).
 */
export function checkInnerTransaction(input: {
  xdr: string;
  networkPassphrase: string;
  expectedSource: string;
}): InnerCall {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(input.xdr, input.networkPassphrase);
  } catch {
    throw new SponsorRefusalError("bad_xdr", "That is not a Stellar transaction.");
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new SponsorRefusalError("bad_xdr", "The transaction is already fee-bumped.");
  }
  const tx = parsed;

  if (!StrKey.isValidEd25519PublicKey(tx.source)) {
    throw new SponsorRefusalError("wrong_source", "The transaction's source must be a plain G-address.");
  }
  if (tx.source !== input.expectedSource) {
    throw new SponsorRefusalError(
      "wrong_source",
      "The transaction is from a different wallet than the one set up on this account.",
    );
  }

  if (!isSignedBy(tx, tx.source)) {
    throw new SponsorRefusalError(
      "wrong_network_or_unsigned",
      "The transaction is not signed by its wallet for this network.",
    );
  }

  if (tx.operations.length !== 1) {
    throw new SponsorRefusalError(
      "not_single_contract_call",
      "Only a single contract call can be sponsored.",
    );
  }
  const op = tx.operations[0];
  if (op.type !== "invokeHostFunction") {
    throw new SponsorRefusalError(
      "not_single_contract_call",
      `A ${op.type} operation can't be sponsored, only a contract call.`,
    );
  }
  if (op.source !== undefined && op.source !== tx.source) {
    throw new SponsorRefusalError(
      "not_single_contract_call",
      "The contract call must come from the transaction's own wallet.",
    );
  }
  const func = op.func;
  if (func.switch().value !== xdr.HostFunctionType.hostFunctionTypeInvokeContract().value) {
    throw new SponsorRefusalError(
      "not_single_contract_call",
      "Only a call to an existing contract can be sponsored.",
    );
  }
  const args = func.invokeContract();
  const contractId = Address.fromScAddress(args.contractAddress()).toString();
  const fn = args.functionName();
  const functionName = typeof fn === "string" ? fn : fn.toString();

  return { tx, source: tx.source, contractId, functionName };
}

/** Whether `tx` carries a valid signature by `account` over its hash. */
export function isSignedBy(tx: Transaction, account: string): boolean {
  const kp = Keypair.fromPublicKey(account);
  const hint = kp.signatureHint();
  const hash = tx.hash();
  return tx.signatures.some((sig) => {
    if (!sig.hint().equals(hint)) return false;
    try {
      return kp.verify(hash, sig.signature());
    } catch {
      return false;
    }
  });
}

/**
 * The sponsored list: the factory, identity and attestation registries from
 * configuration, plus any vault the app has indexed (looked up by the caller and
 * passed as `isIndexedVault`). Empty or unset ids are ignored.
 */
export function isContractAllowed(
  contractId: string,
  configured: ReadonlyArray<string | undefined>,
  isIndexedVault: boolean,
): boolean {
  if (!StrKey.isValidContract(contractId)) return false;
  if (isIndexedVault) return true;
  return configured.some((id) => !!id && id === contractId);
}

// ── Fees ────────────────────────────────────────────────────────────────────

export interface FeeBumpPlan {
  /** Per-operation inclusion fee the bump bids, in stroops. */
  baseFee: bigint;
  /** The bump's total fee bid, in stroops: baseFee * (ops + 1) + resource fee. */
  totalFee: bigint;
}

/**
 * The fee a fee-bump of `tx` would bid, the same way
 * TransactionBuilder.buildFeeBumpTransaction computes it: the inner
 * transaction's own inclusion rate (never below the network minimum) for each
 * operation plus the bump itself, plus the inner Soroban resource fee. Throws
 * fee_too_high above `maxFee`.
 */
export function planFeeBump(tx: Transaction, maxFee: bigint): FeeBumpPlan {
  const ops = BigInt(tx.operations.length);
  let resourceFee = 0n;
  const env = tx.toEnvelope();
  if (env.switch().value === xdr.EnvelopeType.envelopeTypeTx().value) {
    const data = env.v1().tx().ext().value() as xdr.SorobanTransactionData | undefined;
    if (data) resourceFee = BigInt(data.resourceFee().toString());
  }
  if (resourceFee <= 0n || ops === 0n) {
    throw new SponsorRefusalError(
      "not_single_contract_call",
      "The contract call has not been simulated (no resource fee).",
    );
  }
  const inclusion = BigInt(tx.fee) - resourceFee;
  // Rounded up: buildFeeBumpTransaction refuses a base below the inner rate.
  const inclusionPerOp = inclusion > 0n ? (inclusion + ops - 1n) / ops : 0n;
  const minBase = BigInt(BASE_FEE);
  const baseFee = inclusionPerOp > minBase ? inclusionPerOp : minBase;
  const totalFee = baseFee * (ops + 1n) + resourceFee;
  if (totalFee > maxFee) {
    throw new SponsorRefusalError(
      "fee_too_high",
      `The network fee (${totalFee} stroops) is above what BLKFNDR covers per transaction.`,
    );
  }
  return { baseFee, totalFee };
}

// ── Caps ────────────────────────────────────────────────────────────────────

/** The UTC calendar day a usage row counts against, as YYYY-MM-DD. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The cap arithmetic. The database function claim_sponsor_slot does the same
 * check under a lock and is the one that decides; this is its specification,
 * kept beside the other rules so the tests pin it down.
 */
export function capRefusal(input: {
  accountCountToday: number;
  spentTodayStroops: bigint;
  fee: bigint;
  config: Pick<SponsorConfig, "perAccountDaily" | "dailyBudgetStroops">;
}): SponsorRefusal | null {
  if (input.accountCountToday >= input.config.perAccountDaily) return "account_cap";
  if (input.spentTodayStroops + input.fee > input.config.dailyBudgetStroops) return "budget_exhausted";
  return null;
}
