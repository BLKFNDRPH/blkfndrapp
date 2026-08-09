import "server-only";

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { vaultClient, NETWORK_PASSPHRASE } from "@/lib/stellar-clients";

/**
 * The abandoned-vault reclaim trigger.
 *
 * A funded vault advances only when the builder opens the next milestone vote —
 * an action no one else can take. `settle_stalled` is the vault's permissionless
 * escape hatch: after the stall window, anyone may fail an abandoned project so
 * its contributors can reclaim their principal. Soroban has no cron, so a
 * scheduled request to /api/settle-stalled presses the button on whichever
 * vaults are due.
 *
 * Eligibility is decided on-chain, not here. For each candidate vault the
 * `settle_stalled` transaction is assembled — which simulates it — and only the
 * ones that would succeed are submitted. A vault that is not stalled (still
 * inside its window, mid-vote, already resolved, not funded, or an older vault
 * without the entrypoint) reverts in simulation and is skipped without paying a
 * fee. The submitter key pays gas and nothing more; the authority to reclaim is
 * the contract's, not this signature.
 */

export interface SettleStalledResult {
  status: "done" | "skipped";
  detail: string;
  /** Vaults actually reclaimed this run. */
  reclaimed: number;
  /** Candidate vaults simulated. */
  checked: number;
  vaults?: string[];
}

export async function triggerSettleStalled(): Promise<SettleStalledResult> {
  const submitterSecret = process.env.OPS_FUNDING_SUBMITTER_SECRET;
  if (!submitterSecret) {
    return {
      status: "skipped",
      detail: "OPS_FUNDING_SUBMITTER_SECRET is not set.",
      reclaimed: 0,
      checked: 0,
    };
  }

  // Only a funded or active project can be abandoned; anything else (raising,
  // refunding, completed, failed) cannot stall and is not even simulated. The DB
  // status can lag the chain, but that only widens or narrows the candidate set —
  // the on-chain simulation below is the real gate.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("vault_address")
    .in("status", ["funded", "active"]);
  if (error) {
    throw new Error(`Could not list candidate vaults: ${error.message}`);
  }

  const vaults = (data ?? [])
    .map((r) => r.vault_address)
    .filter((a): a is string => Boolean(a));

  if (vaults.length === 0) {
    return {
      status: "skipped",
      detail: "No funded or active vaults to check.",
      reclaimed: 0,
      checked: 0,
    };
  }

  const kp = Keypair.fromSecret(submitterSecret);
  const signer = {
    publicKey: kp.publicKey(),
    signTransaction: async (xdr: string) => {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
      tx.sign(kp);
      return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
    },
  };

  const reclaimed: string[] = [];
  for (const vaultAddress of vaults) {
    try {
      // Assembling settle_stalled simulates it. A vault that is not due reverts
      // here (NotStalled / VotingAlreadyOpen / InvalidStatus, or no such method
      // on an older vault) and drops to the catch below — the common case.
      const tx = await vaultClient(vaultAddress, signer).settle_stalled();
      const res = (await tx.signAndSend()) as {
        getTransactionResponse?: { status?: string };
        status?: string;
      };
      const status = res?.getTransactionResponse?.status ?? res?.status ?? "SENT";
      if (status !== "SUCCESS" && status !== "SENT") {
        console.error(`[settle-stalled] ${vaultAddress} submit returned ${status}`);
        continue;
      }
      reclaimed.push(vaultAddress);
    } catch {
      // Not stalled or not eligible — skip quietly and try again next run.
    }
  }

  return {
    status: reclaimed.length > 0 ? "done" : "skipped",
    detail:
      reclaimed.length > 0
        ? `Reclaimed ${reclaimed.length} abandoned vault(s) of ${vaults.length} checked.`
        : `No abandoned vaults were due (checked ${vaults.length}).`,
    reclaimed: reclaimed.length,
    checked: vaults.length,
    ...(reclaimed.length > 0 ? { vaults: reclaimed } : {}),
  };
}
