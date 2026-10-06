import "server-only";

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { vaultClient, NETWORK_PASSPHRASE } from "@/lib/stellar-clients";

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
 *
 * Every one of these is permissionless and gated by the vault itself, so this
 * key decides nothing. It cannot release a stage that hasn't carried, close one
 * that has, or touch a vote; it can only make something happen sooner than a
 * stakeholder would have pressed the button. Owner decision 2026-10-02 (the
 * design brief's open decision 5): allowed, as a permissionless executor that
 * can delay but never decide.
 *
 * Each call is simulated first and sent only if the vault accepts it, so a run
 * with nothing due sends nothing and pays nothing. The submitter key is the
 * same OPS_FUNDING_SUBMITTER_SECRET gas payer the other keepers use.
 */

/** A safety cap: even a run that finds a backlog sends at most this many. */
const MAX_SENDS_PER_RUN = 20;

const VAULT_STATE = { Raising: 0, Funded: 1, Active: 2, Failed: 3, Refunding: 4, Completed: 5 } as const;

export interface KeeperAction {
  vault: string;
  kind: "release" | "close-stage" | "record-missed-goal";
  milestoneId?: number;
  /** "sent", "would-send" in a dry run, or why it didn't go. */
  outcome: string;
}

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

/** A transaction the binding has assembled, as far as this file uses it. */
interface Assembled {
  simulationData: unknown;
  signAndSend: () => Promise<unknown>;
}

/**
 * Simulate, and send only if the vault accepted it.
 *
 * The binding does not throw on a contract refusal when the call is built;
 * the refusal surfaces when the simulation is read. So it is read first, and a
 * refusal -- the common case: nothing due -- returns null without sending.
 * A sent transaction counts only if the ledger applied it: send() resolves on
 * a FAILED status too.
 */
async function trySend(build: () => Promise<Assembled>, dryRun: boolean): Promise<string | null> {
  let tx: Assembled;
  try {
    tx = await build();
    void tx.simulationData;
  } catch {
    return null;
  }
  if (dryRun) return "would-send";
  try {
    const res = (await tx.signAndSend()) as { getTransactionResponse?: { status?: string } };
    const status = res?.getTransactionResponse?.status;
    return status === "SUCCESS" ? "sent" : `not applied (${status ?? "no status"})`;
  } catch (error) {
    return `send failed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
  }
}

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

  // Anything that isn't already closed out. The database can lag the chain,
  // which only widens or narrows the candidates; each vault's own state, read
  // below, decides what is actually due.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("vault_address, status")
    .not("vault_address", "is", null)
    .not("status", "in", "(completed,failed,refunding)");
  if (error) throw new Error(`Could not list candidate vaults: ${error.message}`);

  const vaults = [...new Set((data ?? []).map((r) => r.vault_address).filter((a): a is string => Boolean(a)))];
  const actions: KeeperAction[] = [];
  let sends = 0;
  const budgetLeft = () => sends < MAX_SENDS_PER_RUN;

  for (const vault of vaults) {
    if (!budgetLeft()) break;

    // Read with no signer: plain simulations. A vault on an older code shape
    // the binding can't decode is skipped; the manual buttons still work there.
    let state: number;
    let info: {
      attested?: boolean;
      milestones?: Array<{ id: number; released: boolean; failed?: boolean; vote_opens_at?: bigint | number }>;
    };
    try {
      const reader = vaultClient(vault);
      const [s, i] = await Promise.all([reader.get_state(), reader.get_info()]);
      state = Number(s.result);
      info = i.result as unknown as typeof info;
    } catch {
      continue;
    }

    // A missed goal, not yet on the builder's record.
    if (state === VAULT_STATE.Failed && info.attested === false) {
      const outcome = await trySend(() => vaultClient(vault, signer).settle() as Promise<Assembled>, dryRun);
      if (outcome) {
        actions.push({ vault, kind: "record-missed-goal", outcome });
        if (outcome === "sent") sends++;
      }
      continue;
    }

    if (state !== VAULT_STATE.Funded && state !== VAULT_STATE.Active) continue;

    // Stages with a vote opened and no result yet. The vault refuses whichever
    // of the two doesn't apply: a carried vote can't be closed as failed, and
    // a short one can't be paid, and a window still running is neither.
    for (const m of info.milestones ?? []) {
      if (!budgetLeft()) break;
      if (m.released || m.failed || !Number(m.vote_opens_at ?? 0)) continue;
      const id = Number(m.id);

      const release = await trySend(
        () => vaultClient(vault, signer).release_milestone({ milestone_id: id }) as Promise<Assembled>,
        dryRun,
      );
      if (release) {
        actions.push({ vault, kind: "release", milestoneId: id, outcome: release });
        if (release === "sent") sends++;
        // A release changes the vault's state; the next stage waits for the next run.
        break;
      }

      const close = await trySend(
        () => vaultClient(vault, signer).settle_lapsed_milestone({ milestone_id: id }) as Promise<Assembled>,
        dryRun,
      );
      if (close) {
        actions.push({ vault, kind: "close-stage", milestoneId: id, outcome: close });
        if (close === "sent") sends++;
        // The vault is refunding now; nothing further is due on it.
        break;
      }
    }
  }

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
