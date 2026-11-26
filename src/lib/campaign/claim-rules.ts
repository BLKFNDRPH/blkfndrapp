/**
 * Who may claim the campaign's practice USDC, and how much.
 *
 * The dispenser pays testnet USDC to the claimant's own linked wallet and
 * nowhere else (docs/design/web3-accessibility-redesign.md, the non-custodial
 * hard rule: "the dispenser only ever pays the user's own address"). The
 * address is read from the account's profile on the server; the request names
 * no address, so there is nothing to point elsewhere.
 *
 * Testnet only. Testnet USDC is free to get and impossible to cash out; on
 * Mainnet the same payment would be real money, so the route refuses outright
 * there, before it reads a key.
 *
 * Pure, so `npm test` runs it.
 */

/** Every refusal the claim can give, as a stable code the page maps to words. */
export type ClaimRefusal =
  | "mainnet"
  | "campaign-closed"
  | "not-configured"
  | "no-wallet"
  | "already-claimed"
  | "no-account"
  | "no-trustline"
  | "daily-cap"
  | "unavailable"
  | "payment-failed"
  | "payment-pending";

export interface ClaimConfig {
  /** CAMPAIGN_USDC_CLAIM_ENABLED=1. Anything else is the kill switch: closed. */
  enabled: boolean;
  /** The fixed amount per claim, as Horizon takes it: a decimal string, up to 7 places. */
  amount: string;
  /** Claims paid (or in flight) per UTC day across everyone. */
  dailyCap: number;
}

export const DEFAULT_CLAIM_AMOUNT = "100";
export const DEFAULT_DAILY_CAP = 50;
/** No single claim above this, whatever the environment says. */
export const MAX_CLAIM_AMOUNT = 1000;

const AMOUNT = /^\d{1,7}(\.\d{1,7})?$/;

/** Read the claim settings from the environment, falling back to safe values. */
export function claimConfig(env: Record<string, string | undefined>): ClaimConfig {
  const rawAmount = env.CAMPAIGN_USDC_CLAIM_AMOUNT?.trim();
  const amount =
    rawAmount && AMOUNT.test(rawAmount) && Number(rawAmount) > 0 && Number(rawAmount) <= MAX_CLAIM_AMOUNT
      ? rawAmount
      : DEFAULT_CLAIM_AMOUNT;

  const rawCap = env.CAMPAIGN_USDC_DAILY_CAP?.trim();
  const cap = rawCap && /^\d{1,6}$/.test(rawCap) ? Number(rawCap) : DEFAULT_DAILY_CAP;

  return {
    enabled: env.CAMPAIGN_USDC_CLAIM_ENABLED?.trim() === "1",
    amount,
    dailyCap: cap,
  };
}

/** The amount in stroops (7 decimal places), for the claims table. */
export function amountToStroops(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole) * 10_000_000n + BigInt((frac + "0000000").slice(0, 7));
}

/**
 * The checks that need nothing but configuration, in the order the route runs
 * them: network first, so Mainnet never reaches the key.
 */
export function claimGate(input: {
  isTestnet: boolean;
  config: ClaimConfig;
}): ClaimRefusal | null {
  if (!input.isTestnet) return "mainnet";
  if (!input.config.enabled) return "campaign-closed";
  if (input.config.dailyCap <= 0) return "campaign-closed";
  return null;
}

/** A Horizon balance line, as much of it as the trustline check reads. */
export interface BalanceLine {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance?: string;
  limit?: string;
  is_authorized?: boolean;
}

/** Whether the wallet holds a trustline to exactly this asset (issuer included). */
export function hasTrustline(
  balances: BalanceLine[],
  asset: { code: string; issuer: string },
): boolean {
  return balances.some(
    (b) =>
      b.asset_type !== "native" &&
      b.asset_code === asset.code &&
      b.asset_issuer === asset.issuer &&
      b.is_authorized !== false,
  );
}

/**
 * The per-person checks, once the wallet has been read. The database decides
 * "once per account and per wallet" and the daily cap atomically when it
 * reserves the claim; `alreadyClaimed` here is the early answer from a read,
 * so a repeat press is refused without touching the network.
 */
export function claimEligibility(input: {
  linkedWallet: string | null;
  alreadyClaimed: boolean;
  /** Null when the account does not exist on the ledger. */
  balances: BalanceLine[] | null;
  asset: { code: string; issuer: string } | null;
  /** The distributor's own address: it never pays itself. */
  distributor: string;
}): ClaimRefusal | null {
  if (!input.linkedWallet) return "no-wallet";
  if (input.linkedWallet === input.distributor) return "no-wallet";
  if (input.alreadyClaimed) return "already-claimed";
  if (!input.asset) return "unavailable";
  if (input.balances === null) return "no-account";
  if (!hasTrustline(input.balances, input.asset)) return "no-trustline";
  return null;
}

/** What each refusal says to the person, in the app's voice. */
export const CLAIM_MESSAGES: Record<ClaimRefusal, string> = {
  mainnet: "Practice USDC only exists on Testnet. This site is on Mainnet, so there's nothing to claim.",
  "campaign-closed": "The practice USDC dispenser is closed right now. Nothing was sent.",
  "not-configured": "The practice USDC dispenser isn't set up yet. Nothing was sent.",
  "no-wallet": "Link a wallet to your account first. Practice USDC only goes to your own linked wallet.",
  "already-claimed": "You've already claimed your practice USDC. It's one claim per account and per wallet.",
  "no-account": "Your wallet isn't active on Testnet yet. Fund it with Friendbot first, then try again.",
  "no-trustline": "Your wallet has no USDC trustline yet. Add it, then try again.",
  "daily-cap": "Today's practice USDC has all been claimed. Try again tomorrow (UTC).",
  unavailable: "We couldn't reach the Stellar network to check your wallet. Nothing was sent. Try again in a minute.",
  "payment-failed": "The network refused the payment. Nothing was sent. Try again in a minute.",
  "payment-pending":
    "The payment was sent but we couldn't confirm it landed. Check your wallet in a minute before trying again.",
};
