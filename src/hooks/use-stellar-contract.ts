"use client";

import { useCallback } from "react";
import { signAuthEntry, signTransaction } from "@stellar/freighter-api";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { blkfndrClient } from "@/lib/stellar-blkfndr-contract";
import { NETWORK_PASSPHRASE } from "@/lib/stellar";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { Client as FactoryClient } from "@/packages/blkfndr_factory/src";
import { Client as ApprovalClient } from "@/packages/blkfndr_approval/src";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import type { FundReceipt } from "@/lib/types";
import type {
  CurrencyType,
  Platform,
  Project,
  ProjectStatus,
  AdminProposal,
} from "@/packages/blkfndr_v2";

const FALLBACK_ADDRESS = process.env.NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS || "";
const ALLOWED_ADMIN = process.env.NEXT_PUBLIC_STELLAR_ADMIN_ADDRESS || "";

export interface CreateProjectParams {
  input: CreateProjectInput;
  creator?: string;
}

export interface InitializeParams {
  feeWalletAddress: string;
  feePercentage: string;
  admin?: string;
}

export interface FundProjectParams {
  vaultAddress: string;
  amount: bigint;
  investor?: string;
}

export interface DonateToPlatformParams {
  amount: bigint;
  currencyType: CurrencyType;
  message: string;
  donor?: string;
}

export interface GetProjectsByStatusParams {
  status: ProjectStatus;
}

export interface RegisterTokenParams {
  currencyType: CurrencyType;
  tokenAddress: string;
  admin?: string;
}

export interface SetFeeWalletParams {
  feeWalletAddress: string;
  feeWalletEmail: string;
  admin?: string;
}

export interface UpdatePlatformFeeParams {
  newFeeBps: bigint;
  admin?: string;
}

export interface TransferAdminParams {
  newAdmin: string;
  admin?: string;
}

export interface UpdateShareRulesParams {
  minPercentage: bigint;
  maxPercentage: bigint;
  description: string;
  admin?: string;
}

export interface AdminDeleteProjectParams {
  projectId: bigint;
  reason: string;
  admin?: string;
}

export interface CreateProjectInput {
  blob_id: string;
  category: string;
  description: string;
  funding_deadline: bigint;
  goal: bigint;
  is_public: boolean;
  tagline: string;
  title: string;
  currencyType: CurrencyType;
}

type SimulationResult<T> = {
  result?: T;
  returnValue?: T;
};

const getSimulationResult = <T>(simulation: SimulationResult<T>): T => {
  if (simulation.result !== undefined) {
    return simulation.result;
  }
  if (simulation.returnValue !== undefined) {
    return simulation.returnValue;
  }
  throw new Error("Simulation did not return a result.");
};

const signWithFreighter = async (
  xdr: string,
  options?: { networkPassphrase?: string; address?: string },
) => {
  const { networkPassphrase, address } = options ?? {};
  return signTransaction(xdr, {
    networkPassphrase: networkPassphrase ?? NETWORK_PASSPHRASE,
    address,
  });
};

const signAuthEntryWithFreighter = async (
  xdr: string,
  options?: { networkPassphrase?: string; address?: string },
) => {
  const { networkPassphrase, address } = options ?? {};
  return signAuthEntry(xdr, {
    networkPassphrase: networkPassphrase ?? NETWORK_PASSPHRASE,
    address,
  });
};

const createStellarClient = (publicKey: string) =>
  blkfndrClient(publicKey, {
    signTransaction: (xdr: string) =>
      signWithFreighter(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: publicKey,
      }),
    signAuthEntry: (xdr: string) =>
      signAuthEntryWithFreighter(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: publicKey,
      }),
  });

const getCustomSignerOptions = (publicKey: string) => ({
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
      throw new Error("Freighter signedAuthEntry returned null");
    }
    return {
      signedAuthEntry: res.signedAuthEntry,
      signerAddress: res.signerAddress,
    };
  },
});

const signAndSend = async <T>(assembledTx: AssembledTransaction<T>) => {
  const txWithSign = assembledTx as AssembledTransaction<T> & {
    signAndSend?: () => Promise<unknown>;
  };

  if (!txWithSign.signAndSend) {
    throw new Error("Assembled transaction does not support signAndSend().");
  }

  return txWithSign.signAndSend();
};

