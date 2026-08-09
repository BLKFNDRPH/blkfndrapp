import "server-only";

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { Client as TreasuryClient } from "@/packages/blkfndr_treasury/src";
import {
  factoryClient,
  simulate,
  SOROBAN_RPC_URL,
  NETWORK_PASSPHRASE,
} from "@/lib/stellar-clients";

/**
 * The monthly gas top-up trigger.
 *
 * The treasury's fund_operations routes a voted share of its XLM to the
 * Operations Vault every thirty days. The contract is permissionless and
 * time-gated, so it does not need an owner — it needs someone to press the
 * button once the gate has passed. Soroban has no cron, so a scheduled request
 * to /api/ops-funding presses it; this is what that request runs.
 *
 * It reads before it writes: if funding is not configured, not yet due, or has
 * nothing above the reserved balance to move, it returns a clean skip rather than
 * sending a transaction that would only revert. When it does fund, the submitter
 * key pays the network fee — that key is a gas payer and nothing more; the
 * transfer's authority is the owners' earlier vote, not this signature.
 */

export interface OpsFundingResult {
  status: "funded" | "skipped";
  detail: string;
  /** Stroops routed, when status is "funded". */
  amount?: string;
}

export async function triggerOpsFunding(treasuryOverride?: string): Promise<OpsFundingResult> {
  const submitterSecret = process.env.OPS_FUNDING_SUBMITTER_SECRET;
  if (!submitterSecret) {
    return { status: "skipped", detail: "OPS_FUNDING_SUBMITTER_SECRET is not set." };
  }

  // The treasury is wherever the factory currently sends fees — the same source
  // the app reads, so this follows a redeploy automatically. Overridable for
  // tests.
  const treasuryAddr =
    treasuryOverride ??
    ((await simulate(() => factoryClient().get_fee_wallet(), "get_fee_wallet")) as
      | string
      | null);
  if (!treasuryAddr) {
    return { status: "skipped", detail: "Could not resolve the treasury address." };
  }

  const kp = Keypair.fromSecret(submitterSecret);
  const client = new TreasuryClient({
    contractId: treasuryAddr,
    rpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: kp.publicKey(),
    signTransaction: async (xdr: string) => {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
      tx.sign(kp);
      return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
    },
  });

  const funding = await simulate(() => client.get_ops_funding(), "get_ops_funding");
  if (!funding) {
    return { status: "skipped", detail: "Operations funding is not configured on the treasury." };
  }

  const nextAt = Number((await simulate(() => client.next_ops_funding_at(), "next_ops_funding_at")) ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (nextAt > now) {
    return { status: "skipped", detail: `Not due until ${new Date(nextAt * 1000).toISOString()}.` };
  }

  const availableRaw = await simulate(() => client.ops_funding_available(), "ops_funding_available");
  const available = BigInt((availableRaw ?? 0).toString());
  if (available <= 0n) {
    return { status: "skipped", detail: "Nothing above the reserved balance to route." };
  }

  const tx = await client.fund_operations();
  const res = (await tx.signAndSend()) as {
    getTransactionResponse?: { status?: string };
    status?: string;
  };
  const status = res?.getTransactionResponse?.status ?? res?.status ?? "SENT";
  if (status !== "SUCCESS" && status !== "SENT") {
    throw new Error(`fund_operations did not succeed on-chain (${status}).`);
  }

  return {
    status: "funded",
    detail: `Routed the monthly cut to the operations vault (${status}).`,
    amount: available.toString(),
  };
}
