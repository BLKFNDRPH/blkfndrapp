"use client";

import { useEffect, useState } from "react";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import {
  CurrencyType,
  ProjectStatus,
  type Project,
  type AdminProposal,
} from "@/packages/blkfndr_v2";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { getPinataClient, getIPFSGatewayUrl } from "@/lib/pinata-client";
import { createNotification } from "@/actions/notifications-client";
import { getClaimRequests, deleteClaimRequest } from "@/actions/claims";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Upload,
  RotateCw,
  Copy,
  ChevronDown,
  ChevronUp,
  Info,
  Lock,
  Wallet,
  Check,
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  Settings,
} from "lucide-react";

const STATUS_LABELS: Record<number, string> = {
  0: "Hidden",
  1: "Pending",
  2: "Rejected",
  3: "Approved",
  4: "Funded",
  5: "Completed",
  6: "Expired",
};

const getSupermajority = (n: number) => {
  if (n <= 2) return n;
  return Math.floor((2 * n + 2) / 3);
};

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
                <RotateCw className="h-3.5 w-3.5 animate-spin-once" />
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

export default function StellarAdminTestingPage() {
  const {
    getPlatform,
    getAllProjects,
    updateProjectStatus,
    approveProject,
    rejectProject,
    transferAdmin,
    addMultisigAdmin,
    removeMultisigAdmin,
    updatePlatformFee,
    setFeeWallet,
    registerToken,
    proposeWithdrawal,
    voteWithdrawal,
    executeWithdrawal,
    getPendingProposals,
  } = useStellarContract();
  const { freighterWalletAddress } = useFreighterWallet();

  const [platformAdmin, setPlatformAdmin] = useState<string | null>(null);
  const [platformFeeWallet, setPlatformFeeWallet] = useState<string | null>(null);
  const [platformMultiSigAdmins, setPlatformMultiSigAdmins] = useState<
    string[]
  >([]);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [dbClaimRequests, setDbClaimRequests] = useState<string[]>([]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const [isPlatformLoading, setIsPlatformLoading] = useState(false);
  const [proposals, setProposals] = useState<AdminProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [proposalProjectId, setProposalProjectId] = useState("");
  const [proposalAmountStr, setProposalAmountStr] = useState("");
  const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);
  const [selectedExecuteProposalIds, setSelectedExecuteProposalIds] = useState<
    string[]
  >([]);
  const { toast: triggerToast } = useToast();

  const [newStatus, setNewStatus] = useState<ProjectStatus>(
    ProjectStatus.Approved,
  );
  const [newAdminAddress, setNewAdminAddress] = useState("");
  const [newFeeWalletAddress, setNewFeeWalletAddress] = useState("");
  const [removeAdminAddress, setRemoveAdminAddress] = useState("");
  const [transferAdminAddress, setTransferAdminAddress] = useState("");
  const [platformFeeBps, setPlatformFeeBps] = useState("300");
  const [tokenCurrencyType, setTokenCurrencyType] = useState<
    "XLM" | "USDC" | "USDT" | "WBTC" | "WETH"
  >("XLM");
  const [tokenContractId, setTokenContractId] = useState("");
  const [isPinataUploading, setIsPinataUploading] = useState(false);
  const [pinataSelectedFile, setPinataSelectedFile] = useState<File | null>(
    null,
  );
  const [pinataPreview, setPinataPreview] = useState<string | null>(null);
  const [pinataUploadedImageUrl, setPinataUploadedImageUrl] = useState<
    string | null
  >(null);

  const loadPlatform = async () => {
    setPlatformError(null);
    setProjectsError(null);
    setProposalsError(null);
    setIsPlatformLoading(true);
    setProposalsLoading(true);
    setSelectedProposalIds([]);
    setSelectedExecuteProposalIds([]);

    try {
      const [platform, loadedProjects, loadedProposals, activeClaimRequests] = await Promise.all([
        getPlatform(),
        getAllProjects(),
        getPendingProposals(),
        getClaimRequests(),
      ]);

      setDbClaimRequests(activeClaimRequests);
      setPlatformAdmin(platform.admin);
      setPlatformFeeWallet(platform.fee_wallet_address);
      setPlatformMultiSigAdmins(
        Array.isArray(platform.multi_sig_admins)
          ? platform.multi_sig_admins.map((addr) => String(addr))
          : [],
      );
      setPlatformFeeBps(platform.fee_percentage?.toString?.() ?? "300");
      setProjects(loadedProjects);
      setProposals(loadedProposals);

      if (loadedProjects.length > 0) {
        setProjectId((prev) => {
          const isValid = loadedProjects.some((p) => p.id.toString() === prev);
          return isValid ? prev : loadedProjects[0].id.toString();
        });

        // Auto‑select first Funded project with initiated claim request for proposal creation
        // and which does not already have an active/pending withdrawal proposal.
        const funded = loadedProjects.filter(
          (p) =>
            p.status === ProjectStatus.Funded &&
            activeClaimRequests.includes(p.id.toString()) &&
            !loadedProposals.some(
              (prop) =>
                prop.project_id.toString() === p.id.toString() &&
                !prop.executed,
            ),
        );
        if (funded.length > 0) {
          setProposalProjectId((prev) => {
            const isValid = funded.some((p) => p.id.toString() === prev);
            return isValid ? prev : funded[0].id.toString();
          });
        } else {
          setProposalProjectId("");
        }
      } else {
        setProjectId("");
        setProposalProjectId("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlatformError(message);
      setProjectsError(message);
      setProposalsError(message);
    } finally {
      setIsPlatformLoading(false);
      setProposalsLoading(false);
    }
  };

  useEffect(() => {
    if (freighterWalletAddress) {
      loadPlatform();
    }
  }, [freighterWalletAddress, getPlatform, getAllProjects]);

  const connected = freighterWalletAddress;
  const isMainAdmin =
    !!platformAdmin && platformAdmin === connected;
  const isMultiSigAdmin = platformMultiSigAdmins.some(
    (addr) => addr === connected,
  );
  const isAdmin = isMainAdmin || isMultiSigAdmin;

  const clearActionState = () => {
    setActionError(null);
    setActionResult(null);
  };

  const runAction = async (
    runner: () => Promise<unknown>,
    successMessage: string,
  ) => {
    clearActionState();
    setIsActionPending(true);

    try {
      const result = await runner();
      const txStatus = (result as any)?.getTransactionResponse?.status;
      if (txStatus && txStatus !== "SUCCESS") {
        throw new Error("Transaction failed on-chain.");
      }

      setActionResult(successMessage);
      triggerToast({
        title: "Platform Admin Action Successful",
        description: successMessage,
      });
      await loadPlatform();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      triggerToast({
        title: "Admin Operation Failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsActionPending(false);
    }
  };

  const handleUpdateStatus = async () => {
    await runAction(
      () =>
        updateProjectStatus({
          projectId: BigInt(projectId || "0"),
          newStatus,
        }),
      "Project status updated.",
    );
  };

  const notifyCreator = async (isApproved: boolean) => {
    const selectedProject = projects.find((p) => p.id.toString() === projectId);
    if (!selectedProject || !selectedProject.creator) return;

    try {
      const uRes = await fetch(
        `/api/user-by-address?field=stellarPublicKey&address=${selectedProject.creator}`,
      );
      const uData = uRes.ok ? await uRes.json() : null;
      if (uData?.uid) {
        const title = isApproved
          ? "Project Listing Approved!"
          : "Project Listing Rejected";
        const caption = isApproved
          ? `Your project listing "${selectedProject.title}" has been approved by the platform admins and is now active for funding.`
          : `Your project listing "${selectedProject.title}" was rejected by the platform admins.`;

        await createNotification(uData.uid, title, caption, null, projectId);
      }
    } catch (e) {
      console.error("Failed to notify project creator:", e);
    }
  };

  const handleApproveProject = async () => {
    await runAction(
      () => approveProject({ projectId: BigInt(projectId || "0") }),
      "Project approved.",
    );
    await notifyCreator(true);
  };

  const handleRejectProject = async () => {
    await runAction(
      () => rejectProject({ projectId: BigInt(projectId || "0") }),
      "Project rejected.",
    );
    await notifyCreator(false);
  };

  const handleTransferAdmin = async () => {
    if (!transferAdminAddress.trim()) {
      setActionError("New admin address is required.");
      return;
    }

    await runAction(
      () => transferAdmin({ newAdmin: transferAdminAddress.trim() }),
      "Primary admin transferred.",
    );
  };

  const handleAddAdmin = async () => {
    if (!newAdminAddress.trim()) {
      setActionError("Admin address is required.");
      return;
    }

    await runAction(
      () => addMultisigAdmin({ newAdmin: newAdminAddress.trim() }),
      "Multisig admin added.",
    );
  };

  const handleRemoveAdmin = async () => {
    if (!removeAdminAddress.trim()) {
      setActionError("Admin address is required.");
      return;
    }

    await runAction(
      () => removeMultisigAdmin({ target: removeAdminAddress.trim() }),
      "Multisig admin removed.",
    );
  };

  const handleUpdatePlatformFee = async () => {
    await runAction(
      () => updatePlatformFee({ newFeeBps: BigInt(platformFeeBps || "0") }),
      "Platform fee updated.",
    );
  };

  const handleUpdateFeeWallet = async () => {
    if (!newFeeWalletAddress.trim()) {
      setActionError("New fee wallet address is required.");
      return;
    }

    await runAction(
      () => setFeeWallet({ feeWalletAddress: newFeeWalletAddress.trim(), feeWalletEmail: "" }),
      "Platform fee wallet address updated.",
    );
    setNewFeeWalletAddress("");
  };

  const handleRegisterToken = async () => {
    if (!tokenContractId.trim()) {
      setActionError("Token contract ID is required.");
      return;
    }

    await runAction(
      () =>
        registerToken({
          currencyType:
            tokenCurrencyType === "USDC"
              ? CurrencyType.USDC
              : tokenCurrencyType === "USDT"
                ? CurrencyType.USDT
                : tokenCurrencyType === "WBTC"
                  ? CurrencyType.WBTC
                  : tokenCurrencyType === "WETH"
                    ? CurrencyType.WETH
                    : CurrencyType.XLM,
          tokenAddress: tokenContractId.trim(),
        }),
      "Token registered.",
    );
  };

  const handleCreateProposal = async () => {
    if (!proposalProjectId) {
      setActionError("Please select a campaign first.");
      return;
    }
    const cleanAmtStr = proposalAmountStr.trim();
    if (!cleanAmtStr || isNaN(parseFloat(cleanAmtStr))) {
      setActionError("Please enter a valid positive amount (in tokens).");
      return;
    }
    const amtTokens = parseFloat(cleanAmtStr);
    if (amtTokens <= 0) {
      setActionError("Amount must be greater than 0.");
      return;
    }
    const amountSmallest = BigInt(Math.floor(amtTokens * 10_000_000));

    await runAction(
      async () => {
        const res = await proposeWithdrawal({
          projectId: BigInt(proposalProjectId),
          amount: amountSmallest,
        });
        await deleteClaimRequest(proposalProjectId);
        return res;
      },
      "Withdrawal proposal created successfully.",
    );
    setProposalAmountStr("");
  };

  const handleVoteProposal = async (proposalId: bigint) => {
    await runAction(
      () =>
        voteWithdrawal({
          proposalId,
        }),
      "Voted to approve withdrawal proposal successfully.",
    );
  };

  const handleBatchVoteProposals = async () => {
    if (selectedProposalIds.length === 0) return;

    clearActionState();
    setIsActionPending(true);

    try {
      let succeededCount = 0;
      for (let i = 0; i < selectedProposalIds.length; i++) {
        const propId = selectedProposalIds[i];
        const propBigint = BigInt(propId);

        // Update user status
        setActionResult(
          `Voting on proposal ${i + 1} of ${selectedProposalIds.length}...`,
        );

        await voteWithdrawal({ proposalId: propBigint });
        succeededCount++;
      }

      setActionResult(
        `Successfully voted to approve ${succeededCount} proposal(s).`,
      );
      triggerToast({
        title: "Batch Approvals Complete",
        description: `Successfully approved ${succeededCount} proposal(s).`,
      });
      setSelectedProposalIds([]);
      await loadPlatform();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      triggerToast({
        title: "Batch Approvals Failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsActionPending(false);
    }
  };

  const handleExecuteProposal = async (proposalId: bigint) => {
    await runAction(
      () =>
        executeWithdrawal({
          proposalId,
        }),
      "Withdrawal proposal executed and funds transferred successfully.",
    );
  };

  const handleBatchExecuteProposals = async () => {
    if (selectedExecuteProposalIds.length === 0) return;

    clearActionState();
    setIsActionPending(true);

    try {
      let succeededCount = 0;
      for (let i = 0; i < selectedExecuteProposalIds.length; i++) {
        const propId = selectedExecuteProposalIds[i];
        const propBigint = BigInt(propId);

        // Update user status
        setActionResult(
          `Executing release for proposal ${i + 1} of ${selectedExecuteProposalIds.length}...`,
        );

        await executeWithdrawal({ proposalId: propBigint });
        succeededCount++;
      }

      setActionResult(
        `Successfully executed release for ${succeededCount} proposal(s).`,
      );
      triggerToast({
        title: "Batch Execution Complete",
        description: `Successfully executed release for ${succeededCount} proposal(s).`,
      });
      setSelectedExecuteProposalIds([]);
      await loadPlatform();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      triggerToast({
        title: "Batch Execution Failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsActionPending(false);
    }
  };

  const handlePinataFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      setPinataSelectedFile(file);
      setPinataUploadedImageUrl(null);

      const reader = new FileReader();
      reader.onloadend = () => {
        setPinataPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      return;
    }

    setPinataSelectedFile(null);
    setPinataPreview(null);
  };

  const handlePinataUpload = async () => {
    if (!pinataSelectedFile) {
      triggerToast({
        title: "No file selected",
        description: "Choose an image before uploading to Pinata.",
        variant: "destructive",
      });
      return;
    }

    clearActionState();
    setIsPinataUploading(true);
    setPinataUploadedImageUrl(null);

    try {
      const pinata = getPinataClient();
      const cid = await pinata.uploadFile(pinataSelectedFile);
      const imageUrl = getIPFSGatewayUrl(cid);

      setPinataUploadedImageUrl(imageUrl);
      triggerToast({
        title: "Pinata upload successful",
        description: `Uploaded ${pinataSelectedFile.name} and resolved CID ${cid}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      triggerToast({
        title: "Pinata upload failed",
        description: message,
        isError: true,
        variant: "destructive",
      });
    } finally {
      setIsPinataUploading(false);
    }
  };

  const shortenAddress = (addr: string | null | undefined) => {
    if (!addr) return "Disconnected";
    return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
  };

  return (
    <div className="container mx-auto max-w-2xl space-y-6 py-10 px-4">
      <div className="flex items-center gap-3 border-b pb-4">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary flex-shrink-0 animate-pulse">
          <Settings className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            BLKFNDR Platform Admin
          </h1>
          <p className="text-xs text-muted-foreground">
            Manage campaigns, token registrations, and administrative
            configurations.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Wallet className="h-4 w-4 text-orange-500" />
            Wallet Connection Details
          </h3>
          {isPlatformLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="bg-muted/30 border border-muted/50 rounded-lg p-3">
            <span className="text-muted-foreground text-xs block mb-0.5">
              Connected Address
            </span>
            <span className="font-mono text-xs font-semibold text-foreground break-all select-all">
              {freighterWalletAddress
                ? shortenAddress(freighterWalletAddress)
                : "not connected"}
            </span>
          </div>

          <div className="bg-muted/30 border border-muted/50 rounded-lg p-3">
            <span className="text-muted-foreground text-xs block mb-0.5">
              Primary Admin (Contract Owner)
            </span>
            <span className="font-mono text-xs font-semibold text-foreground break-all select-all">
              {platformAdmin ? shortenAddress(platformAdmin) : "loading..."}
            </span>
          </div>

          <div className="bg-muted/30 border border-muted/50 rounded-lg p-3">
            <span className="text-muted-foreground text-xs block mb-0.5">
              Platform Fee Wallet
            </span>
            <span className="font-mono text-xs font-semibold text-foreground break-all select-all">
              {platformFeeWallet ? shortenAddress(platformFeeWallet) : "loading..."}
            </span>
          </div>
        </div>

        {platformMultiSigAdmins.length > 0 && (
          <div className="bg-muted/30 border border-muted/50 rounded-lg p-3 space-y-1.5">
            <span className="text-muted-foreground text-xs block font-bold uppercase tracking-wide">
              Multi-Signature Administrators
            </span>
            <div className="grid gap-1 sm:grid-cols-2">
              {platformMultiSigAdmins.map((addr) => (
                <div
                  key={addr}
                  className="flex items-center gap-1.5 bg-background/50 border border-muted/30 rounded px-2.5 py-1 text-xs"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 animate-pulse" />
                  <span className="font-mono text-[11px] truncate" title={addr}>
                    {shortenAddress(addr)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {platformError && (
          <div className="pt-2">
            <VisualErrorCard
              error={platformError}
              title="Failed to load platform info"
              onRetry={loadPlatform}
            />
          </div>
        )}
      </div>

      {!isAdmin && freighterWalletAddress && (
        <div className="relative overflow-hidden rounded-xl border border-rose-500/25 bg-rose-500/5 p-6 shadow-sm text-center space-y-3">
          <ShieldAlert className="h-10 w-10 text-rose-500 mx-auto animate-bounce" />
          <h3 className="text-base font-bold text-rose-500">
            Administrative Access Restricted
          </h3>
          <p className="text-sm text-foreground/80 max-w-md mx-auto leading-relaxed">
            Your connected wallet address is not authorized as a primary or
            multi-signature administrator for this smart contract.
          </p>
          <div className="pt-1.5">
            <span className="inline-block text-[11px] font-semibold tracking-wide text-muted-foreground bg-muted border rounded px-3 py-1 font-mono">
              Switch to an authorized admin wallet to proceed
            </span>
          </div>
        </div>
      )}

      {isAdmin && (
        <>
          <section className="space-y-6 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Lock className="h-5 w-5 text-orange-500" />
                Administrative Operations Console
              </h2>
              <p className="text-xs text-muted-foreground">
                Select a campaign and perform secure blockchain adjustments.
              </p>
            </div>

            {projectsError && (
              <VisualErrorCard
                error={projectsError}
                title="Failed to load campaigns list"
                onRetry={loadPlatform}
              />
            )}

            <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Pinata Upload Test
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Upload a file here to verify the Pinata JWT and gateway
                  settings.
                </p>
              </div>

              <div className="space-y-3">
                <input
                  type="file"
                  accept="image/*"
                  className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground file:font-semibold hover:file:opacity-90"
                  onChange={handlePinataFileChange}
                  disabled={isPinataUploading}
                />

                {pinataPreview && !pinataUploadedImageUrl && (
                  <div className="rounded-lg border border-muted bg-background/50 p-3">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">
                      Preview
                    </p>
                    <img
                      src={pinataPreview}
                      alt="Selected file preview"
                      className="max-h-64 w-full rounded-md object-cover"
                    />
                  </div>
                )}

                {pinataUploadedImageUrl && (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <p className="mb-2 text-xs font-semibold text-emerald-600">
                      Uploaded image
                    </p>
                    <img
                      src={pinataUploadedImageUrl}
                      alt="Uploaded from Pinata"
                      className="max-h-64 w-full rounded-md object-cover"
                    />
                  </div>
                )}

                <Button
                  onClick={handlePinataUpload}
                  disabled={isPinataUploading || !pinataSelectedFile}
                  className="w-full sm:w-auto"
                >
                  {isPinataUploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Upload to Pinata
                </Button>
              </div>
            </div>

            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground font-semibold">
                Select Campaign for Administrative Action
              </span>
              <select
                className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 transition"
                value={projectId}
                disabled={isActionPending || projects.length === 0}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="" disabled>
                  Select project
                </option>
                {projects.map((project) => {
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Campaign Audit Review
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Approve the project for public crowdfunding, or reject the
                  campaign application.
                </p>
                <div className="flex gap-2.5 pt-1">
                  <button
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 px-3 py-2.5 text-xs font-semibold shadow transition disabled:opacity-50"
                    onClick={handleApproveProject}
                    disabled={isActionPending || !projectId}
                  >
                    {isActionPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    Approve Campaign
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 px-3 py-2.5 text-xs font-semibold shadow transition disabled:opacity-50"
                    onClick={handleRejectProject}
                    disabled={isActionPending || !projectId}
                  >
                    {isActionPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    Reject Campaign
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Manual Status Override
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Directly override and update the blockchain campaign status
                  field.
                </p>
                <div className="flex gap-2 items-center">
                  <select
                    className="flex-1 rounded border border-muted bg-background/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition"
                    value={String(newStatus)}
                    disabled={isActionPending}
                    onChange={(event) =>
                      setNewStatus(Number(event.target.value) as ProjectStatus)
                    }
                  >
                    <option value={String(ProjectStatus.Hidden)}>Hidden</option>
                    <option value={String(ProjectStatus.Pending)}>
                      Pending Review
                    </option>
                    <option value={String(ProjectStatus.Rejected)}>
                      Rejected
                    </option>
                    <option value={String(ProjectStatus.Approved)}>
                      Approved
                    </option>
                    <option value={String(ProjectStatus.Funded)}>Funded</option>
                    <option value={String(ProjectStatus.Completed)}>
                      Completed
                    </option>
                    <option value={String(ProjectStatus.Expired)}>
                      Expired
                    </option>
                  </select>
                  <button
                    className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold shadow hover:opacity-90 disabled:opacity-50 transition"
                    onClick={handleUpdateStatus}
                    disabled={isActionPending || !projectId}
                  >
                    {isActionPending && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    Update
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Register Currency Asset
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Register token addresses to enable custom campaign currency
                  selections.
                </p>
                <div className="space-y-2">
                  <select
                    className="w-full rounded border border-muted bg-background/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition"
                    value={tokenCurrencyType}
                    disabled={isActionPending}
                    onChange={(event) =>
                      setTokenCurrencyType(
                        event.target.value as
                          | "XLM"
                          | "USDC"
                          | "USDT"
                          | "WBTC"
                          | "WETH",
                      )
                    }
                  >
                    <option value="XLM">XLM</option>
                    <option value="USDC">USDC</option>
                    <option value="USDT">USDT</option>
                    <option value="WBTC">WBTC</option>
                    <option value="WETH">WETH</option>
                  </select>
                  <input
                    className="w-full rounded border border-muted bg-background/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition font-mono"
                    placeholder="Token contract ID (C...)"
                    value={tokenContractId}
                    disabled={isActionPending}
                    onChange={(event) => setTokenContractId(event.target.value)}
                  />
                  <button
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold shadow hover:opacity-90 disabled:opacity-50 transition"
                    onClick={handleRegisterToken}
                    disabled={isActionPending || !tokenContractId.trim()}
                  >
                    {isActionPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    Register Token Address
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Transfer Primary Admin
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Transfer ultimate smart contract control to another Stellar
                  account.
                </p>
                <div className="space-y-2">
                  <input
                    className="w-full rounded border border-muted bg-background/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition font-mono"
                    placeholder="New admin address (G...)"
                    value={transferAdminAddress}
                    disabled={isActionPending}
                    onChange={(event) =>
                      setTransferAdminAddress(event.target.value)
                    }
                  />
                  <button
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 px-4 py-2 text-xs font-semibold shadow disabled:opacity-50 transition"
                    onClick={handleTransferAdmin}
                    disabled={isActionPending || !transferAdminAddress.trim()}
                  >
                    {isActionPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    Transfer Authority
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Add Multisig Admin
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Grant secondary administrative access to a trusted Freighter
                  wallet.
                </p>
                <div className="space-y-2">
                  <input
                    className="w-full rounded border border-muted bg-background/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition font-mono"
                    placeholder="Admin wallet address (G...)"
                    value={newAdminAddress}
                    disabled={isActionPending}
                    onChange={(event) => setNewAdminAddress(event.target.value)}
                  />
                  <button
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold shadow hover:opacity-90 disabled:opacity-50 transition"
                    onClick={handleAddAdmin}
                    disabled={isActionPending || !newAdminAddress.trim()}
                  >
                    {isActionPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    Authorize Admin Wallet
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Remove Multisig Admin
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Revoke secondary administrative access for an authorized
                  Freighter wallet.
                </p>
                <div className="space-y-2">
                  <input
                    className="w-full rounded border border-muted bg-background/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition font-mono"
                    placeholder="Admin wallet address (G...)"
                    value={removeAdminAddress}
                    disabled={isActionPending}
                    onChange={(event) =>
                      setRemoveAdminAddress(event.target.value)
                    }
                  />
                  <button
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 px-4 py-2 text-xs font-semibold shadow disabled:opacity-50 transition"
                    onClick={handleRemoveAdmin}
                    disabled={isActionPending || !removeAdminAddress.trim()}
                  >
                    {isActionPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    Revoke Authority
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-3 sm:col-span-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Adjust Platform Service Fee
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Configure the platform commission charged on campaign
                  contributions (denominated in basis points; e.g. 300 = 3%).
                </p>
                <div className="flex gap-2.5 items-center">
                  <input
                    className="flex-1 rounded border border-muted bg-background/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition font-mono"
                    placeholder="Fee bps (e.g. 100)"
                    value={platformFeeBps}
                    disabled={isActionPending}
                    onChange={(event) => setPlatformFeeBps(event.target.value)}
                  />
                  <button
                    className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold shadow hover:opacity-90 disabled:opacity-50 transition"
                    onClick={handleUpdatePlatformFee}
                    disabled={isActionPending || !platformFeeBps.trim()}
                  >
                    {isActionPending && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    Apply Fee Rate
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-3 sm:col-span-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Update Platform Fee Wallet
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Configure the wallet address where collected platform service fees are routed on-chain.
                </p>
                <div className="flex gap-2.5 items-center">
                  <input
                    className="flex-1 rounded border border-muted bg-background/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition font-mono"
                    placeholder="New fee wallet address (G...)"
                    value={newFeeWalletAddress}
                    disabled={isActionPending}
                    onChange={(event) => setNewFeeWalletAddress(event.target.value)}
                  />
                  <button
                    className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold shadow hover:opacity-90 disabled:opacity-50 transition"
                    onClick={handleUpdateFeeWallet}
                    disabled={isActionPending || !newFeeWalletAddress.trim()}
                  >
                    {isActionPending && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    Update Fee Wallet
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-muted/50">
              {actionError && (
                <VisualErrorCard
                  error={actionError}
                  title="Administrative Action Failed"
                />
              )}
              {actionResult && (
                <VisualSuccessCard
                  message={actionResult}
                  title="Administrative Change Confirmed!"
                />
              )}
            </div>
          </section>

          <section className="space-y-6 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm mt-6">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Settings className="h-5 w-5 text-orange-500" />
                Multisig Withdrawal Proposals Console
              </h2>
              <p className="text-xs text-muted-foreground">
                Propose and execute funds release for fully funded campaigns on
                the Stellar Network.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* PROPOSE WITHDRAWAL SECTION */}
              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Propose Fund Withdrawal
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Select a funded campaign and propose an amount to transfer
                    to the creator.
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block space-y-1.5 text-xs">
                    <span className="text-muted-foreground font-semibold">
                      Select Funded Project
                    </span>
                    <select
                      className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition"
                      value={proposalProjectId}
                      disabled={isActionPending}
                      onChange={(event) =>
                        setProposalProjectId(event.target.value)
                      }
                    >
                      <option value="" disabled>
                        Select funded project
                      </option>
                      {projects
                        .filter(
                          (p) =>
                            p.status === ProjectStatus.Funded &&
                            dbClaimRequests.includes(p.id.toString()) &&
                            !proposals.some(
                              (prop) =>
                                prop.project_id.toString() ===
                                  p.id.toString() && !prop.executed,
                            ),
                        )
                        .map((p) => (
                          <option key={p.id.toString()} value={p.id.toString()}>
                            #{p.id.toString()} - {p.title} (
                            {Number(p.raised_amount) / 10_000_000}{" "}
                            {CurrencyType[p.currency_type]})
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="block space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground font-semibold">
                        Withdrawal Amount
                      </span>
                      {proposalProjectId && (
                        <button
                          type="button"
                          className="text-[10px] text-orange-400 hover:text-orange-300 font-bold transition"
                          onClick={() => {
                            const selectedProj = projects.find(
                              (p) => p.id.toString() === proposalProjectId,
                            );
                            if (selectedProj) {
                              const maxAmountTokens =
                                Number(selectedProj.raised_amount) / 10_000_000;
                              setProposalAmountStr(maxAmountTokens.toString());
                            }
                          }}
                        >
                          Max Funded Amount
                        </button>
                      )}
                    </div>
                    <input
                      className="w-full rounded border border-muted bg-background/50 px-3 py-2 text-xs focus:border-primary focus:outline-none disabled:opacity-50 transition font-mono"
                      placeholder="Amount (e.g. 500)"
                      value={proposalAmountStr}
                      disabled={isActionPending || !proposalProjectId}
                      onChange={(event) =>
                        setProposalAmountStr(event.target.value)
                      }
                    />
                  </label>

                  <button
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-xs font-semibold shadow hover:opacity-90 disabled:opacity-50 transition"
                    onClick={handleCreateProposal}
                    disabled={
                      isActionPending ||
                      !proposalProjectId ||
                      !proposalAmountStr.trim()
                    }
                  >
                    {isActionPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    Submit Withdrawal Proposal
                  </button>
                </div>
              </div>

              {/* LIST OF PENDING PROPOSALS SECTION */}
              <div className="rounded-xl border border-muted bg-card/30 p-4 space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Active Proposals
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Review, approve, and execute withdrawals once the
                    supermajority vote is reached.
                  </p>
                </div>
                {(() => {
                  const eligibleProposals = proposals.filter((proposal) => {
                    const alreadyApproved =
                      Array.isArray(proposal.approvals) &&
                      proposal.approvals.some(
                        (addr) =>
                          addr === freighterWalletAddress,
                      );
                    return !proposal.executed && !alreadyApproved;
                  });

                  const threshold = getSupermajority(
                    platformMultiSigAdmins.length,
                  );

                  const satisfyingProposals = proposals.filter((proposal) => {
                    const approvalCount = Array.isArray(proposal.approvals)
                      ? proposal.approvals.length
                      : 0;
                    const canExecute = approvalCount >= threshold;
                    return !proposal.executed && canExecute;
                  });

                  const allSelected =
                    eligibleProposals.length > 0 &&
                    eligibleProposals.every((p) =>
                      selectedProposalIds.includes(p.proposal_id.toString()),
                    );

                  const allExecuteSelected =
                    satisfyingProposals.length > 0 &&
                    satisfyingProposals.every((p) =>
                      selectedExecuteProposalIds.includes(
                        p.proposal_id.toString(),
                      ),
                    );

                  const toggleSelectAll = () => {
                    if (allSelected) {
                      setSelectedProposalIds((prev) =>
                        prev.filter(
                          (id) =>
                            !eligibleProposals.some(
                              (ep) => ep.proposal_id.toString() === id,
                            ),
                        ),
                      );
                    } else {
                      const eligibleIds = eligibleProposals.map((ep) =>
                        ep.proposal_id.toString(),
                      );
                      setSelectedProposalIds((prev) =>
                        Array.from(new Set([...prev, ...eligibleIds])),
                      );
                    }
                  };

                  const toggleSelectAllExecute = () => {
                    if (allExecuteSelected) {
                      setSelectedExecuteProposalIds((prev) =>
                        prev.filter(
                          (id) =>
                            !satisfyingProposals.some(
                              (sp) => sp.proposal_id.toString() === id,
                            ),
                        ),
                      );
                    } else {
                      const satisfyingIds = satisfyingProposals.map((sp) =>
                        sp.proposal_id.toString(),
                      );
                      setSelectedExecuteProposalIds((prev) =>
                        Array.from(new Set([...prev, ...satisfyingIds])),
                      );
                    }
                  };

                  return proposalsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                    </div>
                  ) : proposals.length > 0 ? (
                    <div className="space-y-4">
                      {eligibleProposals.length > 1 && (
                        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 text-xs animate-in fade-in slide-in-from-top-2">
                          <label className="flex items-center gap-2 cursor-pointer font-semibold text-foreground select-none">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              disabled={isActionPending}
                              onChange={toggleSelectAll}
                              className="h-3.5 w-3.5 rounded border-muted text-primary focus:ring-primary cursor-pointer disabled:opacity-50"
                            />
                            Select All to Approve ({eligibleProposals.length})
                          </label>

                          <button
                            onClick={handleBatchVoteProposals}
                            disabled={
                              isActionPending ||
                              selectedProposalIds.length === 0
                            }
                            className="rounded bg-primary text-primary-foreground px-3.5 py-1.5 text-[11px] font-bold shadow hover:opacity-90 disabled:opacity-50 transition flex items-center gap-1.5"
                          >
                            {isActionPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            )}
                            Confirm ({selectedProposalIds.length})
                          </button>
                        </div>
                      )}

                      {satisfyingProposals.length > 1 && (
                        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs animate-in fade-in slide-in-from-top-2">
                          <label className="flex items-center gap-2 cursor-pointer font-semibold text-foreground select-none">
                            <input
                              type="checkbox"
                              checked={allExecuteSelected}
                              disabled={isActionPending}
                              onChange={toggleSelectAllExecute}
                              className="h-3.5 w-3.5 rounded border-muted text-primary focus:ring-primary cursor-pointer disabled:opacity-50"
                            />
                            Select All to Execute ({satisfyingProposals.length})
                          </label>

                          <button
                            onClick={handleBatchExecuteProposals}
                            disabled={
                              isActionPending ||
                              selectedExecuteProposalIds.length === 0
                            }
                            className="rounded bg-emerald-500 hover:bg-emerald-600 text-white px-3.5 py-1.5 text-[11px] font-bold shadow disabled:opacity-50 transition flex items-center gap-1.5"
                          >
                            {isActionPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            )}
                            Confirm ({selectedExecuteProposalIds.length})
                          </button>
                        </div>
                      )}

                      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                        {proposals.map((proposal) => {
                          const id = proposal.proposal_id.toString();
                          const targetProj = projects.find(
                            (p) =>
                              p.id.toString() ===
                              proposal.project_id.toString(),
                          );
                          const targetTitle = targetProj
                            ? targetProj.title
                            : `Project #${proposal.project_id.toString()}`;
                          const targetCurrency = targetProj
                            ? CurrencyType[targetProj.currency_type]
                            : "";

                          const threshold = getSupermajority(
                            platformMultiSigAdmins.length,
                          );
                          const approvalCount = Array.isArray(
                            proposal.approvals,
                          )
                            ? proposal.approvals.length
                            : 0;
                          const alreadyApproved =
                            Array.isArray(proposal.approvals) &&
                            proposal.approvals.some(
                              (addr) =>
                                addr === freighterWalletAddress,
                            );
                          const canExecute = approvalCount >= threshold;
                          const isEligible =
                            !proposal.executed && !alreadyApproved;
                          const isSelected = selectedProposalIds.includes(id);

                          const isReadyToExecute =
                            canExecute && !proposal.executed;
                          const isExecuteSelected =
                            selectedExecuteProposalIds.includes(id);

                          const toggleSelect = () => {
                            setSelectedProposalIds((prev) =>
                              prev.includes(id)
                                ? prev.filter((x) => x !== id)
                                : [...prev, id],
                            );
                          };

                          const toggleSelectExecute = () => {
                            setSelectedExecuteProposalIds((prev) =>
                              prev.includes(id)
                                ? prev.filter((x) => x !== id)
                                : [...prev, id],
                            );
                          };

                          return (
                            <div
                              key={id}
                              className="rounded-lg border border-muted bg-background/40 p-3 space-y-2 text-xs"
                            >
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  {isEligible &&
                                    eligibleProposals.length > 1 && (
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={isActionPending}
                                        onChange={toggleSelect}
                                        title="Select for batch approval"
                                        className="h-3.5 w-3.5 rounded border-muted text-primary focus:ring-primary cursor-pointer disabled:opacity-50"
                                      />
                                    )}
                                  {isReadyToExecute &&
                                    satisfyingProposals.length > 1 && (
                                      <input
                                        type="checkbox"
                                        checked={isExecuteSelected}
                                        disabled={isActionPending}
                                        onChange={toggleSelectExecute}
                                        title="Select for batch execution"
                                        className="h-3.5 w-3.5 rounded border-muted text-emerald-500 focus:ring-emerald-500 cursor-pointer disabled:opacity-50"
                                      />
                                    )}
                                  <span className="font-bold text-foreground font-mono">
                                    Proposal #{id}
                                  </span>
                                </div>
                                <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono select-all">
                                  Target: {targetTitle}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                                <div>Amount:</div>
                                <div className="font-semibold text-foreground text-right font-mono">
                                  {Number(proposal.amount) / 10_000_000}{" "}
                                  {targetCurrency}
                                </div>
                                <div>Proposer:</div>
                                <div
                                  className="text-foreground text-right font-mono truncate"
                                  title={proposal.proposer}
                                >
                                  {shortenAddress(proposal.proposer)}
                                </div>
                                <div>Approvals:</div>
                                <div className="text-foreground text-right font-bold">
                                  {approvalCount} / {threshold} required
                                </div>
                              </div>

                              {proposal.approvals.length > 0 && (
                                <div className="pt-1.5 border-t border-muted/30">
                                  <span className="text-[10px] text-muted-foreground block mb-1">
                                    Approved Admins:
                                  </span>
                                  <div className="flex flex-wrap gap-1">
                                    {proposal.approvals.map((addr) => (
                                      <span
                                        key={addr}
                                        className="inline-block bg-background border rounded px-1.5 py-0.5 text-[9px] font-mono"
                                        title={addr}
                                      >
                                        {shortenAddress(addr)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="pt-2 flex gap-2">
                                {!isEligible && !isReadyToExecute && (
                                  <span className="text-[10px] text-muted-foreground italic w-full text-center">
                                    No actions available.
                                  </span>
                                )}
                                {isEligible && (
                                  <button
                                    className="flex-1 flex items-center justify-center gap-1 rounded bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-semibold shadow hover:opacity-90 disabled:opacity-50 transition"
                                    onClick={() =>
                                      handleVoteProposal(proposal.proposal_id)
                                    }
                                    disabled={isActionPending}
                                  >
                                    Approve
                                  </button>
                                )}
                                {isReadyToExecute && (
                                  <button
                                    className="flex-1 flex items-center justify-center gap-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold shadow disabled:opacity-50 transition"
                                    onClick={() =>
                                      handleExecuteProposal(
                                        proposal.proposal_id,
                                      )
                                    }
                                    disabled={isActionPending}
                                  >
                                    Execute
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                      No active withdrawal proposals.
                    </div>
                  );
                })()}
              </div>
            </div>
          </section>

          {(() => {
            const completedProjects = projects.filter(
              (p) => p.status === ProjectStatus.Completed,
            );
            const totalExecutedStroops = completedProjects.reduce(
              (sum, p) => sum + BigInt(p.raised_amount),
              BigInt(0),
            );
            const totalExecutedTokens =
              Number(totalExecutedStroops) / 10_000_000;

            return (
              <section className="space-y-6 rounded-xl border border-muted bg-card/40 backdrop-blur-md p-5 shadow-sm mt-6">
                <div className="flex items-center justify-between border-b border-muted pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 animate-pulse" />
                    <div>
                      <h2 className="text-lg font-bold text-foreground">
                        Completed & Executed Campaigns
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Campaigns successfully funded, approved, and released.
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block font-bold uppercase tracking-wider">
                      Total Released
                    </span>
                    <span className="text-base font-bold font-mono text-emerald-500 bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20">
                      {totalExecutedTokens.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 7,
                      })}{" "}
                      XLM
                    </span>
                  </div>
                </div>

                {completedProjects.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {completedProjects.map((p) => (
                      <div
                        key={p.id.toString()}
                        className="relative overflow-hidden rounded-xl border border-muted bg-background/50 hover:bg-background/80 p-4 transition-all duration-300 shadow-sm flex flex-col justify-between space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 mb-2">
                              Executed & Closed
                            </span>
                            <h4 className="text-sm font-bold text-foreground line-clamp-1">
                              {p.title}
                            </h4>
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                              {p.tagline}
                            </p>
                          </div>
                          <span className="text-xs font-mono font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded select-all">
                            ID #{p.id.toString()}
                          </span>
                        </div>

                        <div className="pt-2 border-t border-muted/50 flex items-center justify-between text-xs">
                          <div>
                            <span className="text-muted-foreground text-[10px] block font-semibold">
                              Funded & Released
                            </span>
                            <span className="font-mono font-bold text-foreground">
                              {Number(p.raised_amount) / 10_000_000}{" "}
                              {CurrencyType[p.currency_type]}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-muted-foreground text-[10px] block font-semibold">
                              Creator Address
                            </span>
                            <span
                              className="font-mono text-foreground font-semibold"
                              title={p.creator}
                            >
                              {shortenAddress(p.creator)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    No successfully executed campaigns found.
                  </div>
                )}
              </section>
            );
          })()}
        </>
      )}
    </div>
  );
}
