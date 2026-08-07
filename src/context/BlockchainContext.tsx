"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useStellarContract } from "../hooks/use-stellar-contract";
import { getIPFSGatewayUrl } from "../lib/pinata-client";
import type { Project, FundReceipt } from "../lib/types";
import { getUsersByAddresses } from "../lib/data.client";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar";


const mapStatus = (status: number): Project["status"] => {
  switch (status) {
    case 0:
      return "hidden";
    case 1:
      return "pending";
    case 2:
      return "rejected";
    case 3:
      return "approved";
    case 4:
      return "funded";
    case 5:
      return "completed";
    case 6:
      return "expired";
    default:
      return "pending";
  }
};

interface PlatformInfo {
  admin: string;
  feeWalletAddress: string;
  feeWalletEmail: string;
  totalFeesCollected: string;
  totalDonationsReceived: string;
  projectCounter: string;
  multiSigAdmins: string[];
  multisigThreshold: number;
  shareRules: {
    minPercentage: number;
    maxPercentage: number;
    description: string;
    minPercentageDisplay: number;
    maxPercentageDisplay: number;
  };
  feePercentage: number;
  bondPercentage?: number;
}

interface BlockchainContextType {
  platformInfo: PlatformInfo | null;
  isLoadingPlatform: boolean;
  platformError: string | null;
  projects: Project[];
  isLoadingProjects: boolean;
  projectsError: string | null;
  hasNextPage: boolean;
  nextCursor: string | null;
  userFunds: FundReceipt[];
  isLoadingFunds: boolean;
  fundsError: string | null;
  refreshPlatform: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  loadMoreProjects: () => Promise<void>;
  refreshUserFunds: (address: string) => Promise<void>;
  refreshAfterTx: (userAddress?: string, delayMs?: number) => Promise<void>;
  getProjectById: (id: string) => Project | undefined;
  isAdmin: (address?: string) => boolean;
  isMultiSigAdmin: (address?: string) => boolean;
}

const BlockchainContext = createContext<BlockchainContextType | undefined>(
  undefined,
);

interface BlockchainProviderProps {
  children: ReactNode;
}

