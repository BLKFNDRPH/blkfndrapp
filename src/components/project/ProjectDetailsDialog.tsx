"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { FundDialog } from "./FundDialog";
import { Progress } from "../ui/progress";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { MilestoneVoting, type MilestoneVaultState } from "./MilestoneVoting";
import { MilestoneProofDialog, MilestoneProofView, parseProof } from "./MilestoneProof";
import { ProjectLocation } from "./ProjectLocation";
import { RestrictionNotice } from "./RestrictionNotice";
import { ProjectRestrictionControls } from "../admin/ProjectRestrictionControls";
import { ScrollArea } from "../ui/scroll-area";
import {
  RefreshCw,
  AlertTriangle,
  ImagePlus,
  Lock,
} from "lucide-react";
import { Button } from "../ui/button";
import { useAuth } from "@/context/AuthContext";
import { CubeSpinner } from "../ui/CubeSpinner";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ImageWithFallback } from "../ui/image-with-fallback";
import { StellarFormatter } from "@/lib/stellar-format";
import {
  useRefreshAfterTx,
  useBlockchain,
} from "@/context/BlockchainContext";
import { shortenAddress } from "@/lib/utils";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { getUserByCreatorId } from "@/lib/data.client";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { freighterSigner } from "@/lib/freighter-signer";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

