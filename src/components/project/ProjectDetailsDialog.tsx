"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/lib/types";
import { formatCurrency } from "@/lib/formatters";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { FundDialog } from "./FundDialog";
import { Progress } from "../ui/progress";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { MilestoneVoting } from "./MilestoneVoting";
import { ScrollArea } from "../ui/scroll-area";
import {
  TrendingUp,
  Info,
  PieChart,
  CheckCircle,
  RefreshCw,
  ArrowDownCircle,
  Zap,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "../ui/separator";
import { Button } from "../ui/button";
import { useAuth } from "@/context/AuthContext";
import { CubeSpinner } from "../ui/CubeSpinner";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ImageWithFallback } from "../ui/image-with-fallback";
import { StellarFormatter } from "@/lib/stellar-format";
import {
  usePlatformInfo,
  useRefreshAfterTx,
  useBlockchain,
} from "@/context/BlockchainContext";
import { shortenAddress } from "@/lib/utils";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { getBalance } from "@/lib/stellar";
import { getUserByCreatorId } from "@/lib/data.client";
import { getClaimRequests, createClaimRequest } from "@/actions/claims";
import { signTransaction, signAuthEntry } from "@stellar/freighter-api";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { submitMilestoneProof } from "@/app/actions";
import { getPinataClient, getIPFSGatewayUrl } from "@/lib/pinata-client";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