export const useStellarContract = () => {
  const { freighterWalletAddress } = useFreighterWallet();

  const requirePublicKey = useCallback(
    (override?: string) => {
      const publicKey = override ?? freighterWalletAddress ?? FALLBACK_ADDRESS;
      return publicKey;
    },
    [freighterWalletAddress],
  );

  const requireReadOnlyPublicKey = useCallback(() => {
    return FALLBACK_ADDRESS;
  }, []);

  const getPlatform = useCallback(async (): Promise<Platform> => {
    const publicKey = requireReadOnlyPublicKey();
    const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
    const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
    const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";

    const factoryClient = new FactoryClient({
      contractId: FACTORY_ID,
      rpcUrl: SOROBAN_RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      publicKey,
    });

    const approvalClient = new ApprovalClient({
      contractId: APPROVAL_ID,
      rpcUrl: SOROBAN_RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      publicKey,
    });

    try {
      const [adminTx, feeWalletTx, feePercentageTx, bondPercentageTx, signersTx] = await Promise.all([
        factoryClient.get_admin(),
        factoryClient.get_fee_wallet(),
        factoryClient.get_fee_percentage(),
        factoryClient.get_bond_percentage(),
        approvalClient.get_signers(),
      ]);

      const [adminRes, feeWalletRes, feePercentageRes, bondPercentageRes, signersRes] = await Promise.all([
        adminTx.simulate(),
        feeWalletTx.simulate(),
        feePercentageTx.simulate(),
        bondPercentageTx.simulate(),
        signersTx.simulate(),
      ]);

      return {
        admin: adminRes.result || "",
        fee_wallet_address: feeWalletRes.result || "",
        fee_percentage: feePercentageRes.result ? BigInt(feePercentageRes.result) : BigInt(300),
        total_fees_collected: BigInt(0),
        multi_sig_admins: signersRes.result || [],
        bond_percentage: bondPercentageRes.result ? BigInt(bondPercentageRes.result) : BigInt(500),
      };
    } catch (err) {
      console.error("Failed to query platform info from factory and approval module:", err);
      return {
        admin: ALLOWED_ADMIN,
        fee_wallet_address: ALLOWED_ADMIN,
        fee_percentage: BigInt(300),
        total_fees_collected: BigInt(0),
        multi_sig_admins: [ALLOWED_ADMIN],
        bond_percentage: BigInt(500),
      };
    }
  }, [requireReadOnlyPublicKey]);

  const getAllProjects = useCallback(async (): Promise<Project[]> => {
    const publicKey = requireReadOnlyPublicKey();
    const client = createStellarClient(publicKey);
    const tx = await client.get_all_projects();
    const simulation = (await tx.simulate()) as SimulationResult<Project[]>;
    return getSimulationResult(simulation);
  }, [requireReadOnlyPublicKey]);

  const getProjectsByStatus = useCallback(
    async ({ status }: GetProjectsByStatusParams): Promise<Project[]> => {
      const publicKey = requireReadOnlyPublicKey();
      const client = createStellarClient(publicKey);
      const tx = await client.get_projects_by_status({ status });
      const simulation = (await tx.simulate()) as SimulationResult<Project[]>;
      return getSimulationResult(simulation);
    },
    [requireReadOnlyPublicKey],
  );

  const createProject = useCallback(
    async ({ input, creator }: CreateProjectParams) => {
      const publicKey = requirePublicKey(creator);
      const client = createStellarClient(publicKey);
      const tx = await client.create_project({
        creator: publicKey,
        title: input.title,
        tagline: input.tagline,
        description: input.description,
        category: input.category,
        goal: input.goal,
        blob_id: input.blob_id,
        currency_type: input.currencyType,
        funding_deadline: input.funding_deadline,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const initialize = useCallback(
    async ({ feeWalletAddress, feePercentage, admin }: InitializeParams) => {
      const publicKey = requirePublicKey(admin);
      const client = createStellarClient(publicKey);
      const tx = await client.initialize({
        admin: publicKey,
        fee_wallet_address: feeWalletAddress,
        fee_percentage: BigInt(feePercentage),
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const fundProject = useCallback(
    async ({
      vaultAddress,
      amount,
      investor,
    }: FundProjectParams) => {
      const publicKey = requirePublicKey(investor);
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const client = new VaultClient({
        contractId: vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey,
        ...getCustomSignerOptions(publicKey),
      });
      const tx = await client.contribute({
        contributor: publicKey,
        amount,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const getUserFunds = useCallback(
    async (address: string): Promise<FundReceipt[]> => {
      try {
        const res = await fetch(`/api/user/funds?address=${address}`);
        if (!res.ok) {
          throw new Error("Failed to fetch user contributions");
        }
        return await res.json();
      } catch (err) {
        console.error("Failed to query user contributions:", err);
        return [];
      }
    },
    [],
  );

  const getAllFundReceipts = useCallback(async (): Promise<FundReceipt[]> => {
    try {
      const res = await fetch("/api/user/funds");
      if (!res.ok) {
        throw new Error("Failed to fetch all fund receipts");
      }
      return await res.json();
    } catch (err) {
      console.error("Failed to query all fund receipts:", err);
      return [];
    }
  }, []);

  const refundContributor = useCallback(
    async ({ vaultAddress, investor }: { vaultAddress: string; investor?: string }) => {
      const publicKey = requirePublicKey(investor);
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const client = new VaultClient({
        contractId: vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey,
        ...getCustomSignerOptions(publicKey),
      });
      const tx = await client.claim_refund({
        contributor: publicKey,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const getProject = useCallback(
    async (projectId: bigint): Promise<Project> => {
      const publicKey = requireReadOnlyPublicKey();
      const client = createStellarClient(publicKey);
      const tx = await client.get_project({ project_id: projectId });
      const simulation = (await tx.simulate()) as SimulationResult<Project>;
      return getSimulationResult(simulation);
    },
    [requireReadOnlyPublicKey],
  );

  const registerToken = useCallback(
    async ({ currencyType, tokenAddress, admin }: RegisterTokenParams) => {
      const publicKey = requirePublicKey(admin);
      const client = createStellarClient(publicKey);
      const tx = await client.register_token({
        currency_type: currencyType,
        token_address: tokenAddress,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const updateProjectStatus = useCallback(
    async ({
      projectId,
      newStatus,
      admin,
    }: {
      projectId: bigint;
      newStatus: ProjectStatus;
      admin?: string;
    }) => {
      requirePublicKey(admin);
      const client = createStellarClient(requirePublicKey(admin));
      const tx = await client.update_project_status({
        project_id: projectId,
        new_status: newStatus,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const approveProject = useCallback(
    async ({ projectId, admin }: { projectId: bigint; admin?: string }) => {
      requirePublicKey(admin);
      const client = createStellarClient(requirePublicKey(admin));
      const tx = await client.approve_project({ project_id: projectId });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const rejectProject = useCallback(
    async ({ projectId, admin }: { projectId: bigint; admin?: string }) => {
      requirePublicKey(admin);
      const client = createStellarClient(requirePublicKey(admin));
      const tx = await client.reject_project({ project_id: projectId });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const transferAdmin = useCallback(
    async ({ newAdmin, admin }: TransferAdminParams) => {
      requirePublicKey(admin);
      const client = createStellarClient(requirePublicKey(admin));
      const tx = await client.transfer_admin({ new_admin: newAdmin });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const addMultisigAdmin = useCallback(
    async ({ newAdmin, admin }: { newAdmin: string; admin?: string }) => {
      const publicKey = requirePublicKey(admin);
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey,
        ...getCustomSignerOptions(publicKey),
      });
      const tx = await client.add_signer({ new_signer: newAdmin });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const removeMultisigAdmin = useCallback(
    async ({ target, admin }: { target: string; admin?: string }) => {
      const publicKey = requirePublicKey(admin);
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey,
        ...getCustomSignerOptions(publicKey),
      });
      const tx = await client.remove_signer({ signer: target });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const updateMultisigThreshold = useCallback(
    async ({ newThreshold, admin }: { newThreshold: number; admin?: string }) => {
      const publicKey = requirePublicKey(admin);
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";
      const client = new ApprovalClient({
        contractId: APPROVAL_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey,
        ...getCustomSignerOptions(publicKey),
      });
      const tx = await client.update_threshold({ new_threshold: newThreshold });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const setFeeWallet = useCallback(
    async ({ feeWalletAddress, admin }: SetFeeWalletParams) => {
      const publicKey = requirePublicKey(admin);
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey,
        ...getCustomSignerOptions(publicKey),
      });
      const tx = await client.update_fee_wallet({ new_fee_wallet: feeWalletAddress });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const updatePlatformFee = useCallback(
    async ({ newFeeBps, admin }: UpdatePlatformFeeParams) => {
      const publicKey = requirePublicKey(admin);
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey,
        ...getCustomSignerOptions(publicKey),
      });
      const tx = await client.update_fee_percentage({ new_percentage: newFeeBps });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const updatePlatformBond = useCallback(
    async ({ newBondBps, admin }: { newBondBps: bigint; admin?: string }) => {
      const publicKey = requirePublicKey(admin);
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
      const client = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey,
        ...getCustomSignerOptions(publicKey),
      });
      const tx = await client.update_bond_percentage({ new_percentage: newBondBps });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const updateShareRules = useCallback(
    async (_params: UpdateShareRulesParams) => {
      throw new Error("blkfndr_v2 does not expose share rules management.");
    },
    [],
  );

  const adminDeleteProject = useCallback(
    async (_params: AdminDeleteProjectParams) => {
      throw new Error("blkfndr_v2 does not expose admin project deletion.");
    },
    [],
  );

  const claimFunds = useCallback(
    async ({ projectId }: { projectId: bigint }) => {
      const publicKey = requirePublicKey();
      const client = createStellarClient(publicKey);
      const tx = await client.claim_funds({ project_id: projectId });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const proposeWithdrawal = useCallback(
    async ({
      projectId,
      amount,
    }: {
      projectId: bigint;
      amount: bigint;
    }) => {
      const publicKey = requirePublicKey();
      const client = createStellarClient(publicKey);
      const tx = await client.propose_withdrawal({
        proposer: publicKey,
        project_id: projectId,
        amount,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const voteWithdrawal = useCallback(
    async ({ proposalId }: { proposalId: bigint }) => {
      const publicKey = requirePublicKey();
      const client = createStellarClient(publicKey);
      const tx = await client.vote_withdrawal({
        voter: publicKey,
        proposal_id: proposalId,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const executeWithdrawal = useCallback(
    async ({ proposalId }: { proposalId: bigint }) => {
      const publicKey = requirePublicKey();
      const client = createStellarClient(publicKey);
      const tx = await client.execute_withdrawal({
        executor: publicKey,
        proposal_id: proposalId,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  const getPendingProposals = useCallback(async (): Promise<AdminProposal[]> => {
    try {
      const publicKey = requireReadOnlyPublicKey();
      const client = createStellarClient(publicKey);
      const tx = await client.get_pending_proposals();
      const simulation = (await tx.simulate()) as SimulationResult<AdminProposal[]>;
      return getSimulationResult(simulation);
    } catch (err) {
      console.warn("Failed to get pending proposals from platform contract, returning empty list:", err);
      return [];
    }
  }, [requireReadOnlyPublicKey]);

  const donateToPlatform = useCallback(
    async ({ amount, currencyType, message, donor }: DonateToPlatformParams) => {
      const publicKey = requirePublicKey(donor);
      const client = createStellarClient(publicKey);
      const tx = await client.donate_to_platform({
        donor: publicKey,
        amount,
        currency_type: currencyType,
        message,
      });
      return signAndSend(tx);
    },
    [requirePublicKey],
  );

  return {
    initialize,
    getPlatform,
    getAllProjects,
    getProjectsByStatus,
    createProject,
    fundProject,
    getUserFunds,
    getAllFundReceipts,
    refundContributor,
    getProject,
    registerToken,
    updateProjectStatus,
    approveProject,
    rejectProject,
    transferAdmin,
    addMultisigAdmin,
    removeMultisigAdmin,
    updateMultisigThreshold,
    setFeeWallet,
    updatePlatformFee,
    updatePlatformBond,
    updateShareRules,
    adminDeleteProject,
    claimFunds,
    proposeWithdrawal,
    voteWithdrawal,
    executeWithdrawal,
    getPendingProposals,
    donateToPlatform,
  };
};