// Signing goes through freighterSigner, which checks what the wallet actually
// returned. Passing Freighter's raw result to the SDK meant a dismissed popup
// surfaced as "Cannot read properties of undefined (reading 'switch')".
const getSignerOptions = (publicKey: string) => freighterSigner(publicKey);

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
    signInToContinue,
  } = useProjectDetails();

  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const refreshAfterTx = useRefreshAfterTx();
  const { userFunds, refreshUserFunds, refreshProjects } = useBlockchain();

  const { freighterWalletAddress, login: connectFreighter } = useFreighterWallet();

  const handleConnectFreighter = async (): Promise<string | null> => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in with Google first before connecting your wallet.",
        variant: "destructive",
      });
      signInToContinue();
      return null;
    }
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
    }
  };

  const [isFinalizePending, setIsFinalizePending] = useState(false);
  const [isRefundClaimPending, setIsRefundClaimPending] = useState(false);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [creatorAvatar, setCreatorAvatar] = useState<string | null>(null);

  // Each milestone has its own proof, posted from its own card. The form opens
  // for one milestone at a time; `proofSession` remounts it so it always starts
  // from that milestone's saved proof, and the id outlives the closing animation.
  const [proofMilestoneId, setProofMilestoneId] = useState<number | null>(null);
  const [isProofFormOpen, setIsProofFormOpen] = useState(false);
  const [proofSession, setProofSession] = useState(0);
  // Proof saved from this dialog, keyed by project and milestone. The card shows
  // it straight away instead of waiting for the project to be read back.
  const [savedProofs, setSavedProofs] = useState<Record<string, string>>({});
  const proofOpenerRef = useRef<HTMLElement | null>(null);

  const proofOf = (milestoneId: number) =>
    savedProofs[`${project?.id}:${milestoneId}`] ??
    project?.milestones?.find((m) => m.id === milestoneId)?.proof;

  const openProofForm = (milestoneId: number, opener: HTMLElement) => {
    proofOpenerRef.current = opener;
    setProofMilestoneId(milestoneId);
    setProofSession((n) => n + 1);
    setIsProofFormOpen(true);
  };

  const handleProofSaved = (milestoneId: number, proof: string) => {
    if (!project) return;
    setSavedProofs((saved) => ({ ...saved, [`${project.id}:${milestoneId}`]: proof }));
    setIsProofFormOpen(false);
    toast({
      title: "Proof saved",
      description: "Your proof is saved. Stakeholders can now see it when they vote.",
    });
    refreshProject(project.id);
    refreshProjects();
    window.dispatchEvent(new Event("refresh-notifications"));
    router.refresh();
  };

  const projectCurrency = project?.currencyType ?? "XLM";
  const creatorAddress = project?.creatorAddress ?? project?.creatorId ?? "";
  const creatorDisplayName =
    creatorName ?? project?.creator ?? "Unknown Creator";

  const activeAddress = freighterWalletAddress || user?.stellarPublicKey || "";

  // Proof is a server action checked against the account's linked wallet, not a
  // signature, so the builder is the account linked to the creator address and
  // nothing has to be connected right now. It is exactly the server's test.
  const isBuilder = creatorAddress !== "" && user?.stellarPublicKey === creatorAddress;

  // A platform lock pauses the builder's actions here — proof, and opening a
  // milestone vote — and new stakes in FundDialog. Everything a stakeholder
  // does with money already in the vault is untouched.
  const isLocked = project?.restriction?.locked === true;

  // Backers vote on a release, and the admin console's "Verify" opens this
  // dialog, so the proof sits in each milestone's card, beside its vote. The
  // builder adds or edits it there, one milestone at a time, while the vault is
  // building; once a milestone is paid out or has failed its vote is over and
  // the proof stays as it was voted on.
  const renderMilestoneProof = (state: MilestoneVaultState) => {
    const milestone = project?.milestones?.find((m) => m.id === state.id);
    const proof = parseProof(proofOf(state.id));
    const canPost =
      isBuilder &&
      (project?.status === "funded" || project?.status === "active") &&
      !!milestone &&
      !state.released &&
      !state.failed;

    return (
      <MilestoneProofView milestoneId={state.id} proof={proof} released={state.released}>
        {canPost && isLocked && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            The platform has locked this project, so adding proof is paused
            until it is unlocked.
          </p>
        )}
        {canPost && !isLocked && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant={proof ? "outline" : "default"}
              onClick={(event) => openProofForm(state.id, event.currentTarget)}
            >
              <ImagePlus aria-hidden="true" />
              {proof ? "Edit proof" : "Add proof"}
              <span className="sr-only"> for milestone {state.id}</span>
            </Button>
            {!proof && state.voteOpened === false && (
              <p className="text-sm text-muted-foreground">
                Add it before you open voting, so stakeholders can see what
                they&apos;re approving.
              </p>
            )}
          </div>
        )}
      </MilestoneProofView>
    );
  };

  const proofMilestone =
    project?.milestones?.find((m) => m.id === proofMilestoneId) ?? null;

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

  useEffect(() => {
    if (isOpen && activeAddress) {
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
  }, [isOpen, activeAddress, project?.id, project?.vaultAddress, refreshUserFunds]);

  useEffect(() => {
    let isActive = true;

    const resolveCreatorName = async () => {
      setCreatorAvatar(null);
      if (!project) {
        setCreatorName(null);
        return;
      }

      // Indexed from the creator's linked profile; no lookup needed.
      if (project.creatorName && project.creatorName !== creatorAddress) {
        setCreatorName(project.creatorName);
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

      const user = await getUserByCreatorId(creatorAddress);
      if (!isActive) return;

      setCreatorName(user?.name || project.creator || null);
      setCreatorAvatar(user?.avatarUrl || null);
    };

    resolveCreatorName();

    return () => {
      isActive = false;
    };
  }, [project, creatorAddress]);


  // handlePostBond is gone: the bond is transferred during create_vault, so a
  // vault either exists with its bond locked or does not exist.


  const handleFinalizeCampaign = async () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in with Google first.",
        variant: "destructive",
      });
      signInToContinue();
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
      signInToContinue();
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


  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[92vh] sm:w-full sm:max-h-[90vh]">
        <DialogHeader className="p-4 pb-3 pr-24 sm:p-6 sm:pb-4 sm:pr-28 border-b relative">
          {/* overflow-wrap:anywhere, not break-all. break-all split ordinary
              words at the edge ("Restaurant an / d Bakeshop"); this wraps at
              spaces and still breaks a long unbroken string, without letting
              it widen the dialog. */}
          <DialogTitle className="text-xl sm:text-2xl font-bold font-headline leading-tight [overflow-wrap:anywhere] line-clamp-3 text-left">
            {project?.title || "Loading..."}
          </DialogTitle>
          <DialogDescription className="text-sm sm:text-lg leading-snug [overflow-wrap:anywhere] text-left line-clamp-3 sm:line-clamp-4">
            {/* A loaded project with no tagline is not a project still loading.
                The old copy said "Fetching details..." forever whenever the
                metadata carried no description. */}
            {project
              ? project.tagline || "No description was published for this project."
              : "Fetching details…"}
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-14 h-7 w-7 sm:top-1.5 sm:right-16 sm:h-8 sm:w-8"
            onClick={() => project && refreshProject(project.id)}
            disabled={isLoading}
            aria-label="Refresh this project"
            title="Refresh this project"
          >
            <RefreshCw className={isLoading ? "animate-spin" : ""} aria-hidden="true" />
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
                <RestrictionNotice restriction={project.restriction} />
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

                {/* Milestones sat in the footer, which does not scroll. With a
                    vote open they filled a 768px-high window and left the body
                    above, proof included, zero pixels tall. Proof only exists
                    once a vault is funded, which is when this section shows. */}
                {project.vaultAddress &&
                  ["funded", "active", "completed", "refunding"].includes(project.status) && (
                    <div className="border-t pt-4">
                      <h4 className="font-semibold mb-2">Milestones</h4>
                      <MilestoneVoting
                        vaultAddress={project.vaultAddress}
                        currency={project.currencyType ?? "USDC"}
                        creatorAddress={project.creatorAddress ?? project.creator}
                        platformLocked={isLocked}
                        details={project.milestones}
                        renderProof={renderMilestoneProof}
                        onChange={() => refreshProject(project.id)}
                      />
                    </div>
                  )}

                {(project.location || project.locationLat != null) && (
                  <div className="border-t pt-4">
                    <h4 className="font-semibold mb-2">Location</h4>
                    <ProjectLocation
                      location={project.location}
                      lat={project.locationLat}
                      lng={project.locationLng}
                    />
                  </div>
                )}

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-2">Creator</h4>
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage
                        src={creatorAvatar ?? project.creatorAvatar}
                        alt={creatorDisplayName}
                      />
                      <AvatarFallback>
                        {creatorDisplayName.charAt(0)}
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

                <ProjectRestrictionControls
                  project={project}
                  onChanged={() => {
                    refreshProject(project.id);
                    refreshProjects();
                  }}
                />
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

              <FundDialog
                project={project!}
                isFundFlow={isFundFlow}
                setIsFundFlow={setIsFundFlow}
              />
            </div>
          </DialogFooter>
        )}

        {/* Rendered inside this dialog's content so Radix treats it as a
            nested layer: pressing in it is not a press outside the project. */}
        {project?.vaultAddress && (
          <MilestoneProofDialog
            key={proofSession}
            open={isProofFormOpen}
            onOpenChange={setIsProofFormOpen}
            milestone={
              proofMilestone && { ...proofMilestone, proof: proofOf(proofMilestone.id) }
            }
            vaultAddress={project.vaultAddress}
            projectTitle={project.title}
            currency={projectCurrency}
            onSaved={handleProofSaved}
            returnFocusRef={proofOpenerRef}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
