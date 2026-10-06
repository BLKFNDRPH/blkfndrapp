"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FundDialog } from "./FundDialog";
import { RefundSheet } from "./RefundSheet";
import { MoneyActionPanel } from "@/components/money-action/MoneyActionPanel";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { Progress } from "@/components/ui/progress";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { MilestonePlan, MilestoneVoting, type MilestoneVaultState } from "./MilestoneVoting";
import { ExpandableText } from "@/components/ui/expandable-text";
import { MilestoneProofDialog, MilestoneProofView, parseProof } from "./MilestoneProof";
import { ProjectLocation } from "./ProjectLocation";
import { RestrictionNotice } from "./RestrictionNotice";
import { ProjectRestrictionControls } from "../admin/ProjectRestrictionControls";
import {
  RefreshCw,
  AlertTriangle,
  ImagePlus,
  PauseCircle,
  ExternalLink,
  ChevronDown,
  ArrowLeft,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { StellarFormatter } from "@/lib/stellar-format";
import {
  useRefreshAfterTx,
  useBlockchain,
} from "@/context/BlockchainContext";
import { cn } from "@/lib/utils";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getUserByCreatorId } from "@/lib/data.client";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { describeMoney, describeRateAge, formatToken } from "@/lib/money";
import { useXlmRate } from "@/lib/xlm-rate";
import {
  describeStatus,
  describeDeadline,
  TONE_CLASSES,
  type StatusView,
} from "@/lib/project-status";
import { EXPLORER_BASE, EXPLORER_EXPLAINER } from "@/lib/network";
import { projectHref, PROJECTS_PATH, type ProjectTab } from "@/lib/project-href";
import type { Project } from "@/lib/types";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar";

/** The vault counts in stroops; a person reads whole tokens. */
const STROOPS = 10_000_000;

/** A Stellar account or contract address, which must never stand in for a name. */
const looksLikeAddress = (s: string) => /^[GC][A-Z2-7]{55}$/.test(s);

/** "14 Mar", the way the deadline is spoken everywhere on the page. */
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** The four promises under the money block. Exact copy from the brief. */
const WHAT_HAPPENS_TO_MY_MONEY = [
  "It goes into this project's vault, not to BLKFNDR.",
  "If the goal isn't reached by the deadline, you collect it back.",
  "Once the goal is reached, the builder is paid stage by stage, each time stakeholders vote yes.",
  "If a stage fails the vote, what's left and the builder's deposit come back to stakeholders.",
];

const TABS: { value: ProjectTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "stages", label: "Stages" },
  { value: "record", label: "Record" },
  { value: "builder", label: "Builder" },
];

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

