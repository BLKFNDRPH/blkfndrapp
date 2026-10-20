import "server-only";

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { vaultClient, NETWORK_PASSPHRASE } from "@/lib/stellar-clients";
import { runKeeperPass, type KeeperAction } from "./governance-keeper-pass";

export type { KeeperAction } from "./governance-keeper-pass";

/**
 * The governance keeper: carries out what a vault's rules have already
 * decided, so nobody has to remember to.
 *
 * - An approved payout (a stage whose vote carried) is sent to the builder:
 *   release_milestone.
 * - A stage whose voting window ended short is closed, which opens refunds:
 *   settle_lapsed_milestone.
 * - A vault that missed its goal by the deadline has that outcome written to
 *   the builder's public record: settle.
 * - A vault that missed its goal and still holds the builder's bond sends it
 *   back: return_bond. A missed goal is not a default, so the bond was never
 *   at stake; before this the builder had no button for it. Backers are not
 *   paid out this way: each claims their own refund.
 *
 * Every one of these is permissionless and gated by the vault itself, so this
 * key decides nothing. It cannot release a stage that hasn't carried, close one
 * that has, return a bond the vault still holds against the builder, or touch
 * a vote; it can only make something happen sooner than a stakeholder would
 * have pressed the button. Owner decision 2026-10-02 (the design brief's open
 * decision 5): allowed, as a permissionless executor that can delay but never
 * decide.
 *
 * Each call is simulated first and sent only if the vault accepts it, so a run
 * with nothing due sends nothing and pays nothing. The submitter key is the
 * same OPS_FUNDING_SUBMITTER_SECRET gas payer the other keepers use. What a
 * pass reads and tries, in what order, is in governance-keeper-pass.ts.
 */

export interface GovernanceKeeperResult {
  status: "done" | "skipped";
  detail: string;
  checked: number;
  actions: KeeperAction[];
}

type Signer = {
  publicKey: string;
  signTransaction: (xdr: string) => Promise<{ signedTxXdr: string; signerAddress: string }>;
};

export async function runGovernanceKeeper(
  options: { dryRun?: boolean; sourcePublicKey?: string } = {},
): Promise<GovernanceKeeperResult> {
  const dryRun = Boolean(options.dryRun);
  const secret = process.env.OPS_FUNDING_SUBMITTER_SECRET;

  let signer: Signer;
  if (secret) {
    const kp = Keypair.fromSecret(secret);
    signer = {
      publicKey: kp.publicKey(),
      signTransaction: async (xdr: string) => {
        const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
        tx.sign(kp);
        return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
      },
    };
  } else if (dryRun && options.sourcePublicKey) {
    // A dry run only simulates, which needs a source account but no key.
    signer = {
      publicKey: options.sourcePublicKey,
      signTransaction: async () => {
        throw new Error("A dry run never signs.");
      },
    };
  } else {
    return { status: "skipped", detail: "OPS_FUNDING_SUBMITTER_SECRET is not set.", checked: 0, actions: [] };
  }

  // Anything that isn't closed out. A completed vault has paid everything and
  // a refunding one holds nothing this key may move, but a failed raise stays
  // a candidate: its bond is due back, and only the vault knows whether it
  // has gone. The database can lag the chain, which only widens or narrows
  // the list; each vault's own state, read in the pass, decides what is due.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("vault_address, status")
    .not("vault_address", "is", null)
    .not("status", "in", "(completed,refunding)");
  if (error) throw new Error(`Could not list candidate vaults: ${error.message}`);

  const vaults = [...new Set((data ?? []).map((r) => r.vault_address).filter((a): a is string => Boolean(a)))];

  const { actions } = await runKeeperPass(
    vaults,
    {
      // Reads with no signer are plain simulations; writes are built from the key.
      read: (vault) => vaultClient(vault),
      write: (vault) => vaultClient(vault, signer),
    },
    dryRun,
  );

  const done = actions.filter((a) => a.outcome === "sent" || a.outcome === "would-send");
  return {
    status: done.length > 0 ? "done" : "skipped",
    detail:
      done.length > 0
        ? `${dryRun ? "Would act on" : "Acted on"} ${done.length} item(s) across ${vaults.length} vault(s) checked.`
        : `Nothing was due (checked ${vaults.length} vault(s)).`,
    checked: vaults.length,
    actions,
  };
}
