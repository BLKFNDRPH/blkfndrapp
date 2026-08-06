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
import { updateProjectStatusFromChain } from "@/app/actions";

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

const mapCurrency = (
  currency: number,
): "USDC" | "USDT" | "XLM" | "WBTC" | "WETH" => {
  switch (currency) {
    case 0:
      return "XLM";
    case 1:
      return "USDC";
    case 2:
      return "USDT";
    case 3:
      return "WBTC";
    case 4:
      return "WETH";
    default:
      return "XLM";
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
  const { getPlatform, getUserFunds } =
    useStellarContract();

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

      const platformData = await getPlatform();

      let email = "";
      try {
        const settingsRes = await fetch("/api/admin/platform-settings");
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          email = settingsData.feeWalletEmail || "";
        }
      } catch (err) {
        console.warn("Failed to fetch platform settings:", err);
      }

      // Fetch multisig threshold from approval contract
      let threshold = 2;
      try {
        const { Client: ApprovalClientClass } = await import("@/packages/blkfndr_approval/src");
        const APPROVAL_ID = process.env.NEXT_PUBLIC_BLKFNDR_APPROVAL_CONTRACT_ID || "";
        const approvalClient = new ApprovalClientClass({
          contractId: APPROVAL_ID,
          rpcUrl: "https://soroban-testnet.stellar.org",
          networkPassphrase: NETWORK_PASSPHRASE,
        });
        const thresholdTx = await approvalClient.get_threshold();
        const thresholdRes = await thresholdTx.simulate();
        threshold = thresholdRes.result || 2;
      } catch (err) {
        console.warn("Failed to fetch multisig threshold:", err);
      }

      setPlatformInfo({
        admin: platformData.admin,
        feeWalletAddress: platformData.fee_wallet_address,
        feeWalletEmail: email,
        totalFeesCollected:
          platformData.total_fees_collected?.toString() || "0",
        totalDonationsReceived: "0",
        projectCounter: "0",
        multiSigAdmins: platformData.multi_sig_admins || [],
        multisigThreshold: threshold,
        shareRules: {
          minPercentage: 500,
          maxPercentage: 1500,
          description: "Balanced investor incentives",
          minPercentageDisplay: 5,
          maxPercentageDisplay: 15,
        },
        feePercentage: Number(platformData.fee_percentage) || 300,
        bondPercentage: platformData.bond_percentage !== undefined ? Number(platformData.bond_percentage) : 500,
      });
    } catch (error) {
      console.warn("Error fetching platform info:", error);
      setPlatformError(
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsLoadingPlatform(false);
    }
  }, [getPlatform]);

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
            updateProjectStatusFromChain(p.vaultAddress!).catch((err) =>
              console.warn("Failed to persist reconciled status to DB:", err)
            );

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
      }).catch((err) => {
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
        const list = await getUserFunds(address);
        const mapped = list
          .filter(
            (receipt) =>
              receipt &&
              receipt.project_id !== undefined &&
              receipt.project_id !== null &&
              receipt.fund_id !== undefined &&
              receipt.fund_id !== null &&
              receipt.amount !== undefined &&
              receipt.amount !== null
          )
          .map((receipt) => {
            const proj = projects.find((p) => p.id === receipt.project_id.toString());
            return {
              fund_id: receipt.fund_id.toString(),
              contributor: receipt.contributor,
              project_id: receipt.project_id.toString(),
              project_title: proj?.title || `Campaign #${receipt.project_id.toString()}`,
              image_url: proj?.imageUrl || "",
              amount: receipt.amount.toString(),
              usdc_amount: receipt.amount.toString(),
              share_percentage: (receipt.share_percentage ?? 0).toString(),
              fee_paid: (receipt.fee_paid ?? 0).toString(),
              fund_date: Number(receipt.fund_date ?? 0) * 1000,
              currency_type: proj?.currencyType || "USDC",
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
    [getUserFunds, projects],
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
