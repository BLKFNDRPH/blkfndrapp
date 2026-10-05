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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { FundDialog } from "./FundDialog";
import { Progress } from "../ui/progress";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { MilestonePlan, MilestoneVoting, type MilestoneVaultState } from "./MilestoneVoting";
import { MilestoneProofDialog, MilestoneProofView, parseProof } from "./MilestoneProof";
import { ProjectLocation } from "./ProjectLocation";
import { RestrictionNotice } from "./RestrictionNotice";
import { ProjectRestrictionControls } from "../admin/ProjectRestrictionControls";
import { ScrollArea } from "../ui/scroll-area";
import { ExpandableText, useIsClamped } from "../ui/expandable-text";
import {
  RefreshCw,
  AlertTriangle,
  ImagePlus,
  PauseCircle,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { Button } from "../ui/button";
import { useAuth } from "@/context/AuthContext";
import { CubeSpinner } from "../ui/CubeSpinner";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ImageWithFallback } from "../ui/image-with-fallback";
import { StellarFormatter } from "@/lib/stellar-format";
import {
  useRefreshAfterTx,
  useBlockchain,
} from "@/context/BlockchainContext";
import { cn } from "@/lib/utils";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { getUserByCreatorId } from "@/lib/data.client";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { freighterSigner } from "@/lib/freighter-signer";
import { describeMoney, describeRateAge, formatToken } from "@/lib/money";
import { useXlmRate } from "@/lib/xlm-rate";
import {
  describeStatus,
  describeDeadline,
  TONE_CLASSES,
  type StatusView,
} from "@/lib/project-status";
import { EXPLORER_BASE, EXPLORER_EXPLAINER } from "@/lib/network";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

// Signing goes through freighterSigner, which checks what the wallet actually
// returned. Passing the wallet's raw result to the SDK meant a dismissed popup
// surfaced as "Cannot read properties of undefined (reading 'switch')".
const getSignerOptions = (publicKey: string) => freighterSigner(publicKey);

/** The vault counts in stroops; a person reads whole tokens. */
const STROOPS = 10_000_000;

const SIGN_IN_TOAST = {
  title: "Sign in first",
  description: "Sign in to continue.",
  variant: "destructive" as const,
};

/** A Stellar account or contract address, which must never stand in for a name. */
const looksLikeAddress = (s: string) => /^[GC][A-Z2-7]{55}$/.test(s);

/** "14 Mar", the way the deadline is spoken everywhere in the dialog. */
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** The four promises under the money block. Exact copy from the brief. */
const WHAT_HAPPENS_TO_MY_MONEY = [
  "It goes into this project's vault, not to BLKFNDR.",
  "If the goal isn't reached by the deadline, you collect it back.",
  "Once the goal is reached, the builder is paid stage by stage, each time stakeholders vote yes.",
  "If a stage fails the vote, what's left and the builder's deposit come back to stakeholders.",
];

/**
 * Statuses of a vault that reached its goal, so its stages have votes and
 * proof. A Failed vault never reached it: no vote ever opens there.
 */
const STAGE_VOTE_STATUSES: readonly string[] = ["funded", "active", "completed", "refunding"];

/** The line above the stage plan: how far the vault is from its first vote. */
function stagePlanNote(status: StatusView): string {
  switch (status.key) {
    case "goal-reached":
      return "The goal is reached. The builder opens each stage to a stakeholder vote, one at a time.";
    case "deadline-passed":
    case "goal-not-reached":
      return "The goal wasn't reached by the deadline, so these stages won't start.";
    default:
      return "The builder is paid in these stages, one at a time, each after stakeholders vote yes. Voting opens once the goal is reached.";
  }
}

/**
 * The one status pill, with its tooltip. The same words as the card, because
 * both read describeStatus.
 */
