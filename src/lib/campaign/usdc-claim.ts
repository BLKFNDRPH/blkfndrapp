import "server-only";

import { Asset, BASE_FEE, Keypair, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSecret } from "@/lib/secrets";
import { IS_PRACTICE_NETWORK, NETWORK_PASSPHRASE } from "@/lib/network";
import { horizonClient } from "@/lib/stellar";
import { bondAssetFor, type BondAsset } from "@/lib/bond-readiness";
import { tokenAddressFor } from "@/lib/currencies";
import { isStellarAccount } from "@/lib/stellar-address";
import {
  amountToStroops,
  claimConfig,
  claimEligibility,
  claimGate,
  type BalanceLine,
  type ClaimRefusal,
} from "@/lib/campaign/claim-rules";

/**
 * The campaign's practice-USDC dispenser.
 *
 * Pays a fixed amount of Testnet USDC to the signed-in account's linked wallet,
 * once per account and once per wallet, from a distributor account whose key
 * is CAMPAIGN_USDC_DISTRIBUTOR_SECRET. It is a plain classic payment: the
 * distributor signs for its own balance and nothing else; it has no authority
 * over the recipient's wallet, which keeps the USDC (the non-custodial rule in
 * docs/design/web3-accessibility-redesign.md).
 *
 * The distributor should be an ordinary account that holds USDC, funded from
 * the issuer or from Circle's faucet, not the issuer itself: an issuer key
 * mints without limit, and a distributor key can lose at most its balance.
 *
 * Order of checks: network and kill switch (configuration only), then the key,
 * then the account's linked wallet and its previous claim (database), then the
 * wallet's trustline (Horizon), then the atomic reservation that enforces once
 * per account, once per wallet and the daily cap, and only then the payment.
 */

export type ClaimResult =
  | { ok: true; txHash: string; amount: string; wallet: string }
  | { ok: false; code: ClaimRefusal };

/** The USDC the vaults use, read from its token contract. */
async function campaignAsset(): Promise<BondAsset | null> {
  try {
    const asset = await bondAssetFor(tokenAddressFor("USDC"));
    return asset && !asset.isNative && asset.issuer ? asset : null;
  } catch {
    return null;
  }
}

/** Balances of a ledger account, or null when it does not exist. Throws on a network failure. */
async function balancesOf(address: string): Promise<BalanceLine[] | null> {
  try {
    const account = await horizonClient.loadAccount(address);
    return account.balances as BalanceLine[];
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 404) return null;
    throw error;
  }
}

