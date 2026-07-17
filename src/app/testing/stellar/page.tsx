"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useAuth } from "@/context/AuthContext";
import { createNotification } from "@/actions/notifications-client";
import { createClaimRequest } from "@/actions/claims";
import {
  CurrencyType,
  type Platform,
  type Project,
  ProjectStatus,
} from "@/packages/blkfndr_v2";
import type { FundReceipt } from "@/lib/types";
import { Client as FactoryClient } from "@/packages/blkfndr_factory/src";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TextPressure from "@/components/layout/TextPressure";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { getPinataClient, getIPFSGatewayUrl } from "@/lib/pinata-client";
import {
  getAccountInfo,
  getBalance,
  getRecentAccountOperations,
  type StellarAccountActivityItem,
} from "@/lib/stellar";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCw,
  Copy,
  ChevronDown,
  ChevronUp,
  Info,
  ExternalLink,
  Lock,
  Wallet,
  Coins,
  ArrowRight,
  Clock,
  Check,
} from "lucide-react";

const PROJECT_FETCH_LIMIT = 60;
const MONTH = 30 * 24 * 60 * 60;

const CATEGORY_OPTIONS = [
  "Technology",
  "Gaming",
  "Arts",
  "Education",
  "Health",
  "Environment",
  "Community",
];

const DEADLINE_PRESETS = [
  { value: "1", label: "1 month", seconds: MONTH },
  { value: "3", label: "3 months", seconds: 3 * MONTH },
  { value: "6", label: "6 months", seconds: 6 * MONTH },
  { value: "12", label: "12 months", seconds: 12 * MONTH },
];

type CreateProjectInput = {
  blob_id: string;
  category: string;
  description: string;
  funding_deadline: bigint;
  goal: bigint;
  is_public: boolean;
  tagline: string;
  title: string;
  currencyType: CurrencyType;
};

const STATUS_LABELS: Record<number, string> = {
  0: "Hidden",
  1: "Pending Review",
  2: "Rejected",
  3: "Approved",
  4: "Funded",
  5: "Completed",
  6: "Expired",
};

const formatBigInt = (value: bigint) =>
  value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const formatDeadline = (deadline: bigint) => {
  const unix = Number(deadline);
  if (!Number.isFinite(unix) || unix <= 0) return "No deadline";

  const now = Math.floor(Date.now() / 1000);
  const diff = unix - now;
  const date = new Date(unix * 1000).toLocaleString();
  if (diff <= 0) return `${date} (ended)`;

  const days = Math.ceil(diff / 86400);
  return `${date} (${days} day${days === 1 ? "" : "s"} left)`;
};

const toDeadlineFromPreset = (months: string) => {
  const preset = DEADLINE_PRESETS.find((item) => item.value === months);
  const seconds = preset?.seconds ?? MONTH;
  const now = Math.floor(Date.now() / 1000);
  return BigInt(now + seconds);
};

const XLM_TOKEN_PRESET = process.env.NEXT_PUBLIC_STELLAR_XLM_TOKEN_ID ?? "";
const USDC_TOKEN_PRESET = process.env.NEXT_PUBLIC_STELLAR_USDC_TOKEN_ID ?? "";
const USDT_TOKEN_PRESET = process.env.NEXT_PUBLIC_STELLAR_USDT_TOKEN_ID ?? "";
const WBTC_TOKEN_PRESET = process.env.NEXT_PUBLIC_STELLAR_WBTC_TOKEN_ID ?? "";
const WETH_TOKEN_PRESET = process.env.NEXT_PUBLIC_STELLAR_WETH_TOKEN_ID ?? "";

const defaultCreateInput: CreateProjectInput = {
  blob_id: "",
  category: CATEGORY_OPTIONS[0],
  description: "",
  funding_deadline: toDeadlineFromPreset("1"),
  goal: BigInt(0),
  is_public: true,
  tagline: "",
  title: "",
  currencyType: CurrencyType.XLM,
};