/** "Stage 1 · Foundations · $1,000 · Paid to the builder", one line per stage. */
function StagePlan({
  project,
  currency,
  xlmUsd,
}: {
  project: Project;
  currency: string;
  xlmUsd: number | null;
}) {
  const stages = project.milestones ?? [];
  if (stages.length === 0) return null;
  const notStarted = project.status === "raising" || project.status === "pending";
  return (
    <ol className="space-y-1.5 text-sm">
      {stages.map((m) => {
        const state = m.released
          ? "Paid to the builder"
          : notStarted
            ? "Not started"
            : "Not yet paid";
        return (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground">
            <span className="font-medium text-foreground">Stage {m.id}</span>
            {m.title?.trim() && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-foreground [overflow-wrap:anywhere]">{m.title.trim()}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{describeMoney(m.amount, currency, xlmUsd).primary}</span>
            <span aria-hidden="true">·</span>
            <span>{state}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** What the builder can do on their own project's page, and where. */
function BuilderCard({ onGoToStages }: { onGoToStages?: () => void }) {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          You&apos;re the builder
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 pt-0 text-sm">
        <p className="text-muted-foreground">
          Add proof for a stage, ask stakeholders for a payout, and see every stake.
        </p>
        {onGoToStages && (
          <Button type="button" size="sm" variant="outline" onClick={onGoToStages}>
            Go to stages
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One project, as a page: its money, its stages, its record and its builder,
 * and the only place the primary money action lives. Reads the project from
 * ProjectDetailsContext; the page that mounts it asks the provider to load the
 * id and keeps the active tab in the address.
 */
export function ProjectView({
  tab,
  onTabChange,
}: {
  tab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
}) {
  const {
    project,
    isFundFlow,
    setIsFundFlow,
    refreshProject,
    isLoading,
    error,
  } = useProjectDetails();

  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const refreshAfterTx = useRefreshAfterTx();
  const { prepareSettleVault } = useStellarContract();
  const { userFunds, refreshUserFunds, refreshProjects, projects } = useBlockchain();
  const { rate: xlmUsd, updatedAt: rateUpdatedAt } = useXlmRate();
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Money actions on this page set up or reconnect the wallet inside their own
  // panels (MoneyActionPanel, the stake and refund sheets), so the page itself
  // only reads which wallet is connected.
  const { freighterWalletAddress } = useFreighterWallet();

  // The refund sheet and the vault-close panel open in place, like the stake sheet.
  const [isRefundOpen, setIsRefundOpen] = useState(false);
  const [isCloseVaultOpen, setIsCloseVaultOpen] = useState(false);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [creatorAvatar, setCreatorAvatar] = useState<string | null>(null);

  // Each stage has its own proof, posted from its own card. The form opens for
  // one stage at a time; `proofSession` remounts it so it always starts from
  // that stage's saved proof, and the id outlives the closing animation.
  const [proofMilestoneId, setProofMilestoneId] = useState<number | null>(null);
  const [isProofFormOpen, setIsProofFormOpen] = useState(false);
  const [proofSession, setProofSession] = useState(0);
  // Proof saved from this page, keyed by project and stage. The card shows it
  // straight away instead of waiting for the project to be read back.
  const [savedProofs, setSavedProofs] = useState<Record<string, string>>({});
  const proofOpenerRef = useRef<HTMLElement | null>(null);

  // The stake sheet, when it is open inline on a phone, so it can be brought
  // into view.
  const inlineActionRef = useRef<HTMLDivElement | null>(null);

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
  // For the "You're the builder" card only: the account that listed it also
  // counts, even before it has linked the wallet the controls need.
  const isOwnProject =
    isBuilder || (!!project?.creatorId && !!user?.uid && project.creatorId === user.uid);

  // A platform pause stops the builder's actions here — proof, and opening a
  // stage vote — and new stakes in FundDialog. Everything a stakeholder does
  // with money already in the vault is untouched.
  const isLocked = project?.restriction?.locked === true;

  // Stakeholders vote on a payout, and the admin console's "Verify" opens this
  // page, so the proof sits in each stage's card, beside its vote. The builder
  // adds or edits it there, one stage at a time, while the vault is building;
  // once a stage is paid out or has failed its vote is over and the proof
  // stays as it was voted on.
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

  const projectId = project?.id;
  const vaultAddress = project?.vaultAddress;
  useEffect(() => {
    if (projectId && activeAddress) {
      refreshUserFunds(activeAddress);

      fetch(`/api/user/contributions?address=${activeAddress}&projectId=${projectId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setHasContributedHistorically(!!data.hasContributed);
          }
        })
        .catch((err) => {
          console.error("Failed to check stake history:", err);
        });

      if (vaultAddress) {
        const checkVaultBalance = async () => {
          try {
            const client = new VaultClient({
              contractId: vaultAddress,
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
  }, [activeAddress, projectId, vaultAddress, refreshUserFunds]);

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

  // On a phone the stake and refund sheets open in the flow of the page, under
  // the money block, so bring them into view when they do.
  const isSheetOpen = isFundFlow || isRefundOpen;
  useEffect(() => {
    if (isSheetOpen && !isDesktop) {
      inlineActionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isSheetOpen, isDesktop]);

  // handlePostBond is gone: the builder's deposit is transferred during
  // create_vault, so a vault either exists with its deposit locked or does not
  // exist.

  if (!project) return null;

  const fundingPercentage =
    project.status === "completed"
      ? 100
      : StellarFormatter.getPercentage(
          project.currentFundingRaw,
          project.fundingGoalRaw,
        );

  // ---- Status, money and the primary action, all read from shared helpers ----

  const status = describeStatus(project);

  // An unlisted project is still open to the people who can see it, so the
  // stake decision looks past the hide and only the pause counts.
  const stakeStatus: StatusView =
    project.restriction?.hidden && !project.restriction?.locked
      ? describeStatus({ ...project, restriction: null })
      : status;
  const stakesOpen = stakeStatus.key === "open";

  const deadline = describeDeadline(project.fundingDeadline);
  const deadlineDate =
    project.fundingDeadline && Number.isFinite(project.fundingDeadline)
      ? shortDate(project.fundingDeadline)
      : null;

  const raisedView = describeMoney(project.currentFunding, projectCurrency, xlmUsd);
  const goalView = describeMoney(project.fundingGoal, projectCurrency, xlmUsd);
  const depositView =
    project.bondPosted && project.bondAmount && project.bondAmount > 0
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
    if (stakesOpen) return null;
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

  // Recording a passed deadline on the vault. The governance keeper does this
  // on its own (src/lib/governance-keeper.ts), and refunds work without it
  // (the vault works out its own state), so it is a small tidy-up kept under
  // Technical details for anyone who wants it sooner. Never shown to a visitor.
  const canCloseNow =
    !!project.vaultAddress &&
    !!user &&
    (isStakeholder || isBuilder) &&
    (project.status === "raising" || project.status === "pending") &&
    typeof project.fundingDeadline === "number" &&
    project.fundingDeadline > 0 &&
    Date.now() >= project.fundingDeadline;

  const showsTechnicalDetails = !!(creatorAddress || project.vaultAddress || canCloseNow);
  const ledgerUrl = project.vaultAddress
    ? `${EXPLORER_BASE}/contract/${project.vaultAddress}`
    : null;

  const liveFiguresError = error
    ? "We couldn't read this vault's live figures. Try again."
    : null;

  // Returning money: a stage failed, the builder went quiet, or the deadline
  // passed short of the goal. The last can still be listed as raising until
  // the vault is next touched; the vault itself already counts it as failed,
  // and the refund sheet reads the vault, not the listing.
  const missedGoal =
    project.status === "raising" &&
    typeof project.fundingDeadline === "number" &&
    project.fundingDeadline > 0 &&
    Date.now() >= project.fundingDeadline &&
    project.currentFunding < project.fundingGoal;
  const canCollectRefund =
    isStakeholder &&
    (project.status === "failed" || project.status === "refunding" || missedGoal);

  const showsStageVoting =
    !!project.vaultAddress &&
    ["funded", "active", "completed", "refunding"].includes(project.status);

  // The builder's other listings, from the list already in hand. Matched on
  // the address the vault records, so a renamed profile still lines up.
  const otherProjects =
    creatorAddress !== ""
      ? projects.filter(
          (p) => p.id !== project.id && (p.creatorAddress ?? p.creator) === creatorAddress,
        )
      : [];

  const builderIdentity = (size: "sm" | "md") => (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className={cn("shrink-0", size === "sm" ? "h-5 w-5" : "h-10 w-10")}>
        <AvatarImage src={creatorAvatar ?? project.creatorAvatar} alt="" />
        <AvatarFallback className={size === "sm" ? "text-[10px]" : undefined}>
          {creatorDisplayName.charAt(0)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "min-w-0 truncate",
          size === "sm" ? "text-sm text-muted-foreground" : "text-base font-semibold text-foreground",
        )}
        title={creatorDisplayName}
      >
        {creatorDisplayName}
      </span>
    </div>
  );

  // ---- Money block ----
  const moneyBlock = (
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
  );

  // ---- Collecting a refund: a button, then the refund sheet in its place ----
  const openRefund = () => {
    // A stakeholder who pressed it in the Stages tab sees the sheet open in the
    // action area, so bring that into view on a phone.
    setIsRefundOpen(true);
  };
  const refundButton = canCollectRefund ? (
    isRefundOpen ? (
      <RefundSheet project={project} onClose={() => setIsRefundOpen(false)} />
    ) : (
      <Button
        onClick={openRefund}
        disabled={isRefundClaimed}
        variant={isRefundClaimed ? "outline" : "default"}
        className="w-full sm:w-auto whitespace-nowrap shrink-0"
      >
        {isRefundClaimed ? "Refund collected" : "Collect your refund"}
      </Button>
    )
  ) : null;

  const actionArea = (
    <div className="flex flex-col items-stretch gap-3">
      {project.status === "completed" && (
        <div
          role="status"
          className="w-full text-xs text-green-700 dark:text-green-400 font-medium py-2 px-3 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-200 dark:border-green-800/30 text-center"
        >
          Completed. Every stage was approved and paid to the builder.
        </div>
      )}

      <div className="flex w-full flex-col sm:flex-row gap-2 justify-end items-stretch sm:items-center lg:flex-col lg:items-stretch">
        {/* Collect a refund once the vault is returning money. */}
        {refundButton}

        {/* The one primary action. While stakes are open (or a stake is
            already under way) it is FundDialog, triggered exactly as before;
            otherwise a chip and one sentence say why not. */}
        {stakesOpen || isFundFlow ? (
          <div
            className={cn(
              "flex flex-col gap-1.5",
              isFundFlow ? "w-full" : "w-full sm:w-auto sm:items-end lg:w-full lg:items-stretch",
            )}
          >
            <FundDialog
              project={project}
              isFundFlow={isFundFlow}
              setIsFundFlow={setIsFundFlow}
            />
            {!isFundFlow && stakeHelper && (
              <p className="text-xs text-muted-foreground sm:text-right lg:text-left">{stakeHelper}</p>
            )}
          </div>
        ) : closedReason ? (
          <div className="flex w-full flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-end sm:gap-3 lg:flex-col lg:items-start">
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
    </div>
  );

  // The one place the action area renders. Desktop: the sticky card on the
  // right. Phone: a bar pinned to the bottom, which turns into an in-flow
  // card under the money block while the stake sheet is open, since a form
  // does not fit in a bar.
  const hasAction =
    stakesOpen || isFundFlow || !!closedReason || !!refundButton || project.status === "completed";

  const technicalDetails = showsTechnicalDetails && (
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
            {isCloseVaultOpen ? (
              <MoneyActionPanel
                context={{ action: "close-vault" }}
                title="Record the deadline on the vault"
                sentence="This writes on the vault that its deadline has passed, so its status catches up everywhere. Refunds already work without it. Nothing leaves your wallet except a small network fee."
                rows={[]}
                walletShows="a request to update the vault, with no money moving"
                prepare={() => prepareSettleVault(project.vaultAddress!)}
                successTitle="The vault has recorded its deadline."
                onSuccess={() => {
                  refreshProject(project.id);
                  refreshAfterTx(freighterWalletAddress ?? undefined);
                }}
                onClose={() => setIsCloseVaultOpen(false)}
              />
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCloseVaultOpen(true)}
                >
                  Close it now
                </Button>
                <p className="text-xs text-muted-foreground">
                  Records on the vault that its deadline has passed. Refunds work without it. Anyone
                  can do this for a small network fee from their wallet.
                </p>
              </>
            )}
          </div>
        )}
      </dl>
    </Disclosure>
  );

  return (
    <div
      className={cn(
        "container mx-auto px-4 pt-6 sm:px-6 lg:px-8 lg:pb-12",
        !isDesktop && hasAction && !isSheetOpen ? "pb-36" : "pb-12",
      )}
    >
      {/* ---- Header ---- */}
      <header className="space-y-3 border-b pb-4">
        <Link
          href={PROJECTS_PATH}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Projects
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {/* overflow-wrap:anywhere, not break-all. break-all split ordinary
                words at the edge ("Restaurant an / d Bakeshop"); this wraps at
                spaces and still breaks a long unbroken string. */}
            <h1 className="text-2xl sm:text-3xl font-bold font-headline leading-tight [overflow-wrap:anywhere]">
              {project.title}
            </h1>
            <p className="text-sm sm:text-base leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {/* A loaded project with no tagline is not a project still loading. */}
              {project.tagline || "No description was published for this project."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => refreshProject(project.id)}
            disabled={isLoading}
            aria-label="Read the vault again"
            title="Read the vault again"
          >
            <RefreshCw className={isLoading ? "animate-spin" : ""} aria-hidden="true" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusPill status={status} />
          {project.category && <Badge variant="secondary">{project.category}</Badge>}
          {builderIdentity("sm")}
        </div>
        <RestrictionNotice restriction={project.restriction} />
        <ProjectRestrictionControls
          project={project}
          onChanged={() => {
            refreshProject(project.id);
            refreshProjects();
          }}
        />
      </header>

      <div className="pt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8">
        {/* ---- Content ---- */}
        <div className="min-w-0 space-y-4">
          {!isDesktop && (
            <>
              {moneyBlock}
              {isSheetOpen && hasAction && (
                <div ref={inlineActionRef} className="rounded-lg border bg-card p-4">
                  {actionArea}
                </div>
              )}
            </>
          )}

          <Tabs value={tab} onValueChange={(value) => onTabChange(value as ProjectTab)}>
            <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
              <TabsList className="w-max justify-start sm:w-auto">
                {TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* ---- Overview ---- */}
            <TabsContent value="overview" className="space-y-4 pt-2">
              {isOwnProject && <BuilderCard onGoToStages={() => onTabChange("stages")} />}

              <div className="relative h-60 w-full rounded-md overflow-hidden sm:h-72">
                <ImageWithFallback
                  src={project.imageUrl}
                  alt={project.title}
                  className="w-full h-full object-cover"
                  fill
                />
              </div>

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

              {/* A six-line preview with Read more that keeps the author's line
                  breaks (QA BUG-010, landed in the old dialog by #109). */}
              {project.description?.trim() && (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ExpandableText text={project.description.trim()} lines={6} />
                </div>
              )}

              {(project.location || project.locationLat != null) && (
                <div className="border-t pt-4">
                  <h2 className="font-semibold mb-2">Location</h2>
                  <ProjectLocation
                    location={project.location}
                    lat={project.locationLat}
                    lng={project.locationLng}
                  />
                </div>
              )}

              {(project.milestones?.length ?? 0) > 0 && (
                <div className="border-t pt-4">
                  <h2 className="font-semibold mb-2">Stage plan</h2>
                  <StagePlan project={project} currency={projectCurrency} xlmUsd={xlmUsd} />
                </div>
              )}
            </TabsContent>

            {/* ---- Stages ---- */}
            <TabsContent value="stages" className="space-y-4 pt-2">
              {isOwnProject && <BuilderCard />}

              <h2 className="font-semibold">Stakeholders decide every payout</h2>

              {/* Proof only exists once a vault has reached its goal, which is
                  when the votes show. Before that, the plan from the listing:
                  each stage's amount, its share of the goal and what it
                  delivers, so a visitor sees how the money will be released
                  before staking any (QA BUG-006, landed in the old dialog by
                  #109). */}
              {showsStageVoting ? (
                <MilestoneVoting
                  vaultAddress={project.vaultAddress!}
                  currency={project.currencyType ?? "USDC"}
                  creatorAddress={project.creatorAddress ?? project.creator}
                  platformLocked={isLocked}
                  details={project.milestones}
                  renderProof={renderMilestoneProof}
                  onChange={() => refreshProject(project.id)}
                  onCollectRefund={canCollectRefund ? openRefund : undefined}
                />
              ) : (project.milestones?.length ?? 0) > 0 ? (
                <MilestonePlan
                  details={project.milestones ?? []}
                  currency={project.currencyType ?? "USDC"}
                  goal={project.fundingGoal}
                  note={stagePlanNote(status)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">This project has no stages yet.</p>
              )}

              {/* A vault that missed its goal shows the plan, not the votes, so
                  its refund button sits here. A failed stage carries its own
                  button in the stage card. The sheet itself opens in the
                  action area, never twice. */}
              {canCollectRefund && !showsStageVoting && !isRefundOpen && !isRefundClaimed && (
                <div className="border-t pt-4">
                  <Button onClick={openRefund} className="w-full sm:w-auto">
                    Collect your refund
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ---- Record ---- */}
            <TabsContent value="record" className="space-y-4 pt-2">
              {/* Public record, Phase 1 variant */}
              {ledgerUrl ? (
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
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing recorded yet. The vault opens when the builder&apos;s deposit lands.
                </p>
              )}

              {/* Technical details: the only place an address appears */}
              {technicalDetails}
            </TabsContent>

            {/* ---- Builder ---- */}
            <TabsContent value="builder" className="space-y-4 pt-2">
              <div className="space-y-1">
                {builderIdentity("md")}
                <p className="text-sm text-muted-foreground">Listed by the builder</p>
              </div>

              {otherProjects.length > 0 && (
                <div className="border-t pt-4">
                  <h2 className="font-semibold mb-2">Also listed by this builder</h2>
                  <ul className="space-y-2">
                    {otherProjects.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={projectHref(p.id)}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm hover:bg-muted/40"
                        >
                          <span className="min-w-0 truncate font-medium">{p.title}</span>
                          <StatusPill status={describeStatus(p)} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* ---- Desktop: money and the action, in a sticky card ---- */}
        {isDesktop && (
          <aside className="sticky top-24 space-y-4 rounded-lg border bg-card p-5">
            {moneyBlock}
            {hasAction && <div className="border-t pt-4">{actionArea}</div>}
          </aside>
        )}
      </div>

      {/* ---- Phone: the action pinned to the bottom ---- */}
      {!isDesktop && hasAction && !isSheetOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="container mx-auto px-1 sm:px-3">{actionArea}</div>
        </div>
      )}

      {project.vaultAddress && (
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
    </div>
  );
}