/** Horizon's result codes, when the network itself refused the transaction. */
function refusalCodes(error: unknown): unknown {
  return (error as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response
    ?.data?.extras?.result_codes;
}

/** The linked wallet and whether this account or wallet already has a claim. */
async function claimantState(userId: string) {
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("stellar_public_key")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read profile: ${error.message}`);

  const wallet = isStellarAccount(profile?.stellar_public_key) ? profile!.stellar_public_key! : null;

  let query = admin
    .from("campaign_usdc_claims")
    .select("id, status, tx_hash, amount_stroops, created_at")
    .in("status", ["pending", "paid"]);
  query = wallet ? query.or(`user_id.eq.${userId},wallet_address.eq.${wallet}`) : query.eq("user_id", userId);
  const { data: claims, error: claimError } = await query.limit(1);
  if (claimError) throw new Error(`Could not read claims: ${claimError.message}`);

  return { wallet, claim: claims?.[0] ?? null };
}

/** What the campaign page shows about the dispenser for this account. */
export async function claimStatus(userId: string) {
  const config = claimConfig(process.env);
  const gate = claimGate({ isTestnet: IS_PRACTICE_NETWORK, config });
  const { wallet, claim } = await claimantState(userId);
  return {
    open: gate === null,
    closedReason: gate,
    amount: config.amount,
    linkedWallet: wallet,
    claim: claim
      ? { status: claim.status, txHash: claim.tx_hash, createdAt: claim.created_at }
      : null,
  };
}

export async function claimPracticeUsdc(userId: string): Promise<ClaimResult> {
  const config = claimConfig(process.env);
  const gate = claimGate({ isTestnet: IS_PRACTICE_NETWORK, config });
  if (gate) return { ok: false, code: gate };

  const secret = await getSecret("campaign_usdc_distributor_secret");
  let distributor: Keypair;
  try {
    if (!secret) return { ok: false, code: "not-configured" };
    distributor = Keypair.fromSecret(secret);
  } catch {
    console.error("[campaign] CAMPAIGN_USDC_DISTRIBUTOR_SECRET is not a valid Stellar secret key.");
    return { ok: false, code: "not-configured" };
  }

  const { wallet, claim } = await claimantState(userId);
  // Answer the questions the database can settle before asking the network.
  if (!wallet || wallet === distributor.publicKey()) return { ok: false, code: "no-wallet" };
  if (claim) return { ok: false, code: "already-claimed" };

  const asset = await campaignAsset();
  if (!asset?.issuer) return { ok: false, code: "unavailable" };

  let balances: BalanceLine[] | null;
  try {
    balances = await balancesOf(wallet);
  } catch (error) {
    console.error("[campaign] Could not read the claimant's wallet:", error);
    return { ok: false, code: "unavailable" };
  }

  const refusal = claimEligibility({
    linkedWallet: wallet,
    alreadyClaimed: false,
    balances,
    asset: { code: asset.code, issuer: asset.issuer },
    distributor: distributor.publicKey(),
  });
  if (refusal) return { ok: false, code: refusal };

  // Admit the claim atomically: once per account, once per wallet, under the cap.
  const admin = createAdminClient();
  const { data: reserved, error: reserveError } = await admin.rpc("campaign_reserve_usdc_claim", {
    p_user_id: userId,
    p_wallet: wallet,
    p_amount_stroops: Number(amountToStroops(config.amount)),
    p_asset_code: asset.code,
    p_asset_issuer: asset.issuer,
    p_daily_cap: config.dailyCap,
  });
  if (reserveError) {
    console.error("[campaign] Could not reserve the claim:", reserveError.message);
    return { ok: false, code: "unavailable" };
  }
  const row = reserved?.[0];
  if (!row || row.outcome === "already-claimed") return { ok: false, code: "already-claimed" };
  if (row.outcome === "daily-cap") return { ok: false, code: "daily-cap" };
  const claimId = row.claim_id!;

  const settle = (patch: { status: "paid" | "failed" | "pending"; tx_hash?: string; error?: string }) =>
    admin
      .from("campaign_usdc_claims")
      .update({ ...patch, settled_at: patch.status === "pending" ? null : new Date().toISOString() })
      .eq("id", claimId)
      .then(({ error }) => {
        if (error) console.error(`[campaign] Could not record claim ${claimId}:`, error.message);
      });

  let txHash: string | undefined;
  try {
    const source = await horizonClient.loadAccount(distributor.publicKey());
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(
        Operation.payment({
          destination: wallet,
          asset: new Asset(asset.code, asset.issuer),
          amount: config.amount,
        }),
      )
      .addMemo(Memo.text("BLKFNDR practice USDC"))
      .setTimeout(60)
      .build();
    tx.sign(distributor);
    txHash = tx.hash().toString("hex");

    await horizonClient.submitTransaction(tx);
    await settle({ status: "paid", tx_hash: txHash });
    return { ok: true, txHash, amount: config.amount, wallet: wallet };
  } catch (error) {
    const codes = refusalCodes(error);
    if (codes || !txHash) {
      // The network refused it, or it was never sent: nothing moved, so the
      // account and wallet are free to try again.
      console.error("[campaign] Practice USDC payment refused:", codes ?? error);
      await settle({ status: "failed", error: JSON.stringify(codes ?? String(error)).slice(0, 500) });
      return { ok: false, code: "payment-failed" };
    }
    // Sent, but no answer: it may have landed. Keep the claim held (pending)
    // with its hash so nobody is paid twice; an operator can check it on
    // Stellar Expert and mark it paid or failed.
    console.error("[campaign] Practice USDC payment outcome unknown:", error);
    await settle({ status: "pending", tx_hash: txHash, error: String(error).slice(0, 500) });
    return { ok: false, code: "payment-pending" };
  }
}
