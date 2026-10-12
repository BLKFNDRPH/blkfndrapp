"use client";

import { useCallback } from "react";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import {
  factoryClient,
  vaultClient,
  identityClient,
  simulate,
  type Signer,
} from "@/lib/stellar-clients";
import { freighterSigner } from "@/lib/freighter-signer";
import { LedgerFailedError } from "@/lib/explain-error";
import { checkVaultLockAction } from "@/actions/project-restrictions";

/**
 * Contract calls for the bonded vault model.
 *
 * The shape of this changed with the contracts. There is no longer a single
 * crowdfunding contract holding every project, so most calls take a vault
 * address: the factory deploys one per project and that vault owns its own
 * money, votes and lifecycle.
 *
 * Gone with the old model, and deliberately not reimplemented:
 *
 *   approveProject / rejectProject / updateProjectStatus
 *       A project exists when its vault is deployed. No admin gate.
 *   proposeWithdrawal / voteWithdrawal / executeWithdrawal
 *       Replaced by contributor voting. No signer decides when money moves.
 *   registerToken
 *       A vault takes its token at construction and keeps it. An admin who
 *       could repoint it mid-raise could make refunds pay a different asset.
 */

export interface ContributeParams {
  vaultAddress: string;
  amount: bigint;
  contributor?: string;
}

export interface MilestoneParams {
  vaultAddress: string;
  milestoneId: number;
}

export interface ApproveMilestoneParams extends MilestoneParams {
  contributor?: string;
}

// Signing goes through freighterSigner, which checks what the wallet actually
// returned. Passing Freighter's raw result to the SDK meant a dismissed popup
// surfaced as "Cannot read properties of undefined (reading 'switch')".
const signerFor = (publicKey: string): Signer => freighterSigner(publicKey);

/** The platform declined to build a transaction because the project is locked. */
export class PlatformLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformLockError";
  }
}

/**
 * A platform lock, asked fresh before building a transaction it covers.
 *
 * The vault cannot refuse these — it has no pause switch — so this is where the
 * platform declines to build them. Asked now rather than read off the listing,
 * which can be minutes old. A lookup that fails does not block: the listing's
 * own state already gated the button, and an unanswered question is not
 * evidence of a lock.
 */
async function refuseIfLocked(vaultAddress: string, paused: string) {
  const { locked } = await checkVaultLockAction(vaultAddress);
  if (locked === true) {
    throw new PlatformLockError(
      `This project is locked by the platform. ${paused} until it is unlocked.`,
    );
  }
}

/** Where a prepared money action is, for the sheet narrating it. */
export type SendPhase = "waiting-for-wallet" | "sending" | "confirming";

/** A transaction the vault has already simulated, waiting for the wallet. */
export interface PreparedAction {
  /** The network fee the wallet will be asked to pay, in XLM base units. */
  feeRaw: bigint | null;
  /** Ask the wallet to approve it, send it, and wait for the ledger. */
  send: (onPhase?: (phase: SendPhase) => void) => Promise<{ hash: string | null }>;
}

/**
 * Wrap a simulated transaction so the caller sees each phase: the wallet
 * window, the send, the wait for the ledger. Throws LedgerFailedError when the
 * ledger ran it and it failed (the fee was charged), and the SDK's own errors
 * otherwise, for explainError to word.
 */
function toPrepared<T>(assembled: AssembledTransaction<T>): PreparedAction {
  // Building a call does not throw when the contract refuses it: the SDK keeps
  // the failed simulation and only raises it when the result is read, which
  // used to be at signing, after the person had been shown a confirm card.
  // Reading it here raises the vault's refusal (minimum, deadline, goal, an
  // empty wallet) and archived-storage errors before any wallet window, with
  // the host's own text for explainError.
  void assembled.simulationData;
  const fee = assembled.built?.fee;
  return {
    feeRaw: fee !== undefined && /^\d+$/.test(String(fee)) ? BigInt(fee) : null,
    send: async (onPhase) => {
      onPhase?.("waiting-for-wallet");
      await assembled.sign();
      onPhase?.("sending");
      const sent = await assembled.send({
        onSubmitted: () => onPhase?.("confirming"),
      });
      const hash = sent.sendTransactionResponse?.hash ?? null;
      const status = sent.getTransactionResponse?.status;
      if (status !== "SUCCESS") throw new LedgerFailedError(hash, status);
      return { hash };
    },
  };
}