export const BlockchainProvider: React.FC<BlockchainProviderProps> = ({
  children,
}) => {
  const { getPlatformTerms, getAdmins } = useStellarContract();

  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [isLoadingPlatform, setIsLoadingPlatform] = useState(true);
  const [platformError, setPlatformError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [hasNextPage] = useState(false);
  const [nextCursor] = useState<string | null>(null);

  const [userFunds, setUserFunds] = useState<FundReceipt[]>([]);
  const [isLoadingFunds, setIsLoadingFunds] = useState(false);
  const [fundsError, setFundsError] = useState<string | null>(null);

  const refreshPlatform = useCallback(async () => {
    try {
      setIsLoadingPlatform(true);
      setPlatformError(null);

      // Platform terms live on the factory now, and the admin roster is its own
      // contract. The retired crowdfunding contract exposed all of it as one
      // Platform struct, which is why this used to be a single call.
      const [terms, admins] = await Promise.all([getPlatformTerms(), getAdmins()]);

      let email = '';
      try {
        const settingsRes = await fetch('/api/admin/platform-settings');
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          email = settingsData.feeWalletEmail || '';
        }
      } catch (err) {
        console.warn('Failed to fetch platform settings:', err);
      }

      const adminList = (admins as string[] | null) ?? [];

      setPlatformInfo({
        admin: adminList[0] ?? '',
        feeWalletAddress: '',
        feeWalletEmail: email,
        totalFeesCollected: '0',
        totalDonationsReceived: '0',
        projectCounter: '0',
        multiSigAdmins: adminList,
        // No approval threshold exists any more: milestone release is decided
        // by contributors inside each vault, weighted by contribution.
        multisigThreshold: 0,
        shareRules: {
          minPercentage: 500,
          maxPercentage: 1500,
          description: 'Balanced investor incentives',
          minPercentageDisplay: 5,
          maxPercentageDisplay: 15,
        },
        // A flat amount in stroops, not a percentage.
        feePercentage: Number(terms.fee ?? 0),
        bondPercentage: Number(terms.bondBps ?? 500),
      });
    } catch (error) {
      console.warn("Error fetching platform info:", error);
      setPlatformError(
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsLoadingPlatform(false);
    }
  }, [getPlatformTerms, getAdmins]);

  const reconcileStaleProjects = useCallback(async (loadedProjects: Project[]) => {
    const stale = loadedProjects.filter(
      (p) => p.status === "raising" && p.fundingDeadline && p.fundingDeadline < Date.now() && p.vaultAddress
    );
    if (stale.length === 0) return loadedProjects;

    const toProcess = stale.slice(0, 5);
    const updatedMap = new Map<string, Project>();

    await Promise.all(
      toProcess.map(async (p) => {
        try {
          const vaultClient = new VaultClient({
            contractId: p.vaultAddress!,
            rpcUrl: SOROBAN_RPC_URL,
            networkPassphrase: NETWORK_PASSPHRASE,
          });

          let liveState: number | undefined;
          try {
            const stateTx = await vaultClient.get_state();
            const stateRes = await stateTx.simulate();
            liveState = stateRes.result;
          } catch (stateErr) {
            console.warn(`Failed to fetch live on-chain state for ${p.id}:`, stateErr);
          }

          let info: any;
          try {
            const infoTx = await vaultClient.get_info();
            const infoRes = await infoTx.simulate();
            info = infoRes.result;
          } catch (infoErr) {
            console.warn(`Failed to fetch live on-chain info for ${p.id}:`, infoErr);
          }

          if (liveState !== undefined) {
            const statusMap: Record<number, Project["status"]> = {
              0: "raising",
              1: "funded",
              2: "active",
              3: "failed",
              4: "refunding",
              5: "completed",
            };

            let mappedStatus = statusMap[liveState] || p.status;

            const freshProject: Project = {
              ...p,
              status: mappedStatus,
            };

            if (info) {
              freshProject.currentFunding = Number(info.raised_amount) / 10_000_000;
              freshProject.fundingGoal = Number(info.goal) / 10_000_000;
              freshProject.currentFundingRaw = info.raised_amount.toString();
              freshProject.fundingGoalRaw = info.goal.toString();
              freshProject.fundingDeadline = Number(info.deadline) * 1000;
              freshProject.bondPosted = info.bond_posted;
              freshProject.bondAmount = Number(info.bond_amount) / 10_000_000;
              freshProject.releasedTotal = Number(info.released_total) / 10_000_000;

              if (mappedStatus === "raising" && !info.bond_posted) {
                mappedStatus = "pending";
                freshProject.status = mappedStatus;
              }

              if (info.milestones && info.milestones.length > 0) {
                freshProject.milestones = (p.milestones || []).map((m) => {
                  const liveM = info.milestones.find((lm: any) => Number(lm.id) === m.id);
                  return {
                    ...m,
                    released: liveM ? liveM.released : m.released,
                    amount: liveM ? Number(liveM.amount) / 10_000_000 : m.amount,
                  };
                });
              }
            }

            // Persist to DB asynchronously. The server re-reads the vault
            // itself rather than trusting figures posted from the browser.
            // Persisting is the indexer's job; this view only reflects what
            // the ledger currently says.

            updatedMap.set(p.id, freshProject);
          }
        } catch (err) {
          console.warn(`Failed to reconcile project ${p.id} from chain:`, err);
        }
      })
    );

    if (updatedMap.size > 0) {
      return loadedProjects.map((p) => updatedMap.get(p.id) || p);
    }
    return loadedProjects;
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      setIsLoadingProjects(true);
      setProjectsError(null);

      const res = await fetch("/api/projects", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) {
        throw new Error("Failed to fetch projects from database API");
      }
      const loadedProjects: Project[] = await res.json();
      setProjects(loadedProjects.sort((a, b) => Number(b.id) - Number(a.id)));

      reconcileStaleProjects(loadedProjects).then((reconciled) => {
        setProjects(reconciled.sort((a, b) => Number(b.id) - Number(a.id)));
      }).catch((err: unknown) => {
        console.warn("Failed to reconcile stale projects:", err);
      });
    } catch (error) {
      console.warn("Error fetching projects:", error);
      setProjectsError(
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsLoadingProjects(false);
    }
  }, [reconcileStaleProjects]);

  const loadMoreProjects = useCallback(async () => {
    // No pagination implemented on contract yet, all projects are fetched
  }, []);

  const refreshUserFunds = useCallback(
    async (address: string) => {
      if (!address) {
        setUserFunds([]);
        return;
      }
      try {
        setIsLoadingFunds(true);
        setFundsError(null);
        // Contributions are per-vault now, so there is no single contract call
        // that returns a wallet's whole history. The indexer already
        // reconstructs it from DEPOSIT/CONTRIB events.
        const res = await fetch(
          `/api/user/funds?address=${encodeURIComponent(address)}`,
        );
        if (!res.ok) {
          throw new Error('Could not load your contributions.');
        }
        const list: any[] = await res.json();
        const mapped = (Array.isArray(list) ? list : []).map((receipt: any) => {
          const proj = projects.find((p) => p.id === String(receipt.project_id));
          return {
            fund_id: String(receipt.fund_id ?? ''),
            contributor: receipt.contributor,
            project_id: String(receipt.project_id ?? ''),
            project_title:
              proj?.title || receipt.project_title || `Campaign #${receipt.project_id}`,
            image_url: proj?.imageUrl || receipt.image_url || '',
            amount: String(receipt.amount ?? '0'),
            usdc_amount: String(receipt.usdc_amount ?? receipt.amount ?? '0'),
            share_percentage: String(receipt.share_percentage ?? '0'),
            fee_paid: String(receipt.fee_paid ?? '0'),
            fund_date: Number(receipt.fund_date ?? 0),
            currency_type: proj?.currencyType || receipt.currency_type || 'USDC',
          };
        });
        setUserFunds(mapped);
      } catch (error) {
        console.warn("Error fetching user contributions:", error);
        setFundsError(
          error instanceof Error ? error.message : "Unknown error",
        );
      } finally {
        setIsLoadingFunds(false);
      }
    },
    [projects],
  );

  const refreshAfterTx = useCallback(
    async (userAddress?: string, delayMs = 3000) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      
      try {
        const { triggerIndexerSync } = await import("@/app/actions");
        await triggerIndexerSync();
      } catch (err) {
        console.warn("Failed to trigger indexer sync inside refreshAfterTx:", err);
      }

      await Promise.all([
        refreshProjects(),
        refreshPlatform(),
        ...(userAddress ? [refreshUserFunds(userAddress)] : []),
      ]);
    },
    [refreshProjects, refreshPlatform, refreshUserFunds],
  );

  const getProjectById = useCallback(
    (id: string) => {
      return projects.find((p) => p.id === id);
    },
    [projects],
  );

  const isAdmin = useCallback(
    (address?: string) => {
      if (!address || !platformInfo) return false;
      return platformInfo.admin === address;
    },
    [platformInfo],
  );

  const isMultiSigAdmin = useCallback(
    (address?: string) => {
      if (!address || !platformInfo) return false;
      return platformInfo.multiSigAdmins.some(
        (admin) => admin === address,
      );
    },
    [platformInfo],
  );

  // Initial load
  useEffect(() => {
    refreshPlatform();
    refreshProjects();
  }, [refreshPlatform, refreshProjects]);

  const value: BlockchainContextType = {
    platformInfo,
    isLoadingPlatform,
    platformError,
    projects,
    isLoadingProjects,
    projectsError,
    hasNextPage,
    nextCursor,
    userFunds,
    isLoadingFunds,
    fundsError,
    refreshPlatform,
    refreshProjects,
    loadMoreProjects,
    refreshUserFunds,
    refreshAfterTx,
    getProjectById,
    isAdmin,
    isMultiSigAdmin,
  };

  return (
    <BlockchainContext.Provider value={value}>
      {children}
    </BlockchainContext.Provider>
  );
};