function StatusPill({ status }: { status: StatusView }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            tabIndex={0}
            className={cn("cursor-help whitespace-nowrap", TONE_CLASSES[status.tone])}
          >
            {status.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-left">
          {status.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * A collapsed section opened by a click. A native details element rather than
 * a Radix accordion: the dependency is not installed and a disclosure that
 * works without JavaScript is exactly right for text nobody has to read.
 */
function Disclosure({
  summary,
  children,
  className,
}: {
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group rounded-lg border border-border/60", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-border/60 px-3 py-3 text-sm">{children}</div>
    </details>
  );
}

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
  const { rate: xlmUsd, updatedAt: rateUpdatedAt } = useXlmRate();

  const { freighterWalletAddress, login: connectFreighter } = useFreighterWallet();

  const handleConnectWallet = async (): Promise<string | null> => {
    if (!user) {
      toast(SIGN_IN_TOAST);
      signInToContinue();
      return null;
    }
    try {
      const address = await connectFreighter();
      await refreshUser();
      toast({
        title: "Your wallet is linked",
        description: "Your wallet is linked to your account.",
      });
      return address || null;
    } catch (err: any) {
      console.error("[ProjectDetailsDialog] wallet connection failed:", err);
      toast({
        title: "Couldn't reach your wallet",
        description: err.message || "We couldn't connect your wallet. Try again.",
        variant: "destructive",
      });
      return null;
    }
  };

  // The header holds two lines of the title and never grows past them. When
  // they cut the title short, the body opens with all of it.
  const [titleEl, setTitleEl] = useState<HTMLHeadingElement | null>(null);
  const isTitleClamped = useIsClamped(titleEl, project?.title, !!project);

  const [isClosePending, setIsClosePending] = useState(false);
  const [isRefundClaimPending, setIsRefundClaimPending] = useState(false);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [creatorAvatar, setCreatorAvatar] = useState<string | null>(null);

  // Each stage has its own proof, posted from its own card. The form opens for
  // one stage at a time; `proofSession` remounts it so it always starts from
  // that stage's saved proof, and the id outlives the closing animation.
  const [proofMilestoneId, setProofMilestoneId] = useState<number | null>(null);
  const [isProofFormOpen, setIsProofFormOpen] = useState(false);
  const [proofSession, setProofSession] = useState(0);
  // Proof saved from this dialog, keyed by project and stage. The card shows
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
  // The name, or a neutral word: never the address, however the row was
  // indexed. The indexed profile name is read synchronously so the first paint
  // already shows it; the lookup effect below only refines it.
  const creatorDisplayName = (() => {
    const isName = (s: string | null | undefined): s is string => {
      const t = (s ?? "").trim();
      return t !== "" && t !== creatorAddress && !looksLikeAddress(t);
    };
    const candidate = [creatorName, project?.creatorName, project?.creator].find(isName);
    return candidate ? candidate.trim() : "Unnamed builder";
  })();

  const activeAddress = freighterWalletAddress || user?.stellarPublicKey || "";

  // Proof is a server action checked against the account's linked wallet, not a
  // signature, so the builder is the account linked to the creator address and
  // nothing has to be connected right now. It is exactly the server's test.
  const isBuilder = creatorAddress !== "" && user?.stellarPublicKey === creatorAddress;

  // A platform pause stops the builder's actions here — proof, and opening a
  // stage vote — and new stakes in FundDialog. Everything a stakeholder does
  // with money already in the vault is untouched.
  const isLocked = project?.restriction?.locked === true;

  // Stakeholders vote on a payout, and the admin console's "Verify" opens this
  // dialog, so the proof sits in each stage's card, beside its vote. The
  // builder adds or edits it there, one stage at a time, while the vault is
  // building; once a stage is paid out or has failed its vote is over and the
  // proof stays as it was voted on.
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
            <PauseCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Paused by BLKFNDR, so adding proof waits until the review is over.
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
              <span className="sr-only"> for stage {state.id}</span>
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

  // Raw stroops, as the vault's get_balance returns them.
  const [vaultContributorBalance, setVaultContributorBalance] = useState<number | null>(null);
  const [hasContributedHistorically, setHasContributedHistorically] = useState<boolean>(false);

  const ownReceipts = userFunds.filter((receipt) => receipt.project_id === project?.id);

  const isStakeholder =
    ownReceipts.length > 0 ||
    hasContributedHistorically ||
    (vaultContributorBalance !== null && vaultContributorBalance > 0);

  // What this account has in the vault right now, in whole tokens. The vault's
  // own figure wins; the indexed receipts stand in while it is being read.
  const ownStakeTokens: number | null = (() => {
    if (vaultContributorBalance !== null && vaultContributorBalance > 0) {
      return vaultContributorBalance / STROOPS;
    }
    if (ownReceipts.length > 0) {
      const sum = ownReceipts.reduce((acc, r) => acc + Number(r.amount || 0), 0);
      return Number.isFinite(sum) && sum > 0 ? sum / STROOPS : null;
    }
    return null;
  })();

  const isRefundClaimed =
    isStakeholder &&
    (project?.vaultAddress
      ? vaultContributorBalance === 0
      : hasContributedHistorically && ownReceipts.length === 0);

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
            console.error("Failed to check stake history:", err);
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

      // Indexed from the builder's linked profile; no lookup needed.
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

      // Never fall back to the address: the name is the only thing shown here.
      const fallback =
        project.creator && project.creator !== creatorAddress ? project.creator : null;
      setCreatorName(user?.name || fallback);
      setCreatorAvatar(user?.avatarUrl || null);
    };

    resolveCreatorName();

    return () => {
      isActive = false;
    };
  }, [project, creatorAddress]);

  // handlePostBond is gone: the builder's deposit is transferred during
  // create_vault, so a vault either exists with its deposit locked or does not
  // exist.

  // "Close it now": settle a vault whose deadline has passed. Permissionless in
  // the contract; here it is kept under Technical details for a signed-in
  // stakeholder or the builder, because BLKFNDR's cron does the same thing.
  const handleCloseNow = async () => {
    if (!user) {
      toast(SIGN_IN_TOAST);
      signInToContinue();
      return;
    }
    if (!project || !project.vaultAddress) return;

    let signingAddress = freighterWalletAddress;
    if (!signingAddress) {
      const connectedAddress = await handleConnectWallet();
      if (!connectedAddress) return;
      signingAddress = connectedAddress;
    }

    setIsClosePending(true);
    try {
      const client = new VaultClient({
        contractId: project.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        ...getSignerOptions(signingAddress),
      });

      const tx = await client.settle();
      await tx.signAndSend();

      toast({
        title: "Vault closed to new stakes",
        description: "The vault has recorded what happens next.",
      });

      refreshProject(project.id);
      await refreshAfterTx(signingAddress);
    } catch (err: any) {
      console.error("Close now failed:", err);
      toast({
        title: "Couldn't close the vault",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIsClosePending(false);
    }
  };

  const handleCollectRefund = async () => {
    if (!user) {
      toast(SIGN_IN_TOAST);
      signInToContinue();
      return;
    }
    if (!project || !project.vaultAddress) return;

    let signingAddress = freighterWalletAddress;
    if (!signingAddress) {
      const connectedAddress = await handleConnectWallet();
      if (!connectedAddress) return;
      signingAddress = connectedAddress;
    }

    setIsRefundClaimPending(true);
    try {
      const client = new VaultClient({
        contractId: project.vaultAddress,
        rpcUrl: SOROBAN_RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        ...getSignerOptions(signingAddress),
      });

      const tx = await client.claim_refund({
        contributor: signingAddress,
      });

      await tx.signAndSend();

      toast({
        title: "Refund collected",
        description: "Your stake is back in your wallet.",
      });

      refreshProject(project.id);
      await refreshAfterTx(signingAddress);
    } catch (err: any) {
      console.error("Collect refund failed:", err);
      const simError = (err.simulation as any)?.error;
      const errMsg = simError || err.message || String(err);
      const isAlreadyClaimed = String(errMsg).includes("#9") || String(errMsg).includes("NoFundsToRefund") || String(errMsg).includes("Contract, #9");

      if (isAlreadyClaimed) {
        toast({
          title: "Nothing to collect",
          description:
            "This refund was already collected, or this wallet has no stake in the vault.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't collect your refund",
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

  // ---- Status, money and the primary action, all read from shared helpers ----

  const status = project ? describeStatus(project) : null;

  // An unlisted project is still open to the people who can see it, so the
  // stake decision looks past the hide and only the pause counts.
  const stakeStatus: StatusView | null = project
    ? project.restriction?.hidden && !project.restriction?.locked
      ? describeStatus({ ...project, restriction: null })
      : status
    : null;
  const stakesOpen = stakeStatus?.key === "open";

  const deadline = project ? describeDeadline(project.fundingDeadline) : null;
  const deadlineDate =
    project?.fundingDeadline && Number.isFinite(project.fundingDeadline)
      ? shortDate(project.fundingDeadline)
      : null;

  const raisedView = project
    ? describeMoney(project.currentFunding, projectCurrency, xlmUsd)
    : null;
  const goalView = project ? describeMoney(project.fundingGoal, projectCurrency, xlmUsd) : null;
  const depositView =
    project?.bondPosted && project.bondAmount && project.bondAmount > 0
      ? describeMoney(project.bondAmount, projectCurrency, xlmUsd)
      : null;
  const ownStakeView =
    ownStakeTokens !== null ? describeMoney(ownStakeTokens, projectCurrency, xlmUsd) : null;

  const statsLine: string[] = [];
  if (deadline && deadlineDate) {
    if (deadline.passed) statsLine.push(`Deadline passed ${deadlineDate}`);
    else if (deadline.label === "Ends today") statsLine.push("Ends today");
    else statsLine.push(`Ends ${deadlineDate} (${deadline.label.replace(/ left$/, "")})`);
  }
  if (depositView) statsLine.push(`Builder's deposit ${depositView.primary} locked`);

  // The sentence that stands in for the stake button when stakes are closed.
  const closedReason: { chip: string; sentence: string; chipClass: string } | null = (() => {
    if (!project || !stakeStatus || stakesOpen) return null;
    const chip = stakeStatus.label;
    const chipClass = TONE_CLASSES[stakeStatus.tone];
    switch (stakeStatus.key) {
      case "goal-reached":
      case "building":
        return { chip, chipClass, sentence: "Goal reached, no more stakes needed" };
      case "completed":
        return null; // the completed banner says it all
      case "awaiting-deposit":
        return { chip, chipClass, sentence: "Awaiting the builder's deposit" };
      case "paused":
        return { chip, chipClass, sentence: "Paused by BLKFNDR" };
      case "deadline-passed":
        return {
          chip,
          chipClass,
          sentence:
            "Deadline passed. The vault is closing to new stakes and will say what happens next here.",
        };
      case "goal-not-reached":
      case "returning-money":
        return {
          chip,
          chipClass,
          sentence: deadlineDate ? `Closed to stakes on ${deadlineDate}` : "Closed to stakes",
        };
      default:
        return { chip, chipClass, sentence: stakeStatus.tooltip };
    }
  })();

  // The line under the stake button. A visitor is told what the two steps are;
  // a stakeholder sees their own figure; a signed-in newcomer only the second
  // step, since the first is done.
  const stakeHelper: string | null = isStakeholder
    ? ownStakeView
      ? `Your stake ${ownStakeView.primary}`
      : null
    : !user
      ? "Sign in with Google or email, then approve in a wallet you control. We'll walk you through it."
      : "Approve in a wallet you control. We'll walk you through it.";

  // Manual close, for a vault past its deadline that the cron has not yet
  // settled. Never shown to a visitor.
  const canCloseNow =
    !!project?.vaultAddress &&
    !!user &&
    (isStakeholder || isBuilder) &&
    (project.status === "raising" || project.status === "pending") &&
    typeof project.fundingDeadline === "number" &&
    project.fundingDeadline > 0 &&
    Date.now() >= project.fundingDeadline;

  const hasStageVotes = !!project && STAGE_VOTE_STATUSES.includes(project.status);

  const showsTechnicalDetails = !!(creatorAddress || project?.vaultAddress || canCloseNow);
  const ledgerUrl = project?.vaultAddress
    ? `${EXPLORER_BASE}/contract/${project.vaultAddress}`
    : null;

  const liveFiguresError = error
    ? "We couldn't read this vault's live figures. Try again."
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[92vh] sm:w-full sm:max-h-[90vh]">
        <DialogHeader className="p-4 pb-3 pr-24 sm:p-6 sm:pb-4 sm:pr-28 border-b relative">
          {/* overflow-wrap:anywhere, not break-all. break-all split ordinary
              words at the edge ("Restaurant an / d Bakeshop"); this wraps at
              spaces and still breaks a long unbroken string, without letting
              it widen the dialog. Two lines and no tagline: with three lines
              of title and four of tagline this header, which does not scroll,
              took a third of the dialog. */}
          <DialogTitle
            ref={setTitleEl}
            title={isTitleClamped ? project?.title : undefined}
            className="text-xl sm:text-2xl font-bold font-headline leading-tight [overflow-wrap:anywhere] line-clamp-2 text-left"
          >
            {project?.title || "Reading the vault…"}
          </DialogTitle>
          {project && status && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-left">
              <StatusPill status={status} />
              {project.category && <Badge variant="secondary">{project.category}</Badge>}
              <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarImage
                    src={creatorAvatar ?? project.creatorAvatar}
                    alt=""
                  />
                  <AvatarFallback className="text-[10px]">
                    {creatorDisplayName.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate" title={creatorDisplayName}>
                  {creatorDisplayName}
                </span>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-14 h-7 w-7 sm:top-1.5 sm:right-16 sm:h-8 sm:w-8"
            onClick={() => project && refreshProject(project.id)}
            disabled={isLoading}
            aria-label="Read the vault again"
            title="Read the vault again"
          >
            <RefreshCw className={isLoading ? "animate-spin" : ""} aria-hidden="true" />
          </Button>
        </DialogHeader>

        <ScrollArea className="h-full">
          {isLoading && !project ? (
            <div className="flex flex-col justify-center items-center h-96 gap-3">
              <CubeSpinner size="large" />
              <DialogDescription>Reading the vault…</DialogDescription>
            </div>
          ) : error && !project ? (
            <div className="flex flex-col items-center justify-center h-96 gap-4 text-center px-6">
              <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
              <h3 className="text-xl font-semibold">We couldn&apos;t open this project</h3>
              <DialogDescription className="text-base">{liveFiguresError}</DialogDescription>
            </div>
          ) : (
            project && status && raisedView && goalView && (
              <div className="space-y-4 p-4 sm:p-6">
                <RestrictionNotice restriction={project.restriction} />
                <div className="space-y-1">
                  {isTitleClamped && (
                    <p className="font-headline text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
                      {project.title}
                    </p>
                  )}
                  <DialogDescription className="text-sm sm:text-base leading-snug [overflow-wrap:anywhere]">
                    {/* A loaded project with no tagline is not a project still
                        loading. The old copy said "Fetching details..."
                        forever whenever the metadata carried no description. */}
                    {project.tagline || "No description was published for this project."}
                  </DialogDescription>
                </div>
                <div className="relative h-60 w-full mb-4 rounded-md overflow-hidden">
                  <ImageWithFallback
                    src={project.imageUrl}
                    alt={project.title}
                    className="w-full h-full object-cover"
                    fill
                  />
                </div>

                {/* ---- Money block ---- */}
                <section aria-label="Money in the vault" className="space-y-2">
                  {isLoading ? (
                    <div className="space-y-2" role="status" aria-live="polite">
                      <div className="h-7 w-2/3 rounded bg-muted animate-pulse" />
                      <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
                      <div className="h-2 w-full rounded bg-muted animate-pulse" />
                      <p className="text-sm text-muted-foreground">Reading the vault…</p>
                    </div>
                  ) : (
                    <>
                      {liveFiguresError && (
                        <div
                          role="alert"
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                            {liveFiguresError}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => refreshProject(project.id)}
                          >
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            Try again
                          </Button>
                        </div>
                      )}
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="text-lg sm:text-xl font-semibold text-foreground">
                          {raisedView.primary} staked{" "}
                          <span className="font-normal text-muted-foreground">of</span>{" "}
                          {goalView.primary}
                        </p>
                        <span className="text-sm text-muted-foreground">
                          {fundingPercentage.toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {raisedView.approx && raisedView.secondary
                          ? `${formatToken(project.currentFunding, undefined)} of ${formatToken(project.fundingGoal, projectCurrency)} · dollar estimate, ${describeRateAge(rateUpdatedAt)}`
                          : raisedView.approx
                            ? "Counted in XLM. A dollar estimate isn't available right now."
                            : `Counted in ${projectCurrency}`}
                      </p>
                      <Progress value={fundingPercentage} className="h-2" />
                      {statsLine.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {statsLine.join(" · ")}
                        </p>
                      )}
                    </>
                  )}
                </section>

                <Disclosure summary="What happens to my money?">
                  <ul className="space-y-1.5 text-muted-foreground">
                    {WHAT_HAPPENS_TO_MY_MONEY.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span aria-hidden="true">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </Disclosure>

                {project.description?.trim() && (
                  <div className="prose prose-sm dark:prose-invert max-w-none pt-2">
                    <ExpandableText text={project.description.trim()} lines={6} />
                  </div>
                )}

                {/* Stages sat in the footer, which does not scroll. With a vote
                    open they filled a 768px-high window and left the body
                    above, proof included, zero pixels tall. Votes and proof
                    only exist once a vault has reached its goal; before that
                    the plan shows, so a visitor can see how the money will be
                    released before staking any. */}
                {project.vaultAddress && hasStageVotes ? (
                  <div className="border-t pt-4">
                    <h4 className="font-semibold mb-2">Stages</h4>
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
                ) : (
                  project.milestones &&
                  project.milestones.length > 0 && (
                    <div className="border-t pt-4">
                      <h4 className="font-semibold mb-2">Stages</h4>
                      <MilestonePlan
                        details={project.milestones}
                        currency={project.currencyType ?? "USDC"}
                        goal={project.fundingGoal}
                        note={stagePlanNote(status)}
                      />
                    </div>
                  )
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
                  <h4 className="font-semibold mb-2">Builder</h4>
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage
                        src={creatorAvatar ?? project.creatorAvatar}
                        alt=""
                      />
                      <AvatarFallback>
                        {creatorDisplayName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <p
                      className="min-w-0 text-sm font-semibold text-foreground truncate"
                      title={creatorDisplayName}
                    >
                      {creatorDisplayName}
                    </p>
                  </div>
                </div>

                {/* ---- Public record, Phase 1 variant ---- */}
                {ledgerUrl && (
                  <Card className="border-border/60 bg-muted/20">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-base">The full money record is coming.</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2 text-sm">
                      <p className="text-muted-foreground">
                        For now, every entry for this vault is on the public ledger.
                      </p>
                      <a
                        href={ledgerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        Open on the public ledger (stellar.expert)
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                      <p className="text-xs text-muted-foreground">{EXPLORER_EXPLAINER}</p>
                    </CardContent>
                  </Card>
                )}

                <ProjectRestrictionControls
                  project={project}
                  onChanged={() => {
                    refreshProject(project.id);
                    refreshProjects();
                  }}
                />

                {/* ---- Technical details: the only place an address appears ---- */}
                {showsTechnicalDetails && (
                  <Disclosure summary="Technical details">
                    <dl className="space-y-3">
                      {creatorAddress && (
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            Builder&apos;s account ID
                          </dt>
                          <dd className="font-mono text-xs break-all">{creatorAddress}</dd>
                        </div>
                      )}
                      {project.vaultAddress && (
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            Vault address
                          </dt>
                          <dd className="font-mono text-xs break-all">{project.vaultAddress}</dd>
                        </div>
                      )}
                      {ledgerUrl && (
                        <div>
                          <a
                            href={ledgerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            Open this vault on the public ledger (stellar.expert)
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                          <p className="text-xs text-muted-foreground">{EXPLORER_EXPLAINER}</p>
                        </div>
                      )}
                      {canCloseNow && (
                        <div className="space-y-1.5 border-t border-border/60 pt-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCloseNow}
                            disabled={isClosePending}
                          >
                            {isClosePending && <CubeSpinner />}
                            Close it now
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Anyone can do this; it costs a small network fee from
                            your wallet. BLKFNDR does it automatically within a day.
                          </p>
                        </div>
                      )}
                    </dl>
                  </Disclosure>
                )}
              </div>
            )
          )}
        </ScrollArea>

        {project && status && (
          <DialogFooter className="p-4 sm:p-6 border-t flex-col items-stretch gap-3">
            {project.status === "completed" && (
              <div
                role="status"
                className="w-full text-xs text-green-700 dark:text-green-400 font-medium py-2 px-3 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-200 dark:border-green-800/30 text-center"
              >
                Completed. Every stage was approved and paid to the builder.
              </div>
            )}

            <div className="flex w-full flex-col sm:flex-row gap-2 justify-end items-stretch sm:items-center">
              {/* Collect a refund once the vault is returning money. */}
              {isStakeholder && (project.status === "failed" || project.status === "refunding") && (
                <Button
                  onClick={handleCollectRefund}
                  disabled={isRefundClaimPending || isRefundClaimed}
                  variant={isRefundClaimed ? "outline" : "destructive"}
                  className="w-full sm:w-auto whitespace-nowrap shrink-0"
                >
                  {isRefundClaimPending && <CubeSpinner />}
                  {isRefundClaimed ? "Refund collected" : "Collect your refund"}
                </Button>
              )}

              {/* The one primary action. While stakes are open (or a stake is
                  already under way) it is FundDialog, triggered exactly as
                  before; otherwise a chip and one sentence say why not. */}
              {stakesOpen || isFundFlow ? (
                <div className={cn("flex flex-col gap-1.5", isFundFlow ? "w-full" : "w-full sm:w-auto sm:items-end")}>
                  <FundDialog
                    project={project}
                    isFundFlow={isFundFlow}
                    setIsFundFlow={setIsFundFlow}
                  />
                  {!isFundFlow && stakeHelper && (
                    <p className="text-xs text-muted-foreground sm:text-right">{stakeHelper}</p>
                  )}
                </div>
              ) : closedReason ? (
                <div className="flex w-full flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                  <Badge
                    variant="outline"
                    className={cn("w-fit whitespace-nowrap", closedReason.chipClass)}
                  >
                    {closedReason.chip}
                  </Badge>
                  <p className="text-sm text-muted-foreground">{closedReason.sentence}</p>
                </div>
              ) : null}
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