const stringifyWithBigInt = (value: unknown) =>
  JSON.stringify(
    value,
    (_, val) => (typeof val === "bigint" ? val.toString() : val),
    2,
  );

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const shortenAddress = (
  value: string | null | undefined,
  head = 6,
  tail = 6,
) => {
  if (!value) return "not connected";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const getStatusToneClass = (status: number) => {
  if (status === 3) return "bg-emerald-100 text-emerald-700";
  if (status === 4) return "bg-blue-100 text-blue-700";
  if (status === 2 || status === 6) return "bg-rose-100 text-rose-700";
  if (status === 1) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
};

const getProgressPercent = (raised: bigint, goal: bigint) => {
  if (goal <= BigInt(0)) return 0;
  const pct = Number((raised * BigInt(10000)) / goal) / 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
};

const MOCK_USD_RATES: Record<string, number> = {
  XLM: 0.15,
  USDC: 1.0,
  USDT: 1.0,
  WBTC: 65000.0,
  WETH: 3500.0,
};

const PROJECT_PLACEHOLDER_IMAGE =
  "https://cdn.dribbble.com/userupload/24360672/file/original-185b34e5d1793db979a43af6d6abd426.gif";

const demystifyError = (errorStr: string) => {
  const lowercase = errorStr.toLowerCase();

  if (
    lowercase.includes("user rejected") ||
    lowercase.includes("rejected the transaction") ||
    lowercase.includes("canceled") ||
    lowercase.includes("cancelled")
  ) {
    return {
      title: "Transaction Cancelled",
      description:
        "You cancelled the signing request in Freighter wallet. To complete this action, please approve the wallet confirmation popup.",
      actionTip:
        "Ensure your Freighter wallet is unlocked and try clicking the button again.",
    };
  }

  if (
    lowercase.includes("insufficient funds") ||
    lowercase.includes("insufficient balance") ||
    lowercase.includes("underfunded")
  ) {
    return {
      title: "Insufficient Balance",
      description:
        "Your connected Stellar wallet does not have enough balance of the selected token to cover this transaction amount and network fees.",
      actionTip:
        "Fund your wallet or decrease the transaction amount and try again.",
    };
  }

  if (
    lowercase.includes("unregistered token") ||
    lowercase.includes("token not registered") ||
    lowercase.includes("invalid currency")
  ) {
    return {
      title: "Currency Not Registered",
      description:
        "This currency token is not registered on the smart contract yet. Unregistered currencies cannot be used for project operations.",
      actionTip:
        "Register the token in the 'Register Token' utility before attempting this action.",
    };
  }

  if (
    lowercase.includes("unauthorized") ||
    lowercase.includes("not authorized") ||
    lowercase.includes("not admin") ||
    lowercase.includes("restricted")
  ) {
    return {
      title: "Access Restricted",
      description:
        "This action is protected by smart contract access controls. Your connected wallet is not authorized to execute this command.",
      actionTip:
        "Switch to an authorized admin or multisig owner wallet in Freighter and refresh.",
    };
  }

  if (
    lowercase.includes("deadline") ||
    lowercase.includes("expired") ||
    lowercase.includes("past")
  ) {
    return {
      title: "Funding Period Ended",
      description:
        "This project has either reached its funding deadline or has already expired, making further actions invalid.",
      actionTip:
        "Verify the project's status and deadline, or select a different project.",
    };
  }

  if (
    lowercase.includes("wallet is not connected") ||
    lowercase.includes("freighter wallet is not connected")
  ) {
    return {
      title: "Wallet Disconnected",
      description:
        "Freighter wallet is not connected or unauthorized for this application.",
      actionTip:
        "Click the Freighter connection widget or unlock Freighter to authenticate.",
    };
  }

  // Fallback
  return {
    title: "Action Execution Failed",
    description:
      errorStr || "An unexpected error occurred during the transaction.",
    actionTip: "Inspect the technical logs below or retry the operation.",
  };
};

function VisualErrorCard({
  error,
  title,
  onRetry,
}: {
  error: string | null;
  title?: string;
  onRetry?: () => void | Promise<void>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!error) return null;

  const info = demystifyError(error);

  const handleCopy = () => {
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-rose-500/25 bg-rose-500/5 p-5 shadow-[0_0_15px_-3px_rgba(239,68,68,0.15)] backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-4">
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <div className="rounded-full bg-rose-500/10 p-2.5 text-rose-500">
            <AlertCircle className="h-6 w-6 animate-pulse" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-base font-semibold text-rose-500">
            {title || info.title}
          </h4>
          <p className="mt-1 text-sm text-foreground/80 leading-relaxed">
            {info.description}
          </p>
          <div className="mt-2 text-xs flex items-center gap-1 text-muted-foreground bg-muted/40 rounded px-2.5 py-1.5 w-fit border border-muted-foreground/10">
            <Info className="h-3.5 w-3.5 text-rose-400 flex-shrink-0" />
            <span>{info.actionTip}</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-600 transition duration-200"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Retry Operation
              </button>
            )}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-2 text-xs font-semibold text-rose-400 transition duration-200"
            >
              {showDetails ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showDetails ? "Hide Logs" : "View Logs"}
            </button>
          </div>

          {showDetails && (
            <div className="mt-4 rounded-lg bg-black/40 border border-muted-foreground/10 p-3 animate-in fade-in slide-in-from-top-2">
              <div className="flex justify-between items-center pb-2 border-b border-muted-foreground/10 mb-2">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider font-mono">
                  SDK Technical Logs
                </span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 font-semibold transition"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied!" : "Copy Technical Logs"}
                </button>
              </div>
              <pre className="text-[11px] font-mono leading-relaxed text-rose-200/90 whitespace-pre-wrap max-h-40 overflow-y-auto pr-1">
                {error}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VisualSuccessCard({
  message,
  title,
  onDismiss,
}: {
  message: string | null;
  title?: string;
  onDismiss?: () => void;
}) {
  if (!message) return null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5 shadow-[0_0_15px_-3px_rgba(16,185,129,0.15)] backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-4">
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <div className="rounded-full bg-emerald-500/10 p-2.5 text-emerald-500">
            <CheckCircle2 className="h-6 w-6" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-base font-semibold text-emerald-500">
            {title || "Action Successful"}
          </h4>
          <p className="mt-1 text-sm text-foreground/80 leading-relaxed">
            {message}
          </p>

          {onDismiss && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={onDismiss}
                className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition duration-200"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StellarTestingPage() {
  const {
    initialize,
    getPlatform,
    getAllProjects,
    getProjectsByStatus,
    createProject,
    fundProject,
    registerToken,
    getUserFunds,
    refundContributor,
    claimFunds,
  } = useStellarContract();
  const { freighterWalletAddress } = useFreighterWallet();
  const { user } = useAuth();

  const formatStroopsToTokens = (stroops: bigint | number) => {
    const value = typeof stroops === "bigint" ? stroops : BigInt(stroops || 0);
    const tokens = Number(value) / 10_000_000;
    return tokens.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const getUsdValueString = (
    stroops: bigint | number,
    currencySymbol: string,
  ) => {
    const value = typeof stroops === "bigint" ? stroops : BigInt(stroops || 0);
    const tokens = Number(value) / 10_000_000;
    const rate = usdRates?.[currencySymbol] || 0;
    const usd = tokens * rate;
    return `$${usd.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} USD`;
  };

  const [receipts, setReceipts] = useState<FundReceipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [newlyMintedReceipt, setNewlyMintedReceipt] =
    useState<FundReceipt | null>(null);
  const [isRefundPending, setIsRefundPending] = useState<
    Record<string, boolean>
  >({});

  const [activeTab, setActiveTab] = useState("explorer");

  const [projects, setProjects] = useState<Project[]>([]);
  const [approvedProjects, setApprovedProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [isCreatePending, setIsCreatePending] = useState(false);
  const [isFundPending, setIsFundPending] = useState(false);
  const [isInitPending, setIsInitPending] = useState(false);
  const [isRegisterPending, setIsRegisterPending] = useState(false);
  const [isClaimPending, setIsClaimPending] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<string | null>(null);
  const { toast: triggerToast } = useToast();

  const [platformData, setPlatformData] = useState<Platform | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);

  const [feeWalletAddress, setFeeWalletAddress] = useState("");
  const [feePercentage, setFeePercentage] = useState("300");
  const [initError, setInitError] = useState<string | null>(null);
  const [initResult, setInitResult] = useState<string | null>(null);

  const [createInput, setCreateInput] =
    useState<CreateProjectInput>(defaultCreateInput);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<string | null>(null);
  const [deadlinePreset, setDeadlinePreset] = useState("1");
  const [createCurrencyType, setCreateCurrencyType] = useState<
    "XLM" | "USDC" | "USDT" | "WBTC" | "WETH"
  >("XLM");
  const [createImagePreview, setCreateImagePreview] = useState<string | null>(
    null,
  );
  const [createImageName, setCreateImageName] = useState<string | null>(null);
  const [isCreateImageUploading, setIsCreateImageUploading] = useState(false);
  const [registerCurrencyType, setRegisterCurrencyType] = useState<
    "XLM" | "USDC" | "USDT" | "WBTC" | "WETH"
  >("XLM");
  const [registerTokenAddress, setRegisterTokenAddress] =
    useState(XLM_TOKEN_PRESET);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerResult, setRegisterResult] = useState<string | null>(null);

  const [createGoalStr, setCreateGoalStr] = useState("");
  const [usdRates, setUsdRates] =
    useState<Record<string, number>>(MOCK_USD_RATES);

  const handleCreateImageChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      setCreateImagePreview(null);
      setCreateImageName(null);
      setCreateInput((prev) => ({
        ...prev,
        blob_id: "",
      }));
      return;
    }

    setCreateImageName(file.name);
    setCreateInput((prev) => ({
      ...prev,
      blob_id: "",
    }));

    const reader = new FileReader();
    reader.onloadend = () => {
      setCreateImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateImageUpload = async () => {
    const fileInput = document.getElementById(
      "stellar-create-project-image",
    ) as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file) {
      setCreateError("Please choose a project image first.");
      return;
    }

    setCreateError(null);
    setIsCreateImageUploading(true);

    try {
      const pinata = getPinataClient();
      const cid = await pinata.uploadFile(file);
      setCreateInput((prev) => ({
        ...prev,
        blob_id: cid,
      }));
      setCreateImagePreview(getIPFSGatewayUrl(cid));
      triggerToast({
        title: "Image uploaded",
        description: "Your project image is now attached and ready to use.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCreateError(message);
      triggerToast({
        title: "Image upload failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsCreateImageUploading(false);
    }
  };

  useEffect(() => {
    const fetchLiveRates = async () => {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=stellar,usd-coin,tether,wrapped-bitcoin,weth&vs_currencies=usd",
        );
        if (response.ok) {
          const data = await response.json();
          setUsdRates({
            XLM: data["stellar"]?.usd ?? MOCK_USD_RATES.XLM,
            USDC: data["usd-coin"]?.usd ?? MOCK_USD_RATES.USDC,
            USDT: data["tether"]?.usd ?? MOCK_USD_RATES.USDT,
            WBTC: data["wrapped-bitcoin"]?.usd ?? MOCK_USD_RATES.WBTC,
            WETH: data["weth"]?.usd ?? MOCK_USD_RATES.WETH,
          });
          console.log(
            "Stellar testing page: Live rates updated successfully.",
            data,
          );
        }
      } catch (error) {
        console.warn(
          "Failed to fetch live crypto rates, using fallbacks:",
          error,
        );
      }
    };
    fetchLiveRates();
  }, []);

  const [fundProjectId, setFundProjectId] = useState("");
  const [fundAmount, setFundAmount] = useState("0");
  const [fundError, setFundError] = useState<string | null>(null);
  const [fundResult, setFundResult] = useState<string | null>(null);

  const [balances, setBalances] = useState<any[]>([]);
  const [accountSeq, setAccountSeq] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<
    StellarAccountActivityItem[]
  >([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const refreshProjectData = useCallback(async () => {
    if (!freighterWalletAddress) {
      setPlatformData(null);
      setProjects([]);
      setSelectedProjectId("");
      return;
    }

    setProjectsLoading(true);
    setPlatformError(null);
    setProjectsError(null);
    setPlatformData(null);

    try {
      const [platform, loadedProjects, approvedLoadedProjects] =
        await Promise.all([
          getPlatform(),
          getAllProjects(),
          getProjectsByStatus({ status: ProjectStatus.Approved }),
        ]);
      setPlatformData(platform);

      const sortedProjects = loadedProjects
        .slice()
        .sort((a, b) => Number(b.id - a.id));

      setProjects(sortedProjects);
      setApprovedProjects(
        approvedLoadedProjects.slice().sort((a, b) => Number(b.id - a.id)),
      );
      if (sortedProjects.length > 0) {
        const first = sortedProjects[0].id.toString();
        setSelectedProjectId((prev) => prev || first);
      } else {
        setSelectedProjectId("");
      }

      if (approvedLoadedProjects.length > 0) {
        const firstApproved = approvedLoadedProjects[0].id.toString();
        setFundProjectId((prev) =>
          approvedLoadedProjects.some(
            (project) => project.id.toString() === prev,
          )
            ? prev
            : firstApproved,
        );
      } else {
        setFundProjectId("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlatformError(message);
      setProjectsError(message);
    } finally {
      setProjectsLoading(false);
    }
  }, [
    freighterWalletAddress,
    getPlatform,
    getAllProjects,
    getProjectsByStatus,
  ]);

  useEffect(() => {
    refreshProjectData().catch((err) =>
      console.error("initial project refresh failed:", err),
    );
  }, [refreshProjectData]);

  const refreshUserReceipts = useCallback(async () => {
    if (!freighterWalletAddress) {
      setReceipts([]);
      return;
    }
    setReceiptsLoading(true);
    setReceiptsError(null);
    try {
      const list = await getUserFunds(freighterWalletAddress);
      const sorted = list
        .slice()
        .sort((a: FundReceipt, b: FundReceipt) => Number(BigInt(b.fund_id) - BigInt(a.fund_id)));
      setReceipts(sorted);
    } catch (err) {
      console.error("Failed to load user investments:", err);
      setReceiptsError(err instanceof Error ? err.message : String(err));
    } finally {
      setReceiptsLoading(false);
    }
  }, [freighterWalletAddress, getUserFunds]);

  useEffect(() => {
    if (activeTab === "receipts") {
      refreshUserReceipts();
    }
  }, [activeTab, refreshUserReceipts]);

  const refreshWalletActivity = useCallback(async () => {
    if (!freighterWalletAddress) {
      setBalances([]);
      setRecentActivity([]);
      setAccountSeq(null);
      return;
    }

    setActivityLoading(true);
    setActivityError(null);
    try {
      const [account, walletBalances, operations] = await Promise.all([
        getAccountInfo(freighterWalletAddress),
        getBalance(freighterWalletAddress),
        getRecentAccountOperations(freighterWalletAddress, 20),
      ]);

      setBalances(walletBalances as any[]);
      setAccountSeq(account.sequence ?? null);
      setRecentActivity(operations);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActivityError(message);
    } finally {
      setActivityLoading(false);
    }
  }, [freighterWalletAddress]);

  useEffect(() => {
    refreshWalletActivity().catch((err) =>
      console.error("wallet activity refresh failed:", err),
    );
  }, [refreshWalletActivity]);

  const selectedProject = useMemo(
    () =>
      projects.find((project) => project.id.toString() === selectedProjectId) ??
      null,
    [projects, selectedProjectId],
  );

  const selectedFundProject = useMemo(
    () =>
      approvedProjects.find(
        (project) => project.id.toString() === fundProjectId,
      ) ?? null,
    [approvedProjects, fundProjectId],
  );

  const handleInitialize = async () => {
    setInitError(null);
    setInitResult(null);
    setIsInitPending(true);
    try {
      const result = await initialize({
        feeWalletAddress,
        feePercentage,
      });
      setInitResult("Contract initialized successfully.");
      triggerToast({
        title: "Success",
        description: "Stellar Contract initialized successfully.",
      });
      console.log("initialize result:", result);
      await refreshProjectData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInitError(message);
      triggerToast({
        title: "Initialization Failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsInitPending(false);
    }
  };

  const handleCreateProject = async () => {
    setCreateError(null);
    setCreateResult(null);

    const cleanGoalStr = createGoalStr.trim();
    if (!cleanGoalStr || isNaN(parseFloat(cleanGoalStr))) {
      setCreateError("Please enter a valid positive goal amount (in tokens).");
      return;
    }
    const goalTokens = parseFloat(cleanGoalStr);
    if (goalTokens <= 0) {
      setCreateError("Funding goal must be greater than 0.");
      return;
    }
    const goalSmallest = BigInt(Math.floor(goalTokens * 10_000_000));

    const input: CreateProjectInput = {
      ...createInput,
      goal: goalSmallest,
      currencyType:
        createCurrencyType === "USDC"
          ? CurrencyType.USDC
          : createCurrencyType === "USDT"
            ? CurrencyType.USDT
            : createCurrencyType === "WBTC"
              ? CurrencyType.WBTC
              : createCurrencyType === "WETH"
                ? CurrencyType.WETH
                : CurrencyType.XLM,
      funding_deadline:
        createInput.funding_deadline > BigInt(0)
          ? createInput.funding_deadline
          : toDeadlineFromPreset(deadlinePreset),
    };

    setIsCreatePending(true);
    try {
      const result = await createProject({ input });
      setCreateResult("Project created successfully.");
      triggerToast({
        title: "Project Created",
        description: `"${input.title}" has been successfully registered on the Stellar blockchain.`,
      });
      console.log("createProject result:", result);

      let targetUid = user?.uid;
      if (!targetUid && freighterWalletAddress) {
        try {
          const uRes = await fetch(
            `/api/user-by-address?field=stellarPublicKey&address=${freighterWalletAddress}`,
          );
          const uData = uRes.ok ? await uRes.json() : null;
          targetUid = uData?.uid;
        } catch (e) {
          console.error("Failed to look up user address:", e);
        }
      }
      if (targetUid) {
        await createNotification(
          targetUid,
          "Project Listing Registered",
          `Your project listing "${input.title}" has been successfully registered on the Stellar blockchain and is awaiting admin review.`,
          null,
          result ? result.toString() : null,
        );
      }

      await refreshProjectData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCreateError(message);
      triggerToast({
        title: "Project Creation Failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsCreatePending(false);
    }
  };

  const handleFundProject = async () => {
    setFundError(null);
    setFundResult(null);

    if (!fundProjectId) {
      setFundError("Please select an approved project to fund.");
      return;
    }

    if (!selectedFundProject) {
      setFundError("Please select an approved project to fund.");
      return;
    }

    // Amount validations
    const cleanAmountStr = fundAmount.trim();
    if (!cleanAmountStr || isNaN(parseFloat(cleanAmountStr))) {
      setFundError("Please enter a valid positive token amount.");
      return;
    }
    const parsedTokens = parseFloat(cleanAmountStr);
    if (parsedTokens <= 0) {
      setFundError("Amount must be greater than 0.");
      return;
    }
    const parsedAmount = BigInt(Math.floor(parsedTokens * 10_000_000));

    // Status validations
    if (selectedFundProject.status !== ProjectStatus.Approved) {
      const currentStatusLabel =
        STATUS_LABELS[selectedFundProject.status as number] ??
        `Status ${selectedFundProject.status}`;
      setFundError(
        `This project cannot be funded. Current status: "${currentStatusLabel}". Only "Approved" projects can be funded.`,
      );
      return;
    }

    // Deadline validations
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (nowSec > selectedFundProject.funding_deadline) {
      setFundError("Funding deadline for this project has passed.");
      return;
    }

    // Wallet balance validations
    const targetAssetCode =
      selectedFundProject.currency_type === CurrencyType.XLM
        ? "native"
        : CurrencyType[selectedFundProject.currency_type];

    const targetBalanceObj = balances.find((b) =>
      targetAssetCode === "native"
        ? b.asset_type === "native"
        : b.asset_code === targetAssetCode,
    );

    const userBalance = targetBalanceObj
      ? parseFloat(targetBalanceObj.balance)
      : 0;
    const userBalanceSmallest = BigInt(Math.floor(userBalance * 10_000_000));

    if (parsedAmount > userBalanceSmallest) {
      const currencySymbol = CurrencyType[selectedFundProject.currency_type];
      setFundError(
        `Insufficient funds. You have ${userBalance} ${currencySymbol}, but tried to fund ${parsedTokens} ${currencySymbol} (Stroops: ${parsedAmount.toString()}).`,
      );
      return;
    }

    setIsFundPending(true);
    try {
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
      const publicKey = freighterWalletAddress || process.env.NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS || "";
      
      const factoryClient = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: "Test SDF Network ; September 2015",
        publicKey,
      });
      
      const vaultTx = await factoryClient.get_vault({ project_id: selectedFundProject.id });
      const vaultRes = await vaultTx.simulate();
      const vaultAddress = vaultRes.result;
      
      if (!vaultAddress) {
        throw new Error("Could not resolve vault address for the project.");
      }

      const result = await fundProject({
        vaultAddress,
        amount: parsedAmount,
      });

      const txStatus = (result as any)?.getTransactionResponse?.status;
      if (txStatus !== "SUCCESS") {
        throw new Error("Funding transaction failed on-chain.");
      }

      setFundResult("Project funded successfully.");
      triggerToast({
        title: "Contribution Successful",
        description: `Successfully contributed ${parsedTokens} ${CurrencyType[selectedFundProject.currency_type]} to project #${fundProjectId}.`,
      });
      console.log("fundProject result:", result);

      // MINTED SBT RECEIPT & NOTIFICATION SYNC
      const txHash = (result as any)?.sendTransactionResponse?.hash;
      const txUrl = txHash
        ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
        : null;

      let backerUid = user?.uid;
      if (!backerUid && freighterWalletAddress) {
        try {
          const res = await fetch(
            `/api/user-by-address?field=stellarPublicKey&address=${freighterWalletAddress}`,
          );
          const data = res.ok ? await res.json() : null;
          backerUid = data?.uid;
        } catch (e) {
          console.error("Failed to lookup backer profile:", e);
        }
      }

      let creatorUid = null;
      if (selectedFundProject.creator) {
        try {
          const res = await fetch(
            `/api/user-by-address?field=stellarPublicKey&address=${selectedFundProject.creator}`,
          );
          const data = res.ok ? await res.json() : null;
          creatorUid = data?.uid;
        } catch (e) {
          console.error("Failed to lookup creator profile:", e);
        }
      }

      if (backerUid) {
        await createNotification(
          backerUid,
          "Contribution Successful!",
          `Successfully contributed ${parsedTokens} ${CurrencyType[selectedFundProject.currency_type]} to campaign "${selectedFundProject.title}". Your Fund Receipt SBT has been minted on-chain.`,
          txUrl,
          fundProjectId,
        );
      }

      if (creatorUid) {
        await createNotification(
          creatorUid,
          "Campaign Received Funding!",
          `A backer contributed ${parsedTokens} ${CurrencyType[selectedFundProject.currency_type]} to your campaign "${selectedFundProject.title}".`,
          txUrl,
          fundProjectId,
        );
      }

      // Fetch the newly minted receipt details
      if (freighterWalletAddress) {
        try {
          const list = await getUserFunds(freighterWalletAddress);
          if (list.length > 0) {
            const sorted = list
              .slice()
              .sort((a: FundReceipt, b: FundReceipt) => Number(BigInt(b.fund_id) - BigInt(a.fund_id)));
            setNewlyMintedReceipt(sorted[0]);
          }
        } catch (e) {
          console.error("Failed to fetch newly minted receipt:", e);
        }
      }

      await refreshProjectData();
      await refreshUserReceipts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFundError(message);
      triggerToast({
        title: "Contribution Failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsFundPending(false);
    }
  };

  const handleRefundSBT = async (projectId: bigint) => {
    setIsRefundPending((prev) => ({ ...prev, [projectId.toString()]: true }));
    try {
      const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
      const FACTORY_ID = process.env.NEXT_PUBLIC_BLKFNDR_FACTORY_CONTRACT_ID || "";
      const publicKey = freighterWalletAddress || process.env.NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS || "";
      
      const factoryClient = new FactoryClient({
        contractId: FACTORY_ID,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: "Test SDF Network ; September 2015",
        publicKey,
      });
      
      const vaultTx = await factoryClient.get_vault({ project_id: projectId });
      const vaultRes = await vaultTx.simulate();
      const vaultAddress = vaultRes.result;
      
      if (!vaultAddress) {
        throw new Error("Could not resolve vault address for the project.");
      }

      const result = await refundContributor({
        vaultAddress,
        investor: freighterWalletAddress,
      });

      const txStatus = (result as any)?.getTransactionResponse?.status;
      if (txStatus !== "SUCCESS") {
        throw new Error("Refund transaction failed on-chain.");
      }

      triggerToast({
        title: "Refund Successful",
        description: `Successfully requested refund for project #${projectId}. Your SBT receipt has been burned.`,
      });

      const txHash = (result as any)?.sendTransactionResponse?.hash;
      const txUrl = txHash
        ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
        : null;

      let targetUid = user?.uid;
      if (!targetUid && freighterWalletAddress) {
        try {
          const uRes = await fetch(
            `/api/user-by-address?field=stellarPublicKey&address=${freighterWalletAddress}`,
          );
          const uData = uRes.ok ? await uRes.json() : null;
          targetUid = uData?.uid;
        } catch (e) {
          console.error("Failed to lookup user address:", e);
        }
      }

      if (targetUid) {
        await createNotification(
          targetUid,
          "Refund Completed & SBT Burned",
          `Successfully processed refund for project #${projectId}. Your corresponding Fund Receipt SBT has been burned.`,
          txUrl,
          projectId.toString(),
        );
      }

      await refreshProjectData();
      await refreshUserReceipts();
      await refreshWalletActivity();
    } catch (error) {
      console.error("Refund failed:", error);
      triggerToast({
        title: "Refund Failed",
        description: error instanceof Error ? error.message : String(error),
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsRefundPending((prev) => ({
        ...prev,
        [projectId.toString()]: false,
      }));
    }
  };

  const handleInitiateClaimRequest = async (projectId: bigint) => {
    setClaimError(null);
    setClaimResult(null);
    setIsClaimPending(true);
    try {
      // Persist claim requested status in MongoDB for visual representation
      await createClaimRequest(
        projectId.toString(),
        freighterWalletAddress ?? process.env.NEXT_PUBLIC_STELLAR_FALLBACK_ADDRESS ?? ""
      );

      setClaimResult("Claim request successfully initiated.");
      triggerToast({
        title: "Claim Request Initiated",
        description: `Your request to claim funds for campaign #${projectId} has been submitted to platform administrators.`,
      });

      // Notify the Platform Administrator
      if (platformData?.admin) {
        try {
          const uRes = await fetch(
            `/api/user-by-address?field=stellarPublicKey&address=${platformData.admin}`,
          );
          const uData = uRes.ok ? await uRes.json() : null;
          if (uData?.uid) {
            await createNotification(
              uData.uid,
              "New Claim Request",
              `The creator of Campaign #${projectId} has initiated a claim request. Please review the campaign and propose a multi-signature withdrawal.`,
              null,
              projectId.toString(),
            );
          }
        } catch (e) {
          console.error("Failed to notify platform admin:", e);
        }
      }

      await refreshProjectData();
    } catch (error) {
      console.error("Failed to initiate claim:", error);
      const message = error instanceof Error ? error.message : String(error);
      setClaimError(message);
      triggerToast({
        title: "Submission Failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsClaimPending(false);
    }
  };

  // Helper calculations for visual transaction cost and live USD previews
  const feePercentageBps = platformData
    ? Number(platformData.fee_percentage)
    : 300;
  const feePercentageDecimal = feePercentageBps / 10000;
  const fundAmountTokens = parseFloat(fundAmount) || 0;
  const platformFeeTokens = fundAmountTokens * feePercentageDecimal;
  const netReceivedTokens = fundAmountTokens - platformFeeTokens;
  const fundCurrencySymbol = selectedFundProject
    ? CurrencyType[selectedFundProject.currency_type]
    : "";

  const renderTargetAssetCode = selectedFundProject
    ? selectedFundProject.currency_type === CurrencyType.XLM
      ? "native"
      : CurrencyType[selectedFundProject.currency_type]
    : "";
  const renderUserBalanceObj = balances.find((b) =>
    renderTargetAssetCode === "native"
      ? b.asset_type === "native"
      : b.asset_code === renderTargetAssetCode,
  );
  const renderuserBalance = renderUserBalanceObj
    ? parseFloat(renderUserBalanceObj.balance)
    : 0;
  const renderIsBalanceSufficient = renderuserBalance >= fundAmountTokens;
  const selectedProjectImageSrc = selectedProject?.blob_id
    ? getIPFSGatewayUrl(selectedProject.blob_id)
    : PROJECT_PLACEHOLDER_IMAGE;
  const selectedProjectHasImage = !!selectedProject?.blob_id;
  const isLaunchCampaignDisabled =
    isCreatePending ||
    isCreateImageUploading ||
    !createInput.title.trim() ||
    !createInput.tagline.trim() ||
    !createInput.description.trim() ||
    !createGoalStr.trim() ||
    Number.isNaN(Number(createGoalStr)) ||
    Number(createGoalStr) <= 0 ||
    !createInput.blob_id.trim();

  return (
    <div className="container mx-auto max-w-3xl space-y-8 py-10">
      <div className="space-y-2">
        <TextPressure
          text="BLKFNDR"
          minFontSize={24}
          stroke={true}
          strokeWidth={1}
          textColor="orange"
          strokeColor="white"
        />
        <p className="text-sm text-muted-foreground text-center break-all">
          Freighter:{" "}
          <span
            className="font-mono text-xs sm:text-sm"
            title={freighterWalletAddress ?? "not connected"}
          >
            {shortenAddress(freighterWalletAddress, 8, 8)}
          </span>
        </p>
      </div>

      {newlyMintedReceipt &&
        (() => {
          const receiptProject = projects.find(
            (p) => p.id.toString() === newlyMintedReceipt.project_id.toString(),
          );
          const currencySymbol = receiptProject
            ? CurrencyType[receiptProject.currency_type]
            : "XLM";
          return (
            <div className="relative overflow-hidden rounded-2xl border border-emerald-500/35 bg-[#003049]/95 text-[#F0F4F7] p-6 shadow-[0_0_50px_rgba(16,185,129,0.25)] backdrop-blur-xl animate-in zoom-in-95 fade-in duration-300 space-y-6">
              <div className="flex items-start justify-between border-b border-[#F0F4F7]/10 pb-4">
                <div className="flex gap-4 items-center">
                  <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-400 border border-emerald-500/30 animate-pulse">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-headline text-emerald-400 flex items-center gap-2">
                      Soulbound Token Minted!
                    </h3>
                    <p className="text-xs text-[#F0F4F7]/80">
                      Your cryptographic proof-of-funding has been secured on
                      the Stellar blockchain.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setNewlyMintedReceipt(null)}
                  className="text-[#F0F4F7]/60 hover:text-[#F0F4F7] transition-colors rounded-lg hover:bg-[#F0F4F7]/10 p-1.5"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>

              <div className="flex flex-col md:flex-row gap-6 items-center">
                {/* Visual Cryptographic SBT Card */}
                <div className="relative w-full max-w-sm h-52 rounded-2xl bg-gradient-to-br from-[#003049] via-[#002030] to-[#0d1b2a] border border-[#F0F4F7]/15 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.4)] flex flex-col justify-between overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#D62828]/10 rounded-full blur-2xl group-hover:bg-[#D62828]/20 transition-all duration-700"></div>
                  <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl"></div>

                  <div className="flex justify-between items-start z-10">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold tracking-widest text-[#D62828] uppercase">
                        BLKFNDR SECURITY
                      </span>
                      <h4 className="text-base font-bold font-headline leading-tight">
                        FUND RECEIPT SBT
                      </h4>
                    </div>
                    <div className="rounded-lg bg-[#F0F4F7]/10 border border-[#F0F4F7]/20 p-2 text-emerald-400">
                      <Lock className="h-5 w-5 animate-pulse" />
                    </div>
                  </div>

                  <div className="my-2 z-10">
                    <div className="text-2xl font-mono font-bold tracking-tight text-[#F0F4F7] flex items-baseline gap-1.5">
                      {formatStroopsToTokens(BigInt(newlyMintedReceipt.amount))}
                      <span className="text-xs text-muted-foreground font-sans">
                        {currencySymbol}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#F0F4F7]/60 mt-0.5 flex items-center gap-1.5">
                      <span>Fund Amount</span>
                      <span className="text-[#F0F4F7]/40 font-mono">
                        (
                        {getUsdValueString(
                          BigInt(newlyMintedReceipt.amount),
                          currencySymbol,
                        )}
                        )
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-end border-t border-[#F0F4F7]/10 pt-3 z-10 text-[10px] font-mono">
                    <div>
                      <span className="text-[#F0F4F7]/50 block uppercase text-[8px] tracking-wider">
                        SBT Token ID
                      </span>
                      <span className="text-emerald-400 font-bold">
                        #SBT-{newlyMintedReceipt.fund_id}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-[#F0F4F7]/50 block uppercase text-[8px] tracking-wider">
                        Share Allocation
                      </span>
                      <span className="text-[#F0F4F7] font-bold">
                        {(
                          Number(newlyMintedReceipt.share_percentage) / 100
                        ).toFixed(2)}
                        %
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[#F0F4F7]/50 block uppercase text-[8px] tracking-wider">
                        Campaign ID
                      </span>
                      <span className="text-[#F0F4F7] font-bold">
                        #{newlyMintedReceipt.project_id}
                      </span>
                    </div>
                  </div>
                </div>

                {/* SBT details & explanation */}
                <div className="flex-1 space-y-4 text-sm leading-relaxed text-[#F0F4F7]/90">
                  <p>
                    This cryptographic token is completely **Soulbound
                    (non-transferable)**. It serves as your permanent key to
                    track and verify your capital contribution to campaign **#
                    {newlyMintedReceipt.project_id}**.
                  </p>
                  <div className="bg-black/35 rounded-xl border border-[#F0F4F7]/10 p-4 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#F0F4F7]/50">
                        Contributor Account:
                      </span>
                      <span className="font-mono text-[#F0F4F7]">
                        {shortenAddress(newlyMintedReceipt.contributor, 12, 12)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#F0F4F7]/50">Total Fee Paid:</span>
                      <span className="font-mono text-amber-500 font-semibold">
                        {formatStroopsToTokens(BigInt(newlyMintedReceipt.fee_paid))}{" "}
                        {currencySymbol}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#F0F4F7]/50">Timestamp Sec:</span>
                      <span className="font-mono">
                        {newlyMintedReceipt.fund_date.toString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setNewlyMintedReceipt(null)}
                    className="w-full sm:w-auto px-6 py-2.5 bg-[#D62828] hover:bg-[#b52020] text-[#F0F4F7] text-xs font-bold rounded-lg transition duration-200 uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(214,40,40,0.3)]"
                  >
                    <Check className="h-4 w-4" />
                    Acknowledge & Close
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="explorer">Project Explorer</TabsTrigger>
          <TabsTrigger value="create">Create</TabsTrigger>
          <TabsTrigger value="fund">Fund</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="activity">Account Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="explorer">
          <section className="space-y-4 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Coins className="h-5 w-5 text-orange-500 animate-pulse" />
                  Stellar Project Explorer
                </h2>
                <p className="text-xs text-muted-foreground">
                  Browse active and approved crowdfunding campaigns on the
                  Stellar Network.
                </p>
              </div>
              <button
                className="flex items-center justify-center gap-1.5 rounded-lg border bg-background/50 hover:bg-background px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-50"
                onClick={() => refreshProjectData()}
                disabled={projectsLoading}
              >
                {projectsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
                {projectsLoading ? "Refreshing..." : "Refresh Projects"}
              </button>
            </div>

            {projectsError && (
              <div className="pt-2">
                <VisualErrorCard
                  error={projectsError}
                  onRetry={refreshProjectData}
                  title="Failed to load projects"
                />
              </div>
            )}

            {projectsLoading ? (
              <div className="space-y-6 pt-2 animate-pulse">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-xl border border-muted bg-card/60 p-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="h-3 w-16 bg-muted rounded"></div>
                      <div className="h-5 w-12 bg-muted rounded-full"></div>
                    </div>
                    <div className="h-4 w-3/4 bg-muted rounded"></div>
                    <div className="h-3 w-1/2 bg-muted rounded"></div>
                    <div className="h-1.5 w-full bg-muted rounded-full"></div>
                  </div>
                  <div className="hidden sm:block rounded-xl border border-muted bg-card/60 p-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="h-3 w-16 bg-muted rounded"></div>
                      <div className="h-5 w-12 bg-muted rounded-full"></div>
                    </div>
                    <div className="h-4 w-3/4 bg-muted rounded"></div>
                    <div className="h-3 w-1/2 bg-muted rounded"></div>
                    <div className="h-1.5 w-full bg-muted rounded-full"></div>
                  </div>
                  <div className="hidden xl:block rounded-xl border border-muted bg-card/60 p-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="h-3 w-16 bg-muted rounded"></div>
                      <div className="h-5 w-12 bg-muted rounded-full"></div>
                    </div>
                    <div className="h-4 w-3/4 bg-muted rounded"></div>
                    <div className="h-3 w-1/2 bg-muted rounded"></div>
                    <div className="h-1.5 w-full bg-muted rounded-full"></div>
                  </div>
                </div>
                <div className="rounded-xl border border-muted bg-card/60 p-6 space-y-6">
                  <div className="space-y-2">
                    <div className="flex gap-2 items-center">
                      <div className="h-6 w-1/3 bg-muted rounded"></div>
                      <div className="h-5 w-12 bg-muted rounded-full"></div>
                    </div>
                    <div className="h-4 w-2/3 bg-muted rounded"></div>
                  </div>
                  <div className="rounded-lg border p-4 space-y-4">
                    <div className="h-2.5 w-full bg-muted rounded-full"></div>
                  </div>
                </div>
              </div>
            ) : projects.length > 0 ? (
              <>
                <Carousel
                  opts={{ align: "start", loop: false }}
                  className="w-full py-2"
                >
                  <CarouselContent className="-ml-2">
                    {projects.map((project) => {
                      const id = project.id.toString();
                      const active = selectedProjectId === id;

                      return (
                        <CarouselItem
                          key={id}
                          className="pl-2 sm:basis-1/2 xl:basis-1/3"
                        >
                          <button
                            className={`w-full rounded-xl border p-4 text-left transition duration-200 hover:scale-[1.01] hover:shadow-md ${active ? "border-primary bg-muted shadow-sm" : "bg-card/30 border-muted hover:border-primary/30"}`}
                            onClick={() => {
                              setSelectedProjectId(id);
                            }}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">
                                Project #{id}
                              </p>
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${getStatusToneClass(project.status as number)}`}
                              >
                                {STATUS_LABELS[project.status as number] ??
                                  `Status ${project.status}`}
                              </span>
                            </div>
                            <p className="line-clamp-1 text-sm font-bold text-card-foreground">
                              {project.title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Raised{" "}
                              {formatStroopsToTokens(project.raised_amount)} /{" "}
                              {formatStroopsToTokens(project.goal)}{" "}
                              {CurrencyType[project.currency_type]}
                            </p>
                            <div className="mt-3 h-1.5 w-full rounded-full bg-muted-foreground/10">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-500"
                                style={{
                                  width: `${getProgressPercent(project.raised_amount, project.goal)}%`,
                                }}
                              />
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground/75">
                              <span>Estimated Value:</span>
                              <span className="font-mono">
                                {getUsdValueString(
                                  project.raised_amount,
                                  CurrencyType[project.currency_type],
                                )}
                              </span>
                            </div>
                          </button>
                        </CarouselItem>
                      );
                    })}
                  </CarouselContent>
                  <CarouselPrevious className="-left-3" />
                  <CarouselNext className="-right-3" />
                </Carousel>

                {selectedProject && (
                  <div className="rounded-xl border border-muted bg-card/60 p-5 text-sm space-y-5 shadow-sm animate-in fade-in duration-300">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Project image
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Click a project above to view its uploaded image
                            here.
                          </p>
                        </div>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                          {selectedProjectHasImage
                            ? "Uploaded image"
                            : "Placeholder"}
                        </span>
                      </div>
                      <div className="overflow-hidden rounded-xl border bg-background/40">
                        <div className="relative aspect-[16/9] w-full">
                          <ImageWithFallback
                            src={selectedProjectImageSrc}
                            alt={selectedProject.title}
                            className="h-full w-full object-cover"
                            fill
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-foreground">
                          {selectedProject.title}
                        </h3>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusToneClass(selectedProject.status as number)}`}
                        >
                          {STATUS_LABELS[selectedProject.status as number] ??
                            `Status ${selectedProject.status}`}
                        </span>
                        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                          {selectedProject.category}
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed text-sm">
                        {selectedProject.tagline}
                      </p>
                    </div>

                    <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 space-y-3 shadow-[0_0_15px_-5px_rgba(249,115,22,0.05)]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-semibold uppercase tracking-wider">
                          Funding Progress
                        </span>
                        <span className="font-mono font-bold text-primary text-sm">
                          {getProgressPercent(
                            selectedProject.raised_amount,
                            selectedProject.goal,
                          ).toFixed(2)}
                          %
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-muted-foreground/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-500"
                          style={{
                            width: `${getProgressPercent(selectedProject.raised_amount, selectedProject.goal)}%`,
                          }}
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 text-sm pt-1">
                        <div className="flex justify-between sm:justify-start sm:gap-2">
                          <span className="text-muted-foreground">Raised:</span>
                          <span className="font-bold text-foreground">
                            {formatStroopsToTokens(
                              selectedProject.raised_amount,
                            )}{" "}
                            {CurrencyType[selectedProject.currency_type]}
                            <span className="text-xs text-muted-foreground font-normal ml-1.5 font-mono">
                              (
                              {getUsdValueString(
                                selectedProject.raised_amount,
                                CurrencyType[selectedProject.currency_type],
                              )}
                              )
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between sm:justify-start sm:gap-2">
                          <span className="text-muted-foreground">Goal:</span>
                          <span className="font-bold text-foreground">
                            {formatStroopsToTokens(selectedProject.goal)}{" "}
                            {CurrencyType[selectedProject.currency_type]}
                            <span className="text-xs text-muted-foreground font-normal ml-1.5 font-mono">
                              (
                              {getUsdValueString(
                                selectedProject.goal,
                                CurrencyType[selectedProject.currency_type],
                              )}
                              )
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 text-sm bg-muted/20 border border-muted/50 rounded-xl p-4">
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">
                          Creator Wallet
                        </span>{" "}
                        <span
                          className="font-mono text-xs text-foreground bg-muted/60 rounded px-2 py-1 select-all"
                          title={selectedProject.creator}
                        >
                          {shortenAddress(selectedProject.creator, 10, 10)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-0.5">
                          Campaign ID
                        </span>{" "}
                        <span className="font-bold text-foreground bg-muted/60 rounded px-2.5 py-0.5 text-xs font-mono">
                          #{selectedProject.id.toString()}
                        </span>
                      </div>
                      <div className="sm:col-span-2 border-t pt-2 mt-1 border-muted/40">
                        <span className="text-muted-foreground text-xs block mb-0.5">
                          Deadline & Status
                        </span>{" "}
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-orange-500 flex-shrink-0" />
                          {formatDeadline(selectedProject.funding_deadline)}
                        </span>
                      </div>
                      <div className="sm:col-span-2 border-t pt-2 border-muted/40">
                        <span className="text-muted-foreground text-xs block mb-0.5">
                          Project Overview
                        </span>{" "}
                        <p className="text-foreground/90 leading-relaxed text-sm whitespace-pre-line bg-background/50 border rounded-lg p-3 mt-1 font-sans">
                          {selectedProject.description}
                        </p>
                      </div>

                      {selectedProject.creator ===
                        freighterWalletAddress && (
                        <div className="sm:col-span-2 border-t pt-3 mt-2 border-muted/40 space-y-3">
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                            Campaign Creator Console
                          </span>

                          {selectedProject.status === ProjectStatus.Funded ? (
                            <div className="rounded-xl border border-orange-500/25 bg-orange-500/5 p-4 space-y-3">
                              <p className="text-xs text-foreground/90 leading-relaxed">
                                Your campaign has reached its funding target!
                                Initiate a claim request to transfer your net
                                raised funds of{" "}
                                <strong className="text-orange-500">
                                  {formatStroopsToTokens(
                                    selectedProject.raised_amount,
                                  )}{" "}
                                  {CurrencyType[selectedProject.currency_type]}
                                </strong>{" "}
                                directly to your connected wallet.
                              </p>

                              {typeof window !== "undefined" &&
                              localStorage.getItem(
                                `blkfndr_claim_requested_${selectedProject.id}`,
                              ) === "true" ? (
                                <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
                                  <p className="text-xs text-orange-400 font-semibold flex items-center gap-1.5 leading-relaxed">
                                    <Clock className="h-4 w-4 animate-pulse flex-shrink-0" />
                                    Claim request initiated. Pending
                                    multi‑signature withdrawal proposal from
                                    platform administrators.
                                  </p>
                                </div>
                              ) : (
                                <button
                                  className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[#D62828] text-white hover:opacity-95 px-4 py-2.5 text-xs font-semibold shadow transition disabled:opacity-50"
                                  onClick={() =>
                                    handleInitiateClaimRequest(
                                      selectedProject.id,
                                    )
                                  }
                                  disabled={isClaimPending}
                                >
                                  {isClaimPending ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  )}
                                  Initiate Claim Request
                                </button>
                              )}
                            </div>
                          ) : selectedProject.status ===
                            ProjectStatus.Completed ? (
                            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                              <p className="text-xs text-emerald-600 flex items-center gap-1.5 font-semibold">
                                <CheckCircle2 className="h-4 w-4" />
                                Campaign completed. All raised funds have been
                                successfully claimed.
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-muted bg-muted/20 p-4">
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                Campaign is currently active. Once the funding
                                goal of{" "}
                                <strong>
                                  {formatStroopsToTokens(selectedProject.goal)}{" "}
                                  {CurrencyType[selectedProject.currency_type]}
                                </strong>{" "}
                                is reached, the fund claiming button will be
                                unlocked here.
                              </p>
                            </div>
                          )}

                          {claimError && (
                            <VisualErrorCard
                              error={claimError}
                              title="Fund Claiming Failed"
                            />
                          )}

                          {claimResult && (
                            <VisualSuccessCard
                              message={claimResult}
                              title="Claim Successful"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/10 border border-dashed rounded-xl">
                <AlertCircle className="h-10 w-10 text-muted-foreground/60 mb-2" />
                <p className="text-sm font-semibold text-muted-foreground">
                  No campaigns registered yet.
                </p>
                <p className="text-xs text-muted-foreground/80 max-w-sm mt-1">
                  Connect your wallet, configure/initialize the platform
                  details, and launch a new campaign to begin.
                </p>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="create">
          <section className="space-y-4 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Coins className="h-5 w-5 text-orange-500" />
                Launch a New Campaign
              </h2>
              <p className="text-xs text-muted-foreground">
                Register your crowdfunding campaign on the Stellar blockchain.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground font-semibold">
                  Title
                </span>
                <input
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                  placeholder="Project title"
                  value={createInput.title}
                  disabled={isCreatePending}
                  onChange={(event) =>
                    setCreateInput((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground font-semibold">
                  Tagline
                </span>
                <input
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                  placeholder="Short tagline"
                  value={createInput.tagline}
                  disabled={isCreatePending}
                  onChange={(event) =>
                    setCreateInput((prev) => ({
                      ...prev,
                      tagline: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground font-semibold">
                  Category
                </span>
                <select
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                  value={createInput.category}
                  disabled={isCreatePending}
                  onChange={(event) =>
                    setCreateInput((prev) => ({
                      ...prev,
                      category: event.target.value,
                    }))
                  }
                >
                  {CATEGORY_OPTIONS.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground font-semibold">
                  Currency
                </span>
                <select
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                  value={createCurrencyType}
                  disabled={isCreatePending}
                  onChange={(event) => {
                    const nextCurrency = event.target.value as
                      | "XLM"
                      | "USDC"
                      | "USDT"
                      | "WBTC"
                      | "WETH";
                    setCreateCurrencyType(nextCurrency);
                    setRegisterCurrencyType(nextCurrency);
                    setRegisterTokenAddress(
                      nextCurrency === "XLM"
                        ? XLM_TOKEN_PRESET
                        : nextCurrency === "USDC"
                          ? USDC_TOKEN_PRESET
                          : nextCurrency === "USDT"
                            ? USDT_TOKEN_PRESET
                            : nextCurrency === "WBTC"
                              ? WBTC_TOKEN_PRESET
                              : WETH_TOKEN_PRESET,
                    );
                    setCreateInput((prev) => ({
                      ...prev,
                      currencyType:
                        nextCurrency === "USDC"
                          ? CurrencyType.USDC
                          : nextCurrency === "USDT"
                            ? CurrencyType.USDT
                            : nextCurrency === "WBTC"
                              ? CurrencyType.WBTC
                              : nextCurrency === "WETH"
                                ? CurrencyType.WETH
                                : CurrencyType.XLM,
                    }));
                  }}
                >
                  <option value="XLM">XLM</option>
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                  <option value="WBTC">WBTC</option>
                  <option value="WETH">WETH</option>
                </select>
              </label>
              <div className="sm:col-span-2 space-y-2 rounded-xl border border-dashed border-muted bg-muted/15 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Project image
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Upload one image for the project. We store the file on
                      Pinata and keep the link behind the scenes.
                    </p>
                  </div>
                  {createInput.blob_id && (
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                      Image attached
                    </span>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <input
                    id="stellar-create-project-image"
                    type="file"
                    accept="image/*"
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground file:font-semibold hover:file:opacity-90"
                    disabled={isCreatePending || isCreateImageUploading}
                    onChange={handleCreateImageChange}
                  />
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:opacity-90 disabled:opacity-50"
                    disabled={
                      isCreatePending ||
                      isCreateImageUploading ||
                      !createImageName
                    }
                    onClick={handleCreateImageUpload}
                  >
                    {isCreateImageUploading ? "Uploading..." : "Upload image"}
                  </button>
                </div>

                {createImageName && (
                  <p className="text-xs text-muted-foreground">
                    Selected file: {createImageName}
                  </p>
                )}

                {(createImagePreview || createInput.blob_id) && (
                  <div className="overflow-hidden rounded-lg border bg-background/50">
                    <div className="relative aspect-[16/9] w-full">
                      <ImageWithFallback
                        src={
                          createImagePreview ||
                          getIPFSGatewayUrl(createInput.blob_id)
                        }
                        alt="Project image preview"
                        className="h-full w-full object-cover"
                        fill
                      />
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground">
                  If you skip this, the project will still create, but it will
                  use the placeholder image in the explorer until you add one.
                </p>
              </div>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground font-semibold">
                  Funding window
                </span>
                <select
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                  value={deadlinePreset}
                  disabled={isCreatePending}
                  onChange={(event) => {
                    const preset = event.target.value;
                    setDeadlinePreset(preset);
                    setCreateInput((prev) => ({
                      ...prev,
                      funding_deadline: toDeadlineFromPreset(preset),
                    }));
                  }}
                >
                  {DEADLINE_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground font-semibold">
                  Goal (Tokens)
                </span>
                <input
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                  placeholder="e.g. 100"
                  value={createGoalStr}
                  disabled={isCreatePending}
                  onChange={(event) => setCreateGoalStr(event.target.value)}
                />
                {createGoalStr &&
                  !isNaN(parseFloat(createGoalStr)) &&
                  parseFloat(createGoalStr) > 0 && (
                    <div className="mt-2 rounded-xl bg-muted/30 border border-muted/50 p-4 text-xs space-y-1.5 text-card-foreground">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tokens:</span>
                        <span className="font-bold text-foreground">
                          {parseFloat(createGoalStr).toLocaleString()}{" "}
                          {createCurrencyType}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Stroops:</span>
                        <span className="font-mono text-amber-600 font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded">
                          {BigInt(
                            Math.floor(parseFloat(createGoalStr) * 10_000_000),
                          )
                            .toString()
                            .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}{" "}
                          units
                        </span>
                      </div>
                      <div className="flex justify-between border-t pt-2 mt-2 border-muted-foreground/10 text-emerald-600 font-bold text-sm">
                        <span>USD Value:</span>
                        <span>
                          $
                          {(
                            parseFloat(createGoalStr) *
                            (usdRates[createCurrencyType] || 0)
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          USD
                        </span>
                      </div>
                    </div>
                  )}
              </label>
              <label className="space-y-1.5 text-sm sm:col-span-2">
                <span className="text-muted-foreground font-semibold">
                  Description
                </span>
                <textarea
                  rows={3}
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition font-sans resize-none"
                  placeholder="Describe the campaign purpose and goals..."
                  value={createInput.description}
                  disabled={isCreatePending}
                  onChange={(event) =>
                    setCreateInput((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none py-1 w-fit">
                <input
                  type="checkbox"
                  className="rounded border-muted bg-background h-4 w-4 accent-primary disabled:opacity-50"
                  checked={createInput.is_public}
                  disabled={isCreatePending}
                  onChange={(event) =>
                    setCreateInput((prev) => ({
                      ...prev,
                      is_public: event.target.checked,
                    }))
                  }
                />
                <span className="text-foreground/90 font-medium">
                  Make campaign public and discoverable
                </span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground/80 bg-muted/20 border border-muted/50 rounded-lg p-3 leading-relaxed flex items-center gap-2">
              <Info className="h-4 w-4 text-orange-500 flex-shrink-0" />
              <span>
                Please ensure the funding currency token is registered in the
                smart contract. Unregistered tokens will fail smart contract
                validation.
              </span>
            </p>
            <div className="flex flex-col gap-3 pt-2">
              <button
                className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow transition duration-200 hover:opacity-90 disabled:opacity-50 w-full sm:w-fit"
                onClick={handleCreateProject}
                disabled={isLaunchCampaignDisabled}
              >
                {isCreatePending ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
                ) : (
                  <Coins className="h-4 w-4" />
                )}
                {isCreatePending
                  ? "Creating Campaign on Stellar..."
                  : "Launch Campaign"}
              </button>

              {createError && (
                <VisualErrorCard
                  error={createError}
                  title="Campaign Registration Failed"
                />
              )}
              {createResult && (
                <VisualSuccessCard
                  message={createResult}
                  title="Campaign Launched Successfully!"
                />
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="fund">
          <section className="space-y-4 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Coins className="h-5 w-5 text-orange-500 animate-pulse" />
                Back a Campaign
              </h2>
              <p className="text-xs text-muted-foreground">
                Support registered campaigns by contributing Stellar tokens
                directly.
              </p>
            </div>

            <p className="text-xs text-muted-foreground/80 bg-muted/20 border border-muted/50 rounded-lg p-3 leading-relaxed flex items-center gap-2">
              <Info className="h-4 w-4 text-orange-500 flex-shrink-0" />
              <span>
                Only campaigns approved by platform administrators can accept
                contributions. Unapproved or expired campaigns will fail smart
                contract validation.
              </span>
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground font-semibold">
                  Select Campaign
                </span>
                <select
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                  value={fundProjectId}
                  onChange={(event) => setFundProjectId(event.target.value)}
                  disabled={isFundPending || approvedProjects.length === 0}
                >
                  <option value="" disabled>
                    {approvedProjects.length > 0
                      ? "Choose approved project"
                      : "No approved projects available"}
                  </option>
                  {approvedProjects.map((project) => {
                    const id = project.id.toString();
                    return (
                      <option key={id} value={id}>
                        #{id} - {project.title} (
                        {STATUS_LABELS[project.status as number] ??
                          `Status ${project.status}`}
                        )
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground font-semibold">
                  Contribution Amount
                </span>
                <input
                  className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                  placeholder="e.g. 10"
                  value={fundAmount}
                  disabled={isFundPending}
                  onChange={(event) => setFundAmount(event.target.value)}
                />
              </label>
            </div>

            {selectedFundProject && fundAmountTokens > 0 && (
              <div className="mt-2 rounded-xl bg-muted/30 border border-muted/50 p-4 text-sm space-y-3.5 shadow-sm">
                <p className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                  Transaction Summary & Breakdown
                </p>
                <div className="space-y-2 text-sm text-card-foreground">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">
                      Project Contribution:
                    </span>
                    <span className="font-bold text-foreground">
                      {fundAmountTokens.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}{" "}
                      {fundCurrencySymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-amber-600 font-semibold">
                    <span className="text-muted-foreground font-medium">
                      Platform Fee ({(feePercentageDecimal * 100).toFixed(1)}%):
                    </span>
                    <span>
                      -
                      {platformFeeTokens.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}{" "}
                      {fundCurrencySymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-green-600 font-bold border-t border-muted-foreground/10 pt-2 text-sm">
                    <span>Net Campaign Receives:</span>
                    <span>
                      {netReceivedTokens.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}{" "}
                      {fundCurrencySymbol}
                    </span>
                  </div>
                  <div className="flex justify-between font-mono text-muted-foreground/70 text-[11px] border-t border-muted-foreground/10 pt-2">
                    <span>Contract Parameter (Stroops):</span>
                    <span>
                      {BigInt(Math.floor(fundAmountTokens * 10_000_000))
                        .toString()
                        .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}{" "}
                      units
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-emerald-600 text-sm border-t border-muted-foreground/10 pt-2">
                    <span>Estimated USD Value:</span>
                    <span>
                      $
                      {(
                        fundAmountTokens * (usdRates[fundCurrencySymbol] || 0)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      USD
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-muted-foreground/10 flex flex-wrap gap-x-4 gap-y-1.5 justify-between text-xs items-center">
                  <div className="text-muted-foreground font-medium">
                    Available Balance:{" "}
                    <span className="font-bold text-foreground">
                      {renderuserBalance.toLocaleString()} {fundCurrencySymbol}
                    </span>
                  </div>
                  <div>
                    {renderIsBalanceSufficient ? (
                      <span className="text-emerald-600 font-bold bg-emerald-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                        Sufficient Balance
                      </span>
                    ) : (
                      <span className="text-rose-500 font-bold bg-rose-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                        Insufficient Balance
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <button
                className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow transition duration-200 hover:opacity-90 disabled:opacity-50 w-full sm:w-fit"
                onClick={handleFundProject}
                disabled={
                  isFundPending ||
                  approvedProjects.length === 0 ||
                  !renderIsBalanceSufficient
                }
              >
                {isFundPending ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
                ) : (
                  <Coins className="h-4 w-4" />
                )}
                {isFundPending
                  ? "Processing Contribution on Stellar..."
                  : "Fund Campaign"}
              </button>

              {!selectedFundProject && approvedProjects.length > 0 && (
                <p className="text-xs text-muted-foreground/80 flex items-center gap-1">
                  <Info className="h-3.5 w-3.5 text-orange-400" />
                  Please select an approved campaign from the list to enable
                  backing options.
                </p>
              )}
              {approvedProjects.length === 0 && (
                <p className="text-xs text-rose-400 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
                  No approved crowdfunding campaigns are currently available for
                  backing.
                </p>
              )}

              {fundError && (
                <VisualErrorCard
                  error={fundError}
                  title="Contribution Failed"
                />
              )}
              {fundResult && (
                <VisualSuccessCard
                  message={fundResult}
                  title="Contribution Completed successfully!"
                />
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="receipts">
          <section className="space-y-4 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Lock className="h-5 w-5 text-[#D62828] animate-pulse" />
                  My Soulbound Tokens (SBTs)
                </h2>
                <p className="text-xs text-muted-foreground">
                  View and manage your non-transferable cryptographic fund
                  receipts.
                </p>
              </div>
              <button
                className="flex items-center justify-center gap-1.5 rounded-lg border bg-background/50 hover:bg-background px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-50"
                onClick={() => refreshUserReceipts()}
                disabled={receiptsLoading}
              >
                {receiptsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#D62828]" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
                {receiptsLoading ? "Refreshing..." : "Refresh Receipts"}
              </button>
            </div>

            {receiptsError && (
              <VisualErrorCard
                error={receiptsError}
                title="Failed to load SBT receipts"
                onRetry={refreshUserReceipts}
              />
            )}

            {receiptsLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 animate-pulse py-2">
                <div className="h-52 rounded-2xl border border-muted bg-card/60 p-4 space-y-4">
                  <div className="h-4 w-1/3 bg-muted rounded"></div>
                  <div className="h-8 w-2/3 bg-muted rounded"></div>
                  <div className="h-3 w-1/2 bg-muted rounded"></div>
                </div>
                <div className="h-52 rounded-2xl border border-muted bg-card/60 p-4 space-y-4">
                  <div className="h-4 w-1/3 bg-muted rounded"></div>
                  <div className="h-8 w-2/3 bg-muted rounded"></div>
                  <div className="h-3 w-1/2 bg-muted rounded"></div>
                </div>
              </div>
            ) : receipts.length > 0 ? (
              <div className="grid gap-6 sm:grid-cols-2 py-2">
                {receipts.map((receipt) => {
                  const receiptProject = projects.find(
                    (p) => p.id.toString() === receipt.project_id.toString(),
                  );
                  const isExpired = receiptProject
                    ? BigInt(Math.floor(Date.now() / 1000)) >
                        receiptProject.funding_deadline &&
                      receiptProject.raised_amount < receiptProject.goal
                    : false;

                  return (
                    <div
                      key={receipt.fund_id}
                      className="relative overflow-hidden rounded-2xl border border-muted bg-[#003049] text-[#F0F4F7] p-5 shadow-lg flex flex-col justify-between h-56 transition duration-300 hover:scale-[1.01] hover:shadow-xl group"
                    >
                      {/* Decorative elements */}
                      <div className="absolute top-0 right-0 w-24 h-24 bg-[#D62828]/10 rounded-full blur-2xl group-hover:bg-[#D62828]/25 transition-all duration-500"></div>

                      <div className="flex justify-between items-start z-10">
                        <div className="space-y-1">
                          <span className="text-[9px] font-bold tracking-widest text-[#D62828] uppercase">
                            {receiptProject?.title || "Campaign Receipt"}
                          </span>
                          <h4 className="text-sm font-bold font-headline truncate max-w-[180px]">
                            FUND RECEIPT SBT
                          </h4>
                        </div>
                        <div className="rounded-full bg-[#F0F4F7]/10 p-1.5 text-emerald-400 border border-[#F0F4F7]/10">
                          <Lock className="h-4 w-4" />
                        </div>
                      </div>

                      {(() => {
                        const receiptCurrencySymbol = receiptProject
                          ? CurrencyType[receiptProject.currency_type]
                          : "XLM";
                        return (
                          <div className="my-2 z-10">
                            <div className="text-xl font-mono font-bold tracking-tight">
                              {formatStroopsToTokens(BigInt(receipt.amount))}{" "}
                              <span className="text-[10px] text-muted-foreground ml-0.5">
                                {receiptCurrencySymbol}
                              </span>
                            </div>
                            <div className="text-[10px] text-[#F0F4F7]/60 flex items-center gap-1.5 mt-0.5">
                              <span>Contribution:</span>
                              <span className="text-[#F0F4F7]/45 font-mono text-[9px]">
                                (
                                {getUsdValueString(
                                  BigInt(receipt.amount),
                                  receiptCurrencySymbol,
                                )}
                                )
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="flex justify-between items-end border-t border-[#F0F4F7]/10 pt-3 z-10 text-[9px] font-mono">
                        <div>
                          <span className="text-[#F0F4F7]/50 block uppercase text-[7px] tracking-wider">
                            Token ID
                          </span>
                          <span className="text-emerald-400 font-bold">
                            #SBT-{receipt.fund_id}
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="text-[#F0F4F7]/50 block uppercase text-[7px] tracking-wider">
                            Share
                          </span>
                          <span className="text-[#F0F4F7] font-bold">
                            {(Number(receipt.share_percentage) / 100).toFixed(
                              2,
                            )}
                            %
                          </span>
                        </div>
                        <div className="text-right">
                          {isExpired ? (
                            <button
                              onClick={() =>
                                handleRefundSBT(BigInt(receipt.project_id))
                              }
                              disabled={
                                isRefundPending[receipt.project_id]
                              }
                              className="px-2 py-1 bg-[#D62828] hover:bg-[#b52020] text-white rounded text-[8px] font-bold transition flex items-center gap-1 shadow-sm disabled:opacity-50"
                            >
                              {isRefundPending[
                                receipt.project_id
                              ] ? (
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              ) : (
                                <RotateCw className="h-2.5 w-2.5" />
                              )}
                              Refund & Burn
                            </button>
                          ) : (
                            <div>
                              <span className="text-[#F0F4F7]/50 block uppercase text-[7px] tracking-wider">
                                Campaign
                              </span>
                              <span className="text-[#F0F4F7] font-bold">
                                #{receipt.project_id}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/10 border border-dashed rounded-xl">
                <Lock className="h-10 w-10 text-muted-foreground/60 mb-2" />
                <p className="text-xs font-semibold text-muted-foreground">
                  No SBT receipts minted yet.
                </p>
                <p className="text-[11px] text-muted-foreground/80 max-w-sm mt-1">
                  Once you fund a campaign, your permanent cryptographic
                  proof-of-funding SBT will be minted and displayed here.
                </p>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="activity">
          <section className="space-y-4 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-orange-500" />
                  Account & Wallet Activity
                </h2>
                <p className="text-xs text-muted-foreground">
                  Monitor balances and recent operations for your connected
                  Freighter wallet.
                </p>
              </div>
              <button
                className="flex items-center justify-center gap-1.5 rounded-lg border bg-background/50 hover:bg-background px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-50"
                onClick={() => refreshWalletActivity()}
                disabled={activityLoading}
              >
                {activityLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
                {activityLoading ? "Refreshing..." : "Refresh Activity"}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-sm bg-muted/20 border border-muted/50 rounded-xl p-4">
              <div className="flex items-center gap-2.5">
                <div className="rounded-full bg-primary/10 p-2 text-primary flex-shrink-0">
                  <Wallet className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-muted-foreground text-xs block">
                    Connected Address
                  </span>
                  <span
                    className="font-mono text-xs text-foreground font-semibold break-all select-all"
                    title={freighterWalletAddress ?? "not connected"}
                  >
                    {shortenAddress(freighterWalletAddress, 10, 10)}
                  </span>
                </div>
              </div>
              {accountSeq && (
                <div className="flex items-center gap-2.5">
                  <div className="rounded-full bg-primary/10 p-2 text-primary flex-shrink-0">
                    <Info className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">
                      Stellar Sequence ID
                    </span>
                    <span className="font-mono text-xs text-foreground font-semibold bg-muted/60 rounded px-2 py-0.5">
                      {accountSeq}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {activityError && (
              <VisualErrorCard
                error={activityError}
                onRetry={refreshWalletActivity}
                title="Failed to retrieve wallet information"
              />
            )}

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">
                Balances
              </h3>
              {activityLoading ? (
                <div className="grid gap-2 sm:grid-cols-2 animate-pulse">
                  <div className="rounded-xl border border-muted bg-card/60 p-4 space-y-2">
                    <div className="h-4 w-12 bg-muted rounded"></div>
                    <div className="h-3 w-20 bg-muted rounded"></div>
                  </div>
                  <div className="rounded-xl border border-muted bg-card/60 p-4 space-y-2">
                    <div className="h-4 w-12 bg-muted rounded"></div>
                    <div className="h-3 w-20 bg-muted rounded"></div>
                  </div>
                </div>
              ) : balances.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {balances.map((balance, index) => (
                    <div
                      key={`${balance.asset_type}-${balance.asset_code ?? "native"}-${index}`}
                      className="rounded-xl border border-muted bg-card/30 p-4 text-sm flex justify-between items-center shadow-sm hover:border-primary/20 transition duration-200"
                    >
                      <div>
                        <p className="font-bold text-foreground">
                          {balance.asset_type === "native"
                            ? "XLM"
                            : (balance.asset_code ?? balance.asset_type)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Type:{" "}
                          {balance.asset_type === "native"
                            ? "Native Currency"
                            : "Registered Asset"}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-sm text-foreground bg-primary/5 border border-primary/10 rounded-lg px-2.5 py-1">
                          {parseFloat(balance.balance).toLocaleString(
                            undefined,
                            { minimumFractionDigits: 2 },
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center bg-muted/10 border border-dashed rounded-xl">
                  <AlertCircle className="h-8 w-8 text-muted-foreground/60 mb-2" />
                  <p className="text-xs font-semibold text-muted-foreground">
                    No balances found for this account.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t pt-4 border-muted/50">
              <h3 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">
                Recent Operations
              </h3>
              {activityLoading ? (
                <div className="space-y-2 animate-pulse">
                  <div className="rounded-xl border border-muted bg-card/60 p-4 space-y-2">
                    <div className="h-4 w-32 bg-muted rounded"></div>
                    <div className="h-3 w-24 bg-muted rounded"></div>
                  </div>
                  <div className="rounded-xl border border-muted bg-card/60 p-4 space-y-2">
                    <div className="h-4 w-32 bg-muted rounded"></div>
                    <div className="h-3 w-24 bg-muted rounded"></div>
                  </div>
                </div>
              ) : recentActivity.length > 0 ? (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {recentActivity.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-muted bg-card/30 p-4 text-xs space-y-2 hover:border-primary/20 transition duration-200"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-foreground uppercase bg-muted/80 rounded px-2 py-0.5 tracking-wide text-[10px]">
                          {item.type.replaceAll("_", " ")}
                        </span>
                        <span className="text-muted-foreground font-mono flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(item.created_at)}
                        </span>
                      </div>
                      {item.amount && (
                        <div className="flex justify-between items-center text-sm border-t border-muted/30 pt-1.5 mt-1">
                          <span className="text-muted-foreground">Amount:</span>
                          <span className="font-mono font-bold text-foreground">
                            {parseFloat(item.amount).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}{" "}
                            {item.asset_code ?? "XLM"}
                          </span>
                        </div>
                      )}
                      <div className="grid gap-1 sm:grid-cols-2 text-[10px] text-muted-foreground border-t border-muted/30 pt-1.5 mt-1 font-mono">
                        {item.from && (
                          <div className="truncate">
                            <span className="font-bold">From:</span> {item.from}
                          </div>
                        )}
                        {item.to && (
                          <div className="truncate">
                            <span className="font-bold">To:</span> {item.to}
                          </div>
                        )}
                        {item.transaction_hash && (
                          <div className="sm:col-span-2 truncate flex items-center gap-1 select-all">
                            <span className="font-bold">Tx Hash:</span>{" "}
                            {item.transaction_hash}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center bg-muted/10 border border-dashed rounded-xl">
                  <AlertCircle className="h-8 w-8 text-muted-foreground/60 mb-2" />
                  <p className="text-xs font-semibold text-muted-foreground">
                    No recent transaction history found.
                  </p>
                </div>
              )}
            </div>
          </section>
        </TabsContent>
      </Tabs>

      {/*
      <section className="space-y-4 rounded-md border p-4">
        <h2 className="text-lg font-medium">Initialize Contract</h2>
        <p className="text-sm text-muted-foreground">
          Admin:{" "}
          {platformData?.admin ?? freighterWalletAddress ?? "not connected"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>Fee wallet address (G...)</span>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              placeholder="G..."
              value={feeWalletAddress}
              onChange={(event) => setFeeWalletAddress(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Fee percentage (bps)</span>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              placeholder="100"
              value={feePercentage}
              onChange={(event) => setFeePercentage(event.target.value)}
            />
          </label>
        </div>
        <button
          className="rounded bg-primary px-4 py-2 text-primary-foreground"
          onClick={handleInitialize}
        >
          Run Initialize
        </button>
        {initError && <p className="text-sm text-destructive">{initError}</p>}
        {initResult && <p className="text-sm text-emerald-600">{initResult}</p>}
      </section>

      <section className="space-y-3 rounded-md border p-4">
        <h2 className="text-lg font-medium">Get Platform</h2>
        <button
          className="rounded bg-primary px-4 py-2 text-primary-foreground"
          onClick={() => refreshProjectData()}
        >
          Refresh Platform
        </button>
        {platformError && (
          <p className="text-sm text-destructive">{platformError}</p>
        )}
        {platformData && (
          <pre className="overflow-auto rounded bg-muted p-3 text-xs">
            {stringifyWithBigInt(platformData)}
          </pre>
        )}
      </section>
      */}
    </div>
  );
}
