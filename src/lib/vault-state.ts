// Server-side read of a vault's live on-chain state.
//
// The DB is a cache of the ledger, so the server reads the ledger itself rather
// than trusting numbers posted by a browser. Anything that writes funding
// totals, bond status, or milestone release flags into ProjectCache must source
// them from here.

import { Networks } from "@stellar/stellar-sdk";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { SOROBAN_RPC_URL } from "@/lib/stellar";

/** Stroops per unit — Stellar assets carry 7 decimal places. */
export const STROOPS = 10_000_000;

const VAULT_STATUS: Record<number, string> = {
  0: "raising",
  1: "funded",
  2: "active",
  3: "failed",
  4: "refunding",
  5: "completed",
};

export interface OnChainMilestone {
  id: number;
  amount: number;
  released: boolean;
}

export interface VaultState {
  creator: string;
  status: string;
  currentFunding: number;
  currentFundingRaw: string;
  fundingGoal: number;
  fundingGoalRaw: string;
  fundingDeadline: number;
  bondPosted: boolean;
  bondAmount: number;
  releasedTotal: number;
  milestones: OnChainMilestone[];
}

/**
 * Read a vault's authoritative state from the ledger.
 * Returns null if the vault cannot be reached or does not exist.
 */
export async function readVaultState(vaultAddress: string): Promise<VaultState | null> {
  if (!vaultAddress || !SOROBAN_RPC_URL) return null;

  try {
    const client = new VaultClient({
      contractId: vaultAddress,
      rpcUrl: SOROBAN_RPC_URL,
      networkPassphrase: Networks.TESTNET,
    });

    const [stateSim, infoSim] = await Promise.all([
      client.get_state().then((tx) => tx.simulate()),
      client.get_info().then((tx) => tx.simulate()),
    ]);

    const info: any = infoSim.result;
    if (!info) return null;

    const liveState = stateSim.result as number | undefined;
    let status = VAULT_STATUS[liveState ?? -1] ?? "pending";

    // A vault that is nominally raising but has no bond locked has not really
    // opened yet — the UI shows these as pending.
    if (status === "raising" && !info.bond_posted) {
      status = "pending";
    }

    return {
      creator: String(info.creator),
      status,
      currentFunding: Number(info.raised_amount) / STROOPS,
      currentFundingRaw: info.raised_amount.toString(),
      fundingGoal: Number(info.goal) / STROOPS,
      fundingGoalRaw: info.goal.toString(),
      fundingDeadline: Number(info.deadline) * 1000,
      bondPosted: Boolean(info.bond_posted),
      bondAmount: Number(info.bond_amount) / STROOPS,
      releasedTotal: Number(info.released_total) / STROOPS,
      milestones: (info.milestones ?? []).map((m: any) => ({
        id: Number(m.id),
        amount: Number(m.amount) / STROOPS,
        released: Boolean(m.released),
      })),
    };
  } catch (error) {
    console.warn(`[vault-state] Failed to read vault ${vaultAddress}:`, error);
    return null;
  }
}

/**
 * Resolve a vault's creator address on-chain. Used to authorize writes that
 * only a project's builder may perform.
 */
export async function getVaultCreator(vaultAddress: string): Promise<string | null> {
  const state = await readVaultState(vaultAddress);
  return state?.creator ?? null;
}