async function signAndSend<T>(assembled: AssembledTransaction<T>) {
  const tx = assembled as AssembledTransaction<T> & {
    signAndSend?: () => Promise<unknown>;
  };
  if (!tx.signAndSend) {
    throw new Error("This transaction cannot be signed and sent.");
  }
  return tx.signAndSend();
}

export function useStellarContract() {
  const { freighterWalletAddress } = useFreighterWallet();

  const requireWallet = useCallback(
    (override?: string) => {
      const address = override || freighterWalletAddress;
      if (!address) {
        throw new Error("Connect your Freighter wallet first.");
      }
      return address;
    },
    [freighterWalletAddress],
  );

  // ── Backing a project ────────────────────────────────────────────────────

  const contribute = useCallback(
    async ({ vaultAddress, amount, contributor }: ContributeParams) => {
      const address = requireWallet(contributor);
      await refuseIfLocked(vaultAddress, "New stakes are paused");
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.contribute({ contributor: address, amount });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  /**
   * A stake, simulated by the vault before the wallet is asked anything, so a
   * refusal (below the minimum, past the deadline, over the goal, not enough
   * in the wallet) surfaces before any popup. The platform lock is asked
   * fresh here too.
   */
  const prepareContribute = useCallback(
    async ({ vaultAddress, amount, contributor }: ContributeParams): Promise<PreparedAction> => {
      const address = requireWallet(contributor);
      await refuseIfLocked(vaultAddress, "New stakes are paused");
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.contribute({ contributor: address, amount });
      return toPrepared(tx);
    },
    [requireWallet],
  );

  // The same simulate-first shape for every other money action, so each one
  // can show its refusal before a wallet window and narrate its phases.

  /** A stakeholder's yes vote on a stage. */
  const prepareApproveMilestone = useCallback(
    async ({ vaultAddress, milestoneId, contributor }: ApproveMilestoneParams): Promise<PreparedAction> => {
      const address = requireWallet(contributor);
      const vault = vaultClient(vaultAddress, signerFor(address));
      return toPrepared(
        await vault.approve_milestone({ contributor: address, milestone_id: milestoneId }),
      );
    },
    [requireWallet],
  );

  /** The builder opens a stage to its 7-day vote. Paused by a platform lock. */
  const prepareOpenMilestoneVote = useCallback(
    async ({ vaultAddress, milestoneId }: MilestoneParams): Promise<PreparedAction> => {
      const address = requireWallet();
      await refuseIfLocked(vaultAddress, "Opening stage votes is paused");
      const vault = vaultClient(vaultAddress, signerFor(address));
      return toPrepared(await vault.open_milestone_vote({ milestone_id: milestoneId }));
    },
    [requireWallet],
  );

  /** Send an approved payout. Permissionless: the carried vote is the authority. */
  const prepareReleaseMilestone = useCallback(
    async ({ vaultAddress, milestoneId }: MilestoneParams): Promise<PreparedAction> => {
      const address = requireWallet();
      const vault = vaultClient(vaultAddress, signerFor(address));
      return toPrepared(await vault.release_milestone({ milestone_id: milestoneId }));
    },
    [requireWallet],
  );

  /** Record a vote that ended short, which opens refunds. Permissionless. */
  const prepareSettleLapsedMilestone = useCallback(
    async ({ vaultAddress, milestoneId }: MilestoneParams): Promise<PreparedAction> => {
      const address = requireWallet();
      const vault = vaultClient(vaultAddress, signerFor(address));
      return toPrepared(await vault.settle_lapsed_milestone({ milestone_id: milestoneId }));
    },
    [requireWallet],
  );

  /** Record a passed deadline on the vault. Permissionless. */
  const prepareSettleVault = useCallback(
    async (vaultAddress: string): Promise<PreparedAction> => {
      const address = requireWallet();
      const vault = vaultClient(vaultAddress, signerFor(address));
      return toPrepared(await vault.settle());
    },
    [requireWallet],
  );

  /** A stakeholder collects their refund. Only their own wallet can. */
  const prepareClaimRefund = useCallback(
    async ({ vaultAddress, contributor }: { vaultAddress: string; contributor?: string }): Promise<PreparedAction> => {
      const address = requireWallet(contributor);
      const vault = vaultClient(vaultAddress, signerFor(address));
      return toPrepared(await vault.claim_refund({ contributor: address }));
    },
    [requireWallet],
  );

  const claimRefund = useCallback(
    async ({ vaultAddress, contributor }: { vaultAddress: string; contributor?: string }) => {
      const address = requireWallet(contributor);
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.claim_refund({ contributor: address });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  // ── Milestone voting ─────────────────────────────────────────────────────

  /** Builder starts the clock on a milestone. */
  const openMilestoneVote = useCallback(
    async ({ vaultAddress, milestoneId }: MilestoneParams) => {
      const address = requireWallet();
      await refuseIfLocked(vaultAddress, "Opening milestone votes is paused");
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.open_milestone_vote({ milestone_id: milestoneId });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  /**
   * Contributor votes to release. Weight is their contribution, capped at 20%
   * of the raise; on current vaults a release also needs three approving
   * wallets, or every contributor when there are fewer.
   */
  const approveMilestone = useCallback(
    async ({ vaultAddress, milestoneId, contributor }: ApproveMilestoneParams) => {
      const address = requireWallet(contributor);
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.approve_milestone({
        contributor: address,
        milestone_id: milestoneId,
      });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  /** Permissionless once the vote carries — anyone may execute it. */
  const releaseMilestone = useCallback(
    async ({ vaultAddress, milestoneId }: MilestoneParams) => {
      const address = requireWallet();
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.release_milestone({ milestone_id: milestoneId });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  /** Permissionless. Fails a milestone whose window closed without carrying. */
  const settleLapsedMilestone = useCallback(
    async ({ vaultAddress, milestoneId }: MilestoneParams) => {
      const address = requireWallet();
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.settle_lapsed_milestone({ milestone_id: milestoneId });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  /** Permissionless. Persists a lifecycle transition once the deadline passes. */
  const settleVault = useCallback(
    async (vaultAddress: string) => {
      const address = requireWallet();
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.settle();
      return signAndSend(tx);
    },
    [requireWallet],
  );

  /** Permissionless. Returns the bond after a raise that never filled. */
  const returnBond = useCallback(
    async (vaultAddress: string) => {
      const address = requireWallet();
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.return_bond();
      return signAndSend(tx);
    },
    [requireWallet],
  );

  // ── Attestor roster ──────────────────────────────────────────────────────
  //
  // Who may write a KYC attestation. add/remove are admin-only on the registry,
  // so these authorise against the registry's own admin — not the platform
  // roster, which the ledger does not consult.

  /** The registry's admin — the only wallet that may appoint attestors. */
  const getIdentityAdmin = useCallback(
    () => simulate(() => identityClient().get_admin(), "identity get_admin"),
    [],
  );

  /** Whether a wallet may attest. */
  const isAttestor = useCallback(
    (account: string) =>
      simulate(() => identityClient().is_attestor({ account }), `is_attestor(${account})`),
    [],
  );

  const addAttestor = useCallback(
    async (account: string) => {
      const admin = requireWallet();
      const tx = await identityClient(signerFor(admin)).add_attestor({ account });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  const removeAttestor = useCallback(
    async (account: string) => {
      const admin = requireWallet();
      const tx = await identityClient(signerFor(admin)).remove_attestor({ account });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  // ── Fee wallet ───────────────────────────────────────────────────────────
  //
  // The factory's other terms (fee, bond, voting window, minimum contribution)
  // change by treasury vote — SetFee, SetBondBps, SetVotingWindow,
  // SetMinContribution — not through a wallet-signed setter here.

  const updateFeeWallet = useCallback(
    async (address: string) => {
      const admin = requireWallet();
      const tx = await factoryClient(signerFor(admin)).update_fee_wallet({
        new_fee_wallet: address,
      });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  // ── Factory admin ────────────────────────────────────────────────────────

  /**
   * Who administers the factory — the wallet whose signature its setters accept.
   *
   * The governance UI needs this to tell the truth about what a carried vote can
   * actually do. Until this is the treasury, a proposal can be raised and passed
   * but not executed, because executing calls the factory as its admin and the
   * treasury is not yet that admin.
   */
  const getFactoryAdmin = useCallback(
    () => simulate(() => factoryClient().get_admin(), "factory get_admin"),
    [],
  );

  return {
    // back
    contribute,
    prepareContribute,
    claimRefund,
    prepareClaimRefund,
    prepareApproveMilestone,
    prepareOpenMilestoneVote,
    prepareReleaseMilestone,
    prepareSettleLapsedMilestone,
    prepareSettleVault,
    // vote
    openMilestoneVote,
    approveMilestone,
    releaseMilestone,
    settleLapsedMilestone,
    settleVault,
    returnBond,
    // attestor roster
    getIdentityAdmin,
    isAttestor,
    addAttestor,
    removeAttestor,
    // fee wallet
    updateFeeWallet,
    // admin
    getFactoryAdmin,
  };
}
