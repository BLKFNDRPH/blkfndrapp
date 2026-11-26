import "server-only";

import { Keypair, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ATTESTATION_ID,
  FACTORY_ID,
  IDENTITY_ID,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URL,
} from "@/lib/stellar-clients";
import {
  SponsorRefusalError,
  checkInnerTransaction,
  isContractAllowed,
  planFeeBump,
  readSponsorConfig,
  sponsorIsOn,
  type SponsorRefusal,
} from "./policy";

/**
 * /api/sponsor's work: check the user's signed contract call, claim a slot
 * against the caps, wrap the call in a fee-bump signed by the ops key, submit
 * it. The rules are in policy.ts; why a fee-bump is safe to offer is there too.
 *
 * The ops key signs only the outer fee-bump envelope. It never signs, and
 * cannot change, the inner transaction.
 */

export interface SponsorResult {
  hash: string;
  /** The RPC's answer to the submission: PENDING or DUPLICATE. */
  status: string;
  /** The fee the bump bid, in stroops: the most it can cost. */
  feeStroops: string;
}

/** The two-part kill switch, read fresh on every request. */
async function sponsorshipIsOn(): Promise<boolean> {
  const config = readSponsorConfig(process.env);
  const opsKeyConfigured = !!process.env.OPS_FUNDING_SUBMITTER_SECRET;
  if (!config.enabled || !opsKeyConfigured) return false;

  let paused: boolean | null = null;
  try {
    const { data, error } = await createAdminClient()
      .from("platform_settings")
      .select("sponsor_paused")
      .eq("id", true)
      .maybeSingle();
    if (!error && data) paused = data.sponsor_paused;
  } catch {
    paused = null;
  }
  return sponsorIsOn({ envEnabled: config.enabled, pausedInDatabase: paused, opsKeyConfigured });
}

async function linkedWallet(userId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("stellar_public_key")
    .eq("id", userId)
    .maybeSingle();
  return data?.stellar_public_key ?? null;
}

async function isIndexedVault(contractId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("projects")
    .select("vault_address")
    .eq("vault_address", contractId)
    .maybeSingle();
  return !!data;
}

const refuse = (code: SponsorRefusal, message: string): never => {
  throw new SponsorRefusalError(code, message);
};

export async function sponsorTransaction(input: {
  userId: string;
  innerXdr: string;
}): Promise<SponsorResult> {
  if (!(await sponsorshipIsOn())) {
    refuse("disabled", "Fee sponsorship is unavailable right now. Pay the fee from your wallet.");
  }
  const config = readSponsorConfig(process.env);
  const ops = Keypair.fromSecret(process.env.OPS_FUNDING_SUBMITTER_SECRET!);

  const wallet = await linkedWallet(input.userId);
  if (!wallet) refuse("no_linked_wallet", "Set up your wallet on this account first.");
  if (wallet === ops.publicKey()) refuse("wrong_source", "This wallet can't be sponsored.");

  const call = checkInnerTransaction({
    xdr: input.innerXdr,
    networkPassphrase: NETWORK_PASSPHRASE,
    expectedSource: wallet!,
  });

  const configured = [FACTORY_ID, IDENTITY_ID, ATTESTATION_ID];
  const indexed = configured.includes(call.contractId)
    ? false
    : await isIndexedVault(call.contractId);
  if (!isContractAllowed(call.contractId, configured, indexed)) {
    refuse("contract_not_listed", "BLKFNDR covers the fee only for calls to its own contracts.");
  }

  const plan = planFeeBump(call.tx, config.maxFeeStroops);

  // The cap check and the record are one database call under a lock.
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc("claim_sponsor_slot", {
    p_user_id: input.userId,
    p_account: call.source,
    p_contract_id: call.contractId,
    p_function_name: call.functionName,
    p_fee_stroops: Number(plan.totalFee),
    p_per_account_daily: config.perAccountDaily,
    p_daily_budget_stroops: Number(config.dailyBudgetStroops),
  });
  if (claimError) throw new Error(`Could not claim a sponsorship slot: ${claimError.message}`);
  const row = Array.isArray(claimed) ? claimed[0] : null;
  if (!row || row.refusal === "account_cap") {
    refuse("account_cap", "You've used today's covered network fees. Pay this one from your wallet.");
  }
  if (row!.refusal === "budget_exhausted" || row!.slot_id == null) {
    refuse("budget_exhausted", "Today's fee sponsorship budget is used up. Pay the fee from your wallet.");
  }
  const slotId = row!.slot_id!;

  const bump = TransactionBuilder.buildFeeBumpTransaction(
    ops,
    plan.baseFee.toString(),
    call.tx,
    NETWORK_PASSPHRASE,
  );
  bump.sign(ops);

  let sent: rpc.Api.SendTransactionResponse;
  try {
    sent = await new rpc.Server(SOROBAN_RPC_URL).sendTransaction(bump);
  } catch (error) {
    // Unknown whether it reached the network: keep the slot counted.
    await admin.rpc("settle_sponsor_slot", { p_slot_id: slotId, p_status: "submitted", p_tx_hash: bump.hash().toString("hex") });
    throw error;
  }

  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    // Refused before any ledger: no fee was charged, so it stops counting.
    await admin.rpc("settle_sponsor_slot", { p_slot_id: slotId, p_status: "rejected", p_tx_hash: sent.hash });
    refuse(
      "submit_rejected",
      sent.status === "TRY_AGAIN_LATER"
        ? "The network is busy. Pay the fee from your wallet, or try again in a minute."
        : "The network refused the sponsored transaction. Nothing was moved.",
    );
  }

  await admin.rpc("settle_sponsor_slot", { p_slot_id: slotId, p_status: "submitted", p_tx_hash: sent.hash });
  return { hash: sent.hash, status: sent.status, feeStroops: plan.totalFee.toString() };
}
