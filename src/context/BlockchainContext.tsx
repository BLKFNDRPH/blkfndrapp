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
import type { Project, FundReceipt } from "../lib/types";
import type { PlatformSnapshot } from "@/lib/platform-reads";
import { fetchVaultState, withVaultState } from "@/lib/live-project";

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

interface BlockchainContextType {
  /** Null until a page asks for it (usePlatformInfo, useAdminStatus) and it is read. */
  platformInfo: PlatformInfo | null;
  /** Read the platform settings, once. usePlatformInfo and useAdminStatus call this. */
  requestPlatform: () => void;
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
  // Platform settings are read on demand, not on every page, and from this
  // app's /api/platform rather than from the public RPC: the server reads the
  // five values once a minute and shares them. They used to be read by every
  // browser on every page, and the home page waited for them before showing a
  // single project, though only the admin console, the launch form and the
  // header's admin link use them.
  const [platform, setPlatform] = useState<PlatformSnapshot | null>(null);
  const platformLoad = useRef<Promise<void> | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const [userFunds, setUserFunds] = useState<FundReceipt[]>([]);
  const [isLoadingFunds, setIsLoadingFunds] = useState(false);

  /**
   * Read the settings once; `fresh` reads them again, past the server's
   * minute of cache (honoured for a signed-in caller, as after an admin edit).
   */
  const loadPlatform = useCallback((fresh = false) => {
    if (platformLoad.current && !fresh) return platformLoad.current;
    const load = fetch(`/api/platform${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`platform settings: HTTP ${res.status}`);
        setPlatform((await res.json()) as PlatformSnapshot);
      })
      .catch((error) => {
        // Let the next caller try again rather than keep a failed read.
        platformLoad.current = null;
        console.warn("Error fetching platform info:", error);
      });
    platformLoad.current = load;
    return load;
  }, []);

  const requestPlatform = useCallback(() => {
    void loadPlatform();
  }, [loadPlatform]);

  /** Read again if some page has already asked for the settings, and not otherwise. */
  const refreshPlatform = useCallback(async () => {
    if (platformLoad.current) await loadPlatform(true);
  }, [loadPlatform]);

  const platformInfo = useMemo<PlatformInfo | null>(() => {
    if (!platform) return null;
    return {
      // Read rather than inferred. `admin` used to be the first on the list,
      // which is insertion order and not a statement about authority: after
      // an ownership transfer the real owner sits wherever they happen to
      // appear, so the console credited the deployer and hid owner-only
      // controls from the person who actually held them.
      admin: platform.owner ?? platform.admins[0] ?? "",
      // Read too, rather than left blank: a fee wallet pointing at the wrong
      // contract must not look identical to one not yet configured.
      feeWalletAddress: platform.feeWallet,
      multiSigAdmins: platform.admins,
      platformFeeStroops: platform.feeStroops,
      bondPercentage: platform.bondBps,
    };
  }, [platform]);

  /**
   * A project still listed as raising after its deadline has very likely
   * moved on at the vault. Show what the vault says for the first few, so the
   * list does not offer stakes on a closed project. Persisting is the
   * indexer's job; this only reflects the ledger.
   */
  const reconcileStaleProjects = useCallback(async (loadedProjects: Project[]) => {
    const stale = loadedProjects.filter(
      (p) => p.status === "raising" && p.fundingDeadline && p.fundingDeadline < Date.now() && p.vaultAddress
    );
    if (stale.length === 0) return loadedProjects;

    const updatedMap = new Map<string, Project>();
    await Promise.all(
      stale.slice(0, 5).map(async (p) => {
        const state = await fetchVaultState(p.id);
        if (state) updatedMap.set(p.id, withVaultState(p, state));
      }),
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
      return platformInfo.multiSigAdmins.some((admin) => admin === address);
    },
    [platformInfo],
  );

  // Initial load. Platform settings are not read here: see loadPlatform.
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const value: BlockchainContextType = {
    platformInfo,
    requestPlatform,
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

/** Whether this wallet is a platform admin. Reads the settings only once a wallet is given. */
export const useAdminStatus = (address?: string) => {
  const { isAdmin, isMultiSigAdmin, requestPlatform } = useBlockchain();
  useEffect(() => {
    if (address) requestPlatform();
  }, [address, requestPlatform]);
  return { hasAdminAccess: isAdmin(address) || isMultiSigAdmin(address) };
};

export const useRefreshAfterTx = () => {
  const { refreshAfterTx } = useBlockchain();
  return refreshAfterTx;
};