const getSignerOptions = (publicKey: string) => ({
  signTransaction: (xdr: string) =>
    signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    }),
  signAuthEntry: async (xdr: string) => {
    const res = await signAuthEntry(xdr, {
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

export function ProjectDetailsDialog() {
  const {
    project,
    isOpen,
    closeProjectDetails,
    isFundFlow,
    setIsFundFlow,
    refreshProject,
    isLoading,
    error,
  } = useProjectDetails();

  const { user, login, refreshUser } = useAuth();
  const { platformInfo } = usePlatformInfo();
  const { toast } = useToast();
  const router = useRouter();
  const refreshAfterTx = useRefreshAfterTx();
  const { userFunds, refreshUserFunds, refreshProjects } = useBlockchain();


  const { freighterWalletAddress, login: connectFreighter } = useFreighterWallet();
  const [isConnectingFreighter, setIsConnectingFreighter] = useState(false);

  const handleConnectFreighter = async (): Promise<string | null> => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in with Google first before connecting your wallet.",
        variant: "destructive",
      });
      login();
      return null;
    }
    setIsConnectingFreighter(true);
    try {
      const address = await connectFreighter();
      await refreshUser();
      toast({
        title: "Wallet Connected",
        description: "Freighter wallet successfully connected and verified.",
      });
      return address || null;
    } catch (err: any) {
      console.error("[ProjectDetailsDialog] Freighter connection failed:", err);
      toast({
        title: "Connection Failed",
        description: err.message || "Failed to connect Freighter wallet.",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsConnectingFreighter(false);
    }
  };

  const [balances, setBalances] = useState<any[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  const [isClaimPending, setIsClaimPending] = useState(false);
  const [isBondPendingState, setIsBondPendingState] = useState(false);
  const [isFinalizePending, setIsFinalizePending] = useState(false);
  const [isRefundClaimPending, setIsRefundClaimPending] = useState(false);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [dbClaimRequested, setDbClaimRequested] = useState<boolean>(false);

  // Submit Proof Modal states
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [detailedProof, setDetailedProof] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isUpdatingProof, setIsUpdatingProof] = useState(false);

  const activeMilestone = project?.milestones?.find((m) => !m.released);
  const activeMilestoneIndex = project?.milestones?.findIndex((m) => !m.released) ?? -1;

  const handleOpenSubmitProofModal = () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in with Google first.",
        variant: "destructive",
      });
      login();
      return;
    }
    if (!project || !activeMilestone) return;

    let initialDesc = "";
    if (activeMilestone.proof) {
      if (activeMilestone.proof.startsWith("{")) {
        try {
          const parsed = JSON.parse(activeMilestone.proof);
          initialDesc = parsed.description || "";
        } catch (e) {
          initialDesc = activeMilestone.proof;
        }
      } else {
        initialDesc = activeMilestone.proof;
      }
    }
    setDetailedProof(initialDesc);
    setAttachedFile(null);
    setIsSubmitModalOpen(true);
  };

  const handleConfirmSubmitProof = async () => {
    if (!project || !activeMilestone) return;
    if (!detailedProof.trim()) {
      toast({
        title: "Validation Error",
        description: "Detailed proof is required.",
        variant: "destructive",
      });
      return;
    }

    let imageUrl = "";

    if (attachedFile) {
      setIsUploadingImage(true);
      try {
        const pinata = getPinataClient();
        const cid = await pinata.uploadFile(attachedFile);
        imageUrl = getIPFSGatewayUrl(cid);
      } catch (err: any) {
        console.error("Image upload failed:", err);
        toast({
          title: "Image Upload Failed",
          description: err.message || "Failed to upload image.",
          variant: "destructive",
        });
        setIsUploadingImage(false);
        return;
      }
      setIsUploadingImage(false);
    } else {
      if (activeMilestone.proof && activeMilestone.proof.startsWith("{")) {
        try {
          const parsed = JSON.parse(activeMilestone.proof);
          imageUrl = parsed.imageUrl || "";
        } catch (e) { }
      }
    }

    const payload = JSON.stringify({
      description: detailedProof.trim(),
      imageUrl: imageUrl
    });

    setIsUpdatingProof(true);
    try {
      const res = await submitMilestoneProof(
        project.vaultAddress!,
        activeMilestone.id,
        payload
      );
      if (res.success) {
        toast({
          title: "Proof Submitted Successfully",
          description: "Milestone completion proof has been logged and is awaiting multi-sig verification.",
        });
        setIsSubmitModalOpen(false);
        await fetch("/api/indexer", { method: "POST" });
        refreshProject(project.id);
        refreshProjects();
        window.dispatchEvent(new Event("refresh-notifications"));
        router.refresh();
      } else {
        toast({
          title: "Submission Failed",
          description: res.error,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIsUpdatingProof(false);
    }
  };

  const projectCurrency = project?.currencyType ?? "XLM";
  const creatorAddress = project?.creatorAddress ?? project?.creatorId ?? "";
  const creatorDisplayName =
    creatorName ?? project?.creator ?? "Unknown Creator";

  const activeAddress = freighterWalletAddress || user?.stellarPublicKey || "";

  const isCreator =
    !!activeAddress &&
    creatorAddress !== "" &&
    activeAddress === creatorAddress;

  const canEditOrDelete = false; // Stellar projects are immutable on-chain after creation

  const [vaultContributorBalance, setVaultContributorBalance] = useState<number | null>(null);
  const [hasContributedHistorically, setHasContributedHistorically] = useState<boolean>(false);

  const hasBacked =
    userFunds.some((receipt) => receipt.project_id === project?.id) ||
    hasContributedHistorically ||
    (vaultContributorBalance !== null && vaultContributorBalance > 0);

  const isRefundClaimed =
    hasBacked &&
    (project?.vaultAddress
      ? vaultContributorBalance === 0
      : hasContributedHistorically && !userFunds.some((receipt) => receipt.project_id === project?.id));

  const refreshBalances = useCallback(async () => {
    if (!activeAddress) {
      setBalances([]);
      return;
    }
    setIsLoadingBalances(true);
    try {
      const walletBalances = await getBalance(activeAddress);
      setBalances(walletBalances as any[]);
    } catch (err) {
      console.error("Failed to load freighter balances:", err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [activeAddress]);

  useEffect(() => {
    if (isOpen && activeAddress) {
      refreshBalances();
      refreshUserFunds(activeAddress);

      if (project?.id) {
        fetch(`/api/user/contributions?address=${activeAddress}&projectId=${project.id}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setHasContributedHistorically(!!data.hasContributed);
            }
          })
          .catch((err) => {
            console.error("Failed to check historical contributions:", err);
          });
      }

      if (project?.vaultAddress) {
        const checkVaultBalance = async () => {
          try {
            const client = new VaultClient({
              contractId: project.vaultAddress!,
              rpcUrl: SOROBAN_RPC_URL,
              networkPassphrase: NETWORK_PASSPHRASE,
              publicKey: activeAddress,
            });
            const balanceTx = await client.get_balance({ contributor: activeAddress });
            const balanceVal = await balanceTx.simulate();
            const balNum = Number(balanceVal.result || 0);
            setVaultContributorBalance(balNum);
          } catch (e) {
            console.error("Failed to query vault balance:", e);
            setVaultContributorBalance(0);
          }
        };
        checkVaultBalance();
      } else {
        setVaultContributorBalance(0);
      }
    } else {
      setVaultContributorBalance(null);
      setHasContributedHistorically(false);
    }
  }, [isOpen, activeAddress, project?.id, project?.vaultAddress, refreshBalances, refreshUserFunds]);

  useEffect(() => {
    if (project?.id && isOpen) {
      getClaimRequests()
        .then((rows) => {
          // Admin-only; non-admins get an empty list. claim_requests keys on
          // the project row id rather than the on-chain project id.
          setDbClaimRequested(rows.length > 0);
        })
        .catch((err) => {
          console.error("Failed to load claim request status:", err);
        });
    }
  }, [project?.id, isOpen]);

  useEffect(() => {
    let isActive = true;

    const resolveCreatorName = async () => {
      if (!project) {
        setCreatorName(null);
        return;
      }

      if (
        project.creator &&
        !project.creator.startsWith("0x") &&
        project.creator !== creatorAddress
      ) {
        setCreatorName(project.creator);
        return;
      }

      if (!creatorAddress) {
        setCreatorName(project.creator ?? null);
        return;
      }

      const user = await getUserByCreatorId(creatorAddress, "stellarPublicKey");
      if (!isActive) return;

      setCreatorName(user?.name ?? project.creator ?? null);
    };

    resolveCreatorName();

    return () => {
      isActive = false;
    };
  }, [project, creatorAddress]);

  const handleInitiateClaimRequest = async () => {
    if (!project) return;

    let activeAddress = freighterWalletAddress;
    if (!activeAddress) {
      toast({
        title: "Wallet Connection Required",
        description: "Connecting and verifying Freighter wallet...",
      });
      const connectedAddress = await handleConnectFreighter();
      if (!connectedAddress) return;
      activeAddress = connectedAddress;
    }

    setIsClaimPending(true);
    try {
      await createClaimRequest(project.id, activeAddress);
      setDbClaimRequested(true);

      toast({
        title: "Claim Request Initiated",
        description: `Your request to claim funds for campaign #${project.id} has been submitted to platform administrators.`,
      });

      if (platformInfo?.admin) {
        try {
          const uRes = await fetch(
            `/api/user-by-address?field=stellarPublicKey&address=${platformInfo.admin}`,
          );
          const uData = uRes.ok ? await uRes.json() : null;
          if (uData?.uid) {          }
        } catch (e) {
          console.error("Failed to notify platform admin:", e);
        }
      }

      refreshProject(project.id);
      await refreshAfterTx(activeAddress);
    } catch (err: any) {
      toast({
        title: "Submission Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIsClaimPending(false);
    }
  };


  // handlePostBond is gone: the bond is transferred during create_vault, so a
  // vault either exists with its bond locked or does not exist.


  const handleFinalizeCampaign = async () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in with Google first.",
        variant: "destructive",
      });
      login();
      return;
    }
    if (!project || !project.vaultAddress) return;

    let activeAddress = freighterWalletAddress;
    if (!activeAddress) {
      const connectedAddress = await handleConnectFreighter();
      if (!connectedAddress) return;
      activeAddress = connectedAddress;
    }

    setIsFinalizePending(true);
    try {
      const client = new VaultClient({
        contractId: project.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: activeAddress,
        ...getSignerOptions(activeAddress),
      });

      const tx = await client.settle();
      await tx.signAndSend();

      toast({
        title: "Campaign Finalized",
        description: "The raise has been settled on-chain.",
      });

      refreshProject(project.id);
      await refreshAfterTx(activeAddress);
    } catch (err: any) {
      console.error("Finalization failed:", err);
      toast({
        title: "Finalize Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIsFinalizePending(false);
    }
  };

  const handleClaimRefund = async () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in with Google first.",
        variant: "destructive",
      });
      login();
      return;
    }
    if (!project || !project.vaultAddress) return;

    let activeAddress = freighterWalletAddress;
    if (!activeAddress) {
      const connectedAddress = await handleConnectFreighter();
      if (!connectedAddress) return;
      activeAddress = connectedAddress;
    }

    setIsRefundClaimPending(true);
    try {
      const client = new VaultClient({
        contractId: project.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: activeAddress,
        ...getSignerOptions(activeAddress),
      });

      const tx = await client.claim_refund({
        contributor: activeAddress,
      });

      await tx.signAndSend();

      toast({
        title: "Refund Claimed",
        description: "Your contribution has been refunded successfully.",
      });

      refreshProject(project.id);
      await refreshAfterTx(activeAddress);
    } catch (err: any) {
      console.error("Claim refund failed:", err);
      const simError = (err.simulation as any)?.error;
      const errMsg = simError || err.message || String(err);
      const isAlreadyClaimed = String(errMsg).includes("#9") || String(errMsg).includes("NoFundsToRefund") || String(errMsg).includes("Contract, #9");

      if (isAlreadyClaimed) {
        toast({
          title: "Refund Unavailable",
          description: "Refund already claimed or no contribution balance found.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Refund Failed",
          description: String(errMsg),
          variant: "destructive",
        });
      }
    } finally {
      setIsRefundClaimPending(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) closeProjectDetails();
  };

  if (!project && !isLoading) return null;

  const fundingPercentage = project
    ? project.status === "completed"
      ? 100
      : StellarFormatter.getPercentage(
        project.currentFundingRaw,
        project.fundingGoalRaw,
      )
    : 0;

  const fundingDeadline = project?.fundingDeadline ?? 0;

  const isUnderfundedAndExpired = project
    ? project.status === "expired" ||
    (project.status === "raising" &&
      Date.now() > fundingDeadline &&
      Number(project.currentFundingRaw ?? 0) <
      Number(project.fundingGoalRaw ?? 0))
    : false;

  const isClaimRequested = dbClaimRequested;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[92vh] sm:w-full sm:max-h-[90vh]">
        <DialogHeader className="p-4 pb-3 pr-24 sm:p-6 sm:pb-4 sm:pr-28 border-b relative">
          <DialogTitle className="text-xl sm:text-2xl font-bold font-headline leading-tight break-all line-clamp-3 text-left">
            {project?.title || "Loading..."}
          </DialogTitle>
          <DialogDescription className="text-sm sm:text-lg leading-snug break-words break-all text-left line-clamp-3 sm:line-clamp-4">
            {project?.tagline || "Fetching details..."}
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-14 h-7 w-7 sm:top-1.5 sm:right-16 sm:h-8 sm:w-8"
            onClick={() => project && refreshProject(project.id)}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? "animate-spin" : ""} />
          </Button>
        </DialogHeader>

        <ScrollArea className="h-full">
          {isLoading && !project ? (
            <div className="flex justify-center items-center h-96">
              <CubeSpinner size="large" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-96 gap-4 text-center">
              <AlertTriangle className="h-12 w-12 text-destructive" />
              <h3 className="text-xl font-semibold">Could not load project</h3>
              <p className="text-muted-foreground">{error}</p>
              <Button onClick={() => project && refreshProject(project.id)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            </div>
          ) : (
            project && (
              <div className="space-y-4 p-6">
                <div className="relative h-60 w-full mb-4 rounded-md overflow-hidden">
                  <ImageWithFallback
                    src={project.imageUrl}
                    alt={project.title}
                    className="w-full h-full object-cover"
                    fill
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">{project.category}</Badge>
                  <div className="text-right">
                    <p className="font-semibold text-lg">
                      {StellarFormatter.formatWithLabel(
                        project.fundingGoalRaw,
                        2,
                        projectCurrency,
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Funding Goal
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold text-foreground">
                      {project.status === "completed"
                        ? `${StellarFormatter.formatWithLabel(project.fundingGoalRaw, 2, projectCurrency)} raised & withdrawn`
                        : `${StellarFormatter.formatWithLabel(project.currentFundingRaw, 2, projectCurrency)} raised`}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {project.status === "completed"
                        ? "100"
                        : fundingPercentage.toFixed(0)}
                      %
                    </span>
                  </div>
                  <Progress
                    value={
                      project.status === "completed" ? 100 : fundingPercentage
                    }
                    className="h-2"
                  />
                </div>

                <div className="prose prose-sm dark:prose-invert max-w-none pt-2 pr-6">
                  <div className="max-h-40 overflow-auto break-words">
                    <p>{project.description}</p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-2">Creator</h4>
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage
                        src={project.creatorAvatar}
                        alt={project.creator}
                      />
                      <AvatarFallback>
                        {project.creator.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p
                        className="text-sm font-semibold text-foreground truncate"
                        title={creatorDisplayName}
                      >
                        {creatorDisplayName}
                      </p>
                      {creatorAddress && (
                        <p
                          className="text-xs text-muted-foreground font-mono truncate"
                          title={creatorAddress}
                        >
                          {shortenAddress(creatorAddress)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
        </ScrollArea>

        {project && (
          <DialogFooter className="p-4 sm:p-6 border-t flex-col items-stretch gap-3">
            {project?.status === "completed" && (
              <div className="w-full text-xs text-green-600 dark:text-green-400 font-medium py-2 px-3 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-200 dark:border-green-800/30 text-center">
                Campaign completed. All raised funds have been successfully claimed.
              </div>
            )}

            <div className="flex w-full flex-col sm:flex-row gap-2 justify-end items-stretch sm:items-center">
              {/* Finalize Project Campaign Button */}
              {((project.status === "raising" || project.status === "pending") && Date.now() >= (project.fundingDeadline || 0)) && (
                <Button
                  onClick={handleFinalizeCampaign}
                  disabled={isFinalizePending}
                  variant="outline"
                  className="w-full sm:w-auto whitespace-nowrap shrink-0 border-amber-500 hover:bg-amber-500/10 text-amber-500 hover:text-amber-400"
                >
                  {isFinalizePending && <CubeSpinner />}
                  Finalize Campaign
                </Button>
              )}

              {/* Claim Refund Button */}
              {hasBacked && (project.status === "failed" || project.status === "refunding") && (
                <Button
                  onClick={handleClaimRefund}
                  disabled={isRefundClaimPending || isRefundClaimed}
                  variant={isRefundClaimed ? "outline" : "destructive"}
                  className="w-full sm:w-auto whitespace-nowrap shrink-0"
                >
                  {isRefundClaimPending && <CubeSpinner />}
                  {isRefundClaimed ? "Refund Claimed" : "Claim Refund"}
                </Button>
              )}

              {isCreator && (project?.status === "funded" || project?.status === "active") && activeMilestone && (
                <Button
                  onClick={handleOpenSubmitProofModal}
                  disabled={isUpdatingProof || isUploadingImage}
                  className="w-full sm:w-auto whitespace-nowrap shrink-0 bg-[#003049] text-white hover:bg-[#003049]/90 font-semibold"
                >
                  {(isUpdatingProof || isUploadingImage) && <CubeSpinner size="small" className="mr-2" />}
                  <ArrowDownCircle className="mr-2 h-4 w-4 shrink-0" />
                  {activeMilestone.proof ? "Update Proof" : "Submit Proof"}
                </Button>
              )}



              {project?.vaultAddress &&
                ["funded", "active", "completed", "refunding"].includes(project.status) && (
                  <div className="w-full space-y-3 pt-2">
                    <h3 className="text-sm font-semibold">Milestones</h3>
                    <MilestoneVoting
                      vaultAddress={project.vaultAddress}
                      currency={project.currencyType ?? "USDC"}
                      creatorAddress={project.creatorAddress ?? project.creator}
                      onChange={() => refreshProject(project.id)}
                    />
                  </div>
                )}

              <FundDialog
                project={project!}
                isFundFlow={isFundFlow}
                setIsFundFlow={setIsFundFlow}
              />

              <Dialog open={isSubmitModalOpen} onOpenChange={setIsSubmitModalOpen}>
                <DialogContent className="sm:max-w-[480px] max-w-[95vw] border border-border bg-card p-6 rounded-2xl shadow-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-accent flex items-center gap-2 font-headline">
                      Submit Milestone Proof
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                      Provide verifiable proof of completion for the active milestone.
                    </DialogDescription>
                  </DialogHeader>

                  {project && activeMilestone && activeMilestoneIndex !== -1 && (
                    <div className="space-y-4 py-3">
                      <div className="bg-muted/40 border border-border/60 rounded-xl p-3.5 space-y-1.5">
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                          Milestone Details
                        </p>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-foreground">
                            Milestone #{activeMilestoneIndex + 1}: {activeMilestone.title || `Milestone ${activeMilestone.id}`}
                          </span>
                          <Badge variant="secondary" className="bg-[#003049]/10 text-[#003049] border-none text-[10px] rounded-full px-2.5">
                            {activeMilestone.amount.toLocaleString()} USDC
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Project: <strong className="text-foreground">{project.title}</strong>
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="detailed-proof" className="text-xs font-semibold">
                          Detailed Proof <span className="text-rose-500">*</span>
                        </Label>
                        <Textarea
                          id="detailed-proof"
                          rows={4}
                          placeholder="Summarize the work completed."
                          value={detailedProof}
                          onChange={(e) => setDetailedProof(e.target.value)}
                          className="resize-none text-xs rounded-lg"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="visual-proof" className="text-xs font-semibold">
                          Visual Proof Attachment (Optional)
                        </Label>
                        <Input
                          id="visual-proof"
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setAttachedFile(file);
                          }}
                          className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[11px] file:font-semibold file:bg-[#003049]/10 file:text-[#003049] hover:file:bg-[#003049]/20"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Supported formats: PNG, JPG, JPEG. Max size 5MB.
                        </p>
                      </div>
                    </div>
                  )}

                  <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsSubmitModalOpen(false)}
                      disabled={isUpdatingProof || isUploadingImage}
                      className="text-xs font-semibold"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleConfirmSubmitProof}
                      disabled={isUpdatingProof || isUploadingImage || !detailedProof.trim()}
                      className="bg-[#003049] text-white hover:bg-[#003049]/90 text-xs font-semibold"
                    >
                      {(isUpdatingProof || isUploadingImage) && <CubeSpinner size="small" className="mr-1.5" />}
                      {isUploadingImage ? "Uploading Image..." : isUpdatingProof ? "Submitting..." : "Submit Proof"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
