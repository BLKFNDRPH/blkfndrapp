"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import { useStellarContract } from "../hooks/use-stellar-contract";
import type { Project, FundReceipt } from "../lib/types";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar";

interface PlatformInfo {
  /**
   * The on-chain roster owner — the only address that may add or remove an
   * admin. Falls back to the first admin only when get_owner cannot be read,
   * so a temporarily unreachable node degrades to the old guess rather than
   * to nobody.
   */
  admin: string;
  feeWalletAddress: string;
  multiSigAdmins: string[];
  /**
   * The factory's flat listing fee, in stroops of the vault's token. It is
   * charged to the builder once, inside the transaction that creates the
   * vault. Stakes never pay it, so nothing in the stake flow reads this.
   */
  platformFeeStroops: number;
  /** The builder's bond as basis points of the funding goal (500 = 5%). */
  bondPercentage?: number;
}

interface AdminRoster {
  admins: string[];
  owner: string | null;
}

interface PlatformTerms {
  feeStroops: number;
  bondBps: number;
  feeWallet: string;
}

interface BlockchainContextType {
  /** Null until a page asks for it (usePlatformInfo) and both halves are read. */
  platformInfo: PlatformInfo | null;
  /** Read the roster and the terms, once. usePlatformInfo calls this. */
  requestPlatform: () => void;
  /** Read only the admin roster, once. useAdminStatus calls this. */
  requestRoster: () => void;
  projects: Project[];
  isLoadingProjects: boolean;
  userFunds: FundReceipt[];
  isLoadingFunds: boolean;
  refreshProjects: () => Promise<void>;
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
  const { getPlatformTerms, getAdmins, getAdminOwner, getFeeWallet } = useStellarContract();

  // Platform settings are read on demand, not on every page. They used to be
  // read for every visitor on every load (seven contract reads, plus an
  // admin-only settings request that answered 401 for everyone else), and the
  // home page waited for them before showing a single project, though only the
  // admin console and the launch form use them. The roster is its own half
  // because the header needs it, and only for someone with a wallet connected.
  const [roster, setRoster] = useState<AdminRoster | null>(null);
  const [terms, setTerms] = useState<PlatformTerms | null>(null);
  const rosterLoad = useRef<Promise<void> | null>(null);
  const termsLoad = useRef<Promise<void> | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const [userFunds, setUserFunds] = useState<FundReceipt[]>([]);
  const [isLoadingFunds, setIsLoadingFunds] = useState(false);

  /** Read the admin roster once; `force` reads it again. */
  const loadRoster = useCallback(
    (force = false) => {
      if (rosterLoad.current && !force) return rosterLoad.current;
      const load = Promise.all([
        getAdmins(),
        // Read rather than inferred. `admin` below used to be adminList[0],
        // which is insertion order and not a statement about authority: after
        // an ownership transfer the real owner sits wherever they happen to
        // appear in the array, so the console credited the deployer and hid
        // owner-only controls from the person who actually held them.
        getAdminOwner().catch(() => null),
      ])
        .then(([admins, owner]) => {
          setRoster({
            admins: (admins as string[] | null) ?? [],
            owner: (owner as string | null) ?? null,
          });
        })
        .catch((error) => {
          // Let the next caller try again rather than keep a failed read.
          rosterLoad.current = null;
          console.warn("Error fetching the admin roster:", error);
        });
      rosterLoad.current = load;
      return load;
    },
    [getAdmins, getAdminOwner],
  );

  /** Read the factory's terms and fee wallet once; `force` reads them again. */
  const loadTerms = useCallback(
    (force = false) => {
      if (termsLoad.current && !force) return termsLoad.current;
      const load = Promise.all([
        getPlatformTerms(),
        // Read too, rather than left blank. The fee wallet field rendered empty
        // whatever the factory actually held, so a fee wallet pointing at the
        // wrong contract looked identical to one not yet configured — and by
        // the time anyone noticed, the fees had already gone there.
        getFeeWallet().catch(() => null),
      ])
        .then(([factoryTerms, feeWallet]) => {
          setTerms({
            feeStroops: Number(factoryTerms.fee ?? 0),
            bondBps: Number(factoryTerms.bondBps ?? 500),
            feeWallet: (feeWallet as string | null) ?? "",
          });
        })
        .catch((error) => {
          termsLoad.current = null;
          console.warn("Error fetching platform terms:", error);
        });
      termsLoad.current = load;
      return load;
    },
    [getPlatformTerms, getFeeWallet],
  );

