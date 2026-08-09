"use client";

import { useCallback } from "react";
import {
  signAuthEntry as signAuthEntryWithFreighter,
  signTransaction as signWithFreighter,
} from "@stellar/freighter-api";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import {
  NETWORK_PASSPHRASE,
  factoryClient,
  vaultClient,
  attestationClient,
  identityClient,
  adminClient,
  simulate,
  type Signer,
} from "@/lib/stellar-clients";
import { tokenAddressFor, type Currency } from "@/lib/currencies";

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

export interface MilestoneInput {
  id: number;
  amount: bigint;
}

export interface CreateProjectParams {
  creator: string;
  currency: Currency;
  /** Total raise, in stroops. */
  goal: bigint;
  /** Unix seconds. */
  deadline: bigint;
  /** Performance bond, in stroops. Must meet the factory's minimum. */
  bondAmount: bigint;
  milestones: MilestoneInput[];
  metadataCid: string;
}

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

const signerFor = (publicKey: string): Signer => ({
  publicKey,
  signTransaction: (xdr: string) =>
    signWithFreighter(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    }),
  signAuthEntry: async (xdr: string) => {
    const res = await signAuthEntryWithFreighter(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    });
    if (!res.signedAuthEntry) {
      throw new Error("Freighter returned no signed auth entry.");
    }
    return {
      signedAuthEntry: res.signedAuthEntry,
      signerAddress: res.signerAddress,
    };
  },
});

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

  // ── Creating a project ───────────────────────────────────────────────────

  /**
   * Deploy a vault. The bond and the flat platform fee leave the builder's
   * account in this same transaction, so a project never exists unbonded.
   */
  const createProject = useCallback(
    async (params: CreateProjectParams) => {
      const creator = requireWallet(params.creator);
      const factory = factoryClient(signerFor(creator));

      const tx = await factory.create_vault({
        config: {
          creator,
          token: tokenAddressFor(params.currency),
          goal: params.goal,
          deadline: params.deadline,
          bond_amount: params.bondAmount,
          milestones: params.milestones.map((m) => ({
            id: m.id,
            amount: m.amount,
          })),
          metadata_cid: params.metadataCid,
        },
      });

      await signAndSend(tx);
      // create_vault returns the new vault's address.
      return tx.result as unknown as string;
    },
    [requireWallet],
  );

  // ── Backing a project ────────────────────────────────────────────────────

  const contribute = useCallback(
    async ({ vaultAddress, amount, contributor }: ContributeParams) => {
      const address = requireWallet(contributor);
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.contribute({ contributor: address, amount });
      return signAndSend(tx);
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
      const vault = vaultClient(vaultAddress, signerFor(address));
      const tx = await vault.open_milestone_vote({ milestone_id: milestoneId });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  /** Contributor votes to release. Weight is their contribution, capped at 20%. */
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

  /** Permissionless. Fails a milestone whose window closed below threshold. */
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

  // ── Reads ────────────────────────────────────────────────────────────────

  const getVaultInfo = useCallback(
    (vaultAddress: string) =>
      simulate(() => vaultClient(vaultAddress).get_info(), `get_info(${vaultAddress})`),
    [],
  );

  const getVaultState = useCallback(
    (vaultAddress: string) =>
      simulate(() => vaultClient(vaultAddress).get_state(), `get_state(${vaultAddress})`),
    [],
  );

  const getContribution = useCallback(
    (vaultAddress: string, contributor: string) =>
      simulate(
        () => vaultClient(vaultAddress).get_balance({ contributor }),
        `get_balance(${vaultAddress})`,
      ),
    [],
  );

  /** What this wallet's vote is worth, after the 20% cap. */
  const getVotingWeight = useCallback(
    (vaultAddress: string, contributor: string) =>
      simulate(
        () => vaultClient(vaultAddress).get_voting_weight({ contributor }),
        `get_voting_weight(${vaultAddress})`,
      ),
    [],
  );

  const hasVoted = useCallback(
    (vaultAddress: string, milestoneId: number, contributor: string) =>
      simulate(
        () => vaultClient(vaultAddress).has_voted({ milestone_id: milestoneId, contributor }),
        `has_voted(${vaultAddress})`,
      ),
    [],
  );

  /** Returns [weight so far, weight required, window still open]. */
  const getMilestoneVote = useCallback(
    (vaultAddress: string, milestoneId: number) =>
      simulate(
        () => vaultClient(vaultAddress).get_milestone_vote({ milestone_id: milestoneId }),
        `get_milestone_vote(${vaultAddress})`,
      ),
    [],
  );

  const getContributors = useCallback(
    (vaultAddress: string, offset = 0, limit = 100) =>
      simulate(
        () => vaultClient(vaultAddress).get_contributors({ offset, limit }),
        `get_contributors(${vaultAddress})`,
      ),
    [],
  );

  const getVaultAddress = useCallback(
    (projectId: bigint) =>
      simulate(() => factoryClient().get_vault({ project_id: projectId }), "get_vault"),
    [],
  );

  const getPlatformTerms = useCallback(async () => {
    const factory = factoryClient();
    const [fee, minContribution, votingWindow, bondBps] = await Promise.all([
      simulate(() => factory.get_platform_fee(), "get_platform_fee"),
      simulate(() => factory.get_min_contribution(), "get_min_contribution"),
      simulate(() => factory.get_voting_window(), "get_voting_window"),
      simulate(() => factory.get_bond_percentage(), "get_bond_percentage"),
    ]);
    return { fee, minContribution, votingWindow, bondBps };
  }, []);

  // ── Builder track record ─────────────────────────────────────────────────

  const getBuilderSummary = useCallback(
    (builder: string) =>
      simulate(
        () => attestationClient().get_builder_summary({ builder }),
        `get_builder_summary(${builder})`,
      ),
    [],
  );

  const getBuilderHistory = useCallback(
    (builder: string, offset = 0, limit = 100) =>
      simulate(
        () => attestationClient().get_builder_history({ builder, offset, limit }),
        `get_builder_history(${builder})`,
      ),
    [],
  );

  // ── Identity ─────────────────────────────────────────────────────────────

  const isKycApproved = useCallback(
    (address: string) =>
      simulate(
        () => identityClient().is_kyc_approved({ address }),
        `is_kyc_approved(${address})`,
      ),
    [],
  );

  // The connected wallet is the attestor — the registry now names the caller so
  // it can check them against its roster. It must be the admin or an authorised
  // attestor, or the ledger rejects the write. The wallet signs and identifies
  // itself in the same call.
  const attestKyc = useCallback(
    async ({ address, kycHash }: { address: string; kycHash: Buffer }) => {
      const attestor = requireWallet();
      const tx = await identityClient(signerFor(attestor)).attest({
        attestor,
        address,
        kyc_hash: kycHash,
      });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  const revokeKyc = useCallback(
    async (address: string) => {
      const attestor = requireWallet();
      const tx = await identityClient(signerFor(attestor)).revoke({
        attestor,
        address,
      });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  // ── Platform terms ───────────────────────────────────────────────────────
  //
  // These change the terms for vaults created from here on. A vault's config is
  // frozen at construction, so none of them alters a project a contributor has
  // already backed.

  const updatePlatformFee = useCallback(
    async (newFee: bigint) => {
      const admin = requireWallet();
      const tx = await factoryClient(signerFor(admin)).update_platform_fee({ new_fee: newFee });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  const updateBondPercentage = useCallback(
    async (bps: bigint) => {
      const admin = requireWallet();
      const tx = await factoryClient(signerFor(admin)).update_bond_percentage({
        new_percentage: bps,
      });
      return signAndSend(tx);
    },
    [requireWallet],
  );

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

  const updateVotingWindow = useCallback(
    async (seconds: bigint) => {
      const admin = requireWallet();
      const tx = await factoryClient(signerFor(admin)).update_voting_window({
        new_window_secs: seconds,
      });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  const updateMinContribution = useCallback(
    async (stroops: bigint) => {
      const admin = requireWallet();
      const tx = await factoryClient(signerFor(admin)).update_min_contribution({
        new_minimum: stroops,
      });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  // ── Admin roster ─────────────────────────────────────────────────────────

  const isPlatformAdmin = useCallback(
    (account: string) =>
      simulate(() => adminClient().is_admin({ account }), `is_admin(${account})`),
    [],
  );

  const getAdmins = useCallback(
    () => simulate(() => adminClient().get_admins(), "get_admins"),
    [],
  );

  /**
   * Where the factory currently sends listing fees.
   *
   * The console never read this, so the fee wallet field rendered empty whatever
   * the factory actually held — which meant a fee wallet pointing somewhere
   * wrong looked identical to one not yet configured. That is the worst way for
   * this particular setting to fail, because the money has already moved by the
   * time anyone notices.
   */
  const getFeeWallet = useCallback(
    () => simulate(() => factoryClient().get_fee_wallet(), "get_fee_wallet"),
    [],
  );

  /**
   * Who may edit the on-chain roster.
   *
   * Worth reading separately from the roster itself: add_admin and remove_admin
   * are owner-only, so an admin looking at the enrol button needs to know whose
   * signature it will ask for. Without this the only way to discover that you
   * are not the owner is to sign a transaction and watch the ledger reject it.
   */
  const getAdminOwner = useCallback(
    () => simulate(() => adminClient().get_owner(), "get_owner"),
    [],
  );

  const addAdmin = useCallback(
    async (account: string) => {
      const owner = requireWallet();
      const tx = await adminClient(signerFor(owner)).add_admin({ account });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  const removeAdmin = useCallback(
    async (account: string) => {
      const owner = requireWallet();
      const tx = await adminClient(signerFor(owner)).remove_admin({ account });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  /**
   * Hand the roster to a new owner, signed by the current one.
   *
   * Only reachable from the browser, and deliberately so: the owner's key lives
   * in their wallet extension, not in a CLI keystore, so `stellar contract
   * invoke` cannot sign this once ownership has moved off the deployer. Without
   * a button here, transferring ownership a second time would need the owner to
   * export a secret key — which is worse than any convenience it buys.
   *
   * The contract adds the new owner as an admin if they are not already one, so
   * this cannot strand the roster with an owner who cannot use it.
   */
  const transferAdminOwnership = useCallback(
    async (newOwner: string) => {
      const owner = requireWallet();
      const tx = await adminClient(signerFor(owner)).transfer_ownership({
        new_owner: newOwner,
      });
      return signAndSend(tx);
    },
    [requireWallet],
  );

  return {
    // create
    createProject,
    // back
    contribute,
    claimRefund,
    // vote
    openMilestoneVote,
    approveMilestone,
    releaseMilestone,
    settleLapsedMilestone,
    settleVault,
    returnBond,
    // read
    getVaultInfo,
    getVaultState,
    getContribution,
    getVotingWeight,
    hasVoted,
    getMilestoneVote,
    getContributors,
    getVaultAddress,
    getPlatformTerms,
    // record
    getBuilderSummary,
    getBuilderHistory,
    // identity
    isKycApproved,
    attestKyc,
    revokeKyc,
    // platform terms
    updatePlatformFee,
    updateBondPercentage,
    updateFeeWallet,
    updateVotingWindow,
    updateMinContribution,
    // admin
    isPlatformAdmin,
    getAdmins,
    getFeeWallet,
    getAdminOwner,
    addAdmin,
    removeAdmin,
    transferAdminOwnership,
  };
}