export const useBlockchain = () => {
  const context = useContext(BlockchainContext);
  if (context === undefined) {
    throw new Error("useBlockchain must be used within a BlockchainProvider");
  }
  return context;
};

export const usePlatformInfo = () => {
  const { platformInfo, isLoadingPlatform, platformError, refreshPlatform } =
    useBlockchain();
  return { platformInfo, isLoadingPlatform, platformError, refreshPlatform };
};

export const useProjects = () => {
  const {
    projects,
    isLoadingProjects,
    projectsError,
    hasNextPage,
    refreshProjects,
    loadMoreProjects,
    getProjectById,
  } = useBlockchain();
  return {
    projects,
    isLoadingProjects,
    projectsError,
    hasNextPage,
    refreshProjects,
    loadMoreProjects,
    getProjectById,
  };
};

export const useUserFunds = (address?: string) => {
  const {
    userFunds,
    isLoadingFunds,
    fundsError,
    refreshUserFunds,
  } = useBlockchain();

  useEffect(() => {
    if (address) {
      refreshUserFunds(address);
    }
  }, [address, refreshUserFunds]);

  return {
    userFunds,
    isLoadingFunds,
    fundsError,
    refreshUserFunds,
  };
};

export const useAdminStatus = (address?: string) => {
  const { isAdmin, isMultiSigAdmin, platformInfo, isLoadingPlatform } =
    useBlockchain();
  return {
    isAdmin: isAdmin(address),
    isMultiSigAdmin: isMultiSigAdmin(address),
    hasAdminAccess: isAdmin(address) || isMultiSigAdmin(address),
    platformInfo,
    isLoadingPlatform,
  };
};

export const useRefreshAfterTx = () => {
  const { refreshAfterTx } = useBlockchain();
  return refreshAfterTx;
};