  const requestRoster = useCallback(() => {
    void loadRoster();
  }, [loadRoster]);

  const requestPlatform = useCallback(() => {
    void loadRoster();
    void loadTerms();
  }, [loadRoster, loadTerms]);

  /** Read again whatever some page has already asked for, and nothing else. */
  const refreshPlatform = useCallback(async () => {
    await Promise.all([
      rosterLoad.current ? loadRoster(true) : null,
      termsLoad.current ? loadTerms(true) : null,
    ]);
  }, [loadRoster, loadTerms]);

  const platformInfo = useMemo<PlatformInfo | null>(() => {
    if (!roster || !terms) return null;
    return {
      admin: roster.owner ?? roster.admins[0] ?? "",
      feeWalletAddress: terms.feeWallet,
      multiSigAdmins: roster.admins,
      platformFeeStroops: terms.feeStroops,
      bondPercentage: terms.bondBps,
    };
  }, [roster, terms]);

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
            const stateRes = await vaultClient.get_state();
            liveState = stateRes.result;
          } catch (stateErr) {
            console.warn(`Failed to fetch live on-chain state for ${p.id}:`, stateErr);
          }

          let info: any;
          try {
            const infoRes = await vaultClient.get_info();
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
    } finally {
      setIsLoadingProjects(false);
    }
  }, [reconcileStaleProjects]);

  const refreshUserFunds = useCallback(
    async (address: string) => {
      if (!address) {
        setUserFunds([]);
        return;
      }
      try {
        setIsLoadingFunds(true);
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

  // Answered from the roster alone, so the header can ask without reading the
  // factory's terms too.
  const isAdmin = useCallback(
    (address?: string) => {
      if (!address || !roster) return false;
      return (roster.owner ?? roster.admins[0]) === address;
    },
    [roster],
  );

  const isMultiSigAdmin = useCallback(
    (address?: string) => {
      if (!address || !roster) return false;
      return roster.admins.some((admin) => admin === address);
    },
    [roster],
  );

  // Initial load. Platform settings are not read here: see loadRoster.
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const value: BlockchainContextType = {
    platformInfo,
    requestPlatform,
    requestRoster,
    projects,
    isLoadingProjects,
    userFunds,
    isLoadingFunds,
    refreshProjects,
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

/** Platform settings, read the first time a mounted component asks. */
export const usePlatformInfo = () => {
  const { platformInfo, requestPlatform } = useBlockchain();
  useEffect(() => {
    requestPlatform();
  }, [requestPlatform]);
  return { platformInfo, isLoadingPlatform: platformInfo === null };
};

export const useProjects = () => {
  const { projects, isLoadingProjects, refreshProjects, getProjectById } =
    useBlockchain();
  return { projects, isLoadingProjects, refreshProjects, getProjectById };
};

export const useUserFunds = (address?: string) => {
  const { userFunds, isLoadingFunds, refreshUserFunds } = useBlockchain();

  useEffect(() => {
    if (address) {
      refreshUserFunds(address);
    }
  }, [address, refreshUserFunds]);

  return { userFunds, isLoadingFunds, refreshUserFunds };
};

/** Whether this wallet is a platform admin. Reads the roster only once a wallet is given. */
export const useAdminStatus = (address?: string) => {
  const { isAdmin, isMultiSigAdmin, requestRoster } = useBlockchain();
  useEffect(() => {
    if (address) requestRoster();
  }, [address, requestRoster]);
  return { hasAdminAccess: isAdmin(address) || isMultiSigAdmin(address) };
};

export const useRefreshAfterTx = () => {
  const { refreshAfterTx } = useBlockchain();
  return refreshAfterTx;
};
