/**
 * One governance keeper pass: what it reads from each vault, which of the
 * vault's permissionless calls it then tries, in what order, and how many it
 * may send.
 *
 * Kept apart from governance-keeper.ts, which holds the key and lists the
 * candidates, so that this part can run against stand-in vaults
 * (governance-keeper-pass.test.ts). It imports nothing. Why the key decides
 * timing only, never an outcome, is explained in governance-keeper.ts.
 */

/** A safety cap: even a run that finds a backlog sends at most this many. */
export const MAX_SENDS_PER_RUN = 20;

export const VAULT_STATE = { Raising: 0, Funded: 1, Active: 2, Failed: 3, Refunding: 4, Completed: 5 } as const;

export interface KeeperAction {
  vault: string;
  kind: "release" | "close-stage" | "record-missed-goal" | "return-bond";
  milestoneId?: number;
  /** "sent", "would-send" in a dry run, or why it didn't go. */
  outcome: string;
}

/** A transaction the binding has assembled, as far as this file uses it. */
export interface Assembled {
  simulationData: unknown;
  signAndSend: () => Promise<unknown>;
}

/** The fields of the vault's get_info this pass reads. */
export interface VaultInfo {
  attested?: boolean;
  /** An i128, so a bigint from the binding. */
  bond_amount?: bigint | number | string;
  bond_returned?: boolean;
  milestones?: Array<{ id: number; released: boolean; failed?: boolean; vote_opens_at?: bigint | number }>;
}

/** A vault read with no signer: plain simulations. */
export interface VaultReader {
  get_state: () => Promise<{ result: unknown }>;
  get_info: () => Promise<{ result: unknown }>;
}

/** The calls the pass may send, as the binding builds them from the submitter key. */
export interface VaultWriter {
  settle: () => Promise<Assembled>;
  return_bond: () => Promise<Assembled>;
  release_milestone: (args: { milestone_id: number }) => Promise<Assembled>;
  settle_lapsed_milestone: (args: { milestone_id: number }) => Promise<Assembled>;
}

export interface VaultClients {
  read: (vault: string) => VaultReader;
  write: (vault: string) => VaultWriter;
}

export interface KeeperPass {
  actions: KeeperAction[];
  /** How many transactions the ledger applied. */
  sends: number;
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
export async function trySend(build: () => Promise<Assembled>, dryRun: boolean): Promise<string | null> {
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

/** The bond still in the vault, or zero once it is back with the builder. */
function heldBond(info: VaultInfo): bigint {
  if (info.bond_returned !== false) return 0n;
  try {
    return BigInt(info.bond_amount ?? 0);
  } catch {
    return 0n;
  }
}

/**
 * Read each vault and try what its state says is due. In a dry run every
 * accepted call reports "would-send" and nothing is signed.
 */
export async function runKeeperPass(vaults: string[], clients: VaultClients, dryRun: boolean): Promise<KeeperPass> {
  const actions: KeeperAction[] = [];
  let sends = 0;
  const budgetLeft = () => sends < MAX_SENDS_PER_RUN;
  const record = (action: KeeperAction) => {
    actions.push(action);
    if (action.outcome === "sent") sends++;
  };

  for (const vault of vaults) {
    if (!budgetLeft()) break;

    // A vault on an older code shape the binding can't decode is skipped; the
    // manual buttons still work there.
    let state: number;
    let info: VaultInfo;
    try {
      const reader = clients.read(vault);
      const [s, i] = await Promise.all([reader.get_state(), reader.get_info()]);
      state = Number(s.result);
      info = i.result as VaultInfo;
    } catch {
      continue;
    }

    if (state === VAULT_STATE.Failed) {
      // A missed goal, not yet on the builder's record.
      if (info.attested === false) {
        const outcome = await trySend(() => clients.write(vault).settle(), dryRun);
        if (outcome) record({ vault, kind: "record-missed-goal", outcome });
      }
      // The builder's bond, still in the vault. Nobody funded the project, so
      // that is not a default: the bond goes back. Each backer still claims
      // their own principal; nothing is pushed to a stakeholder. The record
      // comes first when both are due, in the same run if the budget allows.
      if (budgetLeft() && heldBond(info) > 0n) {
        const outcome = await trySend(() => clients.write(vault).return_bond(), dryRun);
        if (outcome) record({ vault, kind: "return-bond", outcome });
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

      const release = await trySend(() => clients.write(vault).release_milestone({ milestone_id: id }), dryRun);
      if (release) {
        record({ vault, kind: "release", milestoneId: id, outcome: release });
        // A release changes the vault's state; the next stage waits for the next run.
        break;
      }

      const close = await trySend(() => clients.write(vault).settle_lapsed_milestone({ milestone_id: id }), dryRun);
      if (close) {
        record({ vault, kind: "close-stage", milestoneId: id, outcome: close });
        // The vault is refunding now; nothing further is due on it.
        break;
      }
    }
  }

  return { actions, sends };
}
