"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, Check, ExternalLink, Info, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Project } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { useRefreshAfterTx } from "@/context/BlockchainContext";
import { useStellarContract, type PreparedAction, type SendPhase } from "@/hooks/use-stellar-contract";
import { vaultClient, simulate } from "@/lib/stellar-clients";
import { currencyForToken } from "@/lib/currencies";
import {
  formatToken,
  formatUsd,
  isDollarToken,
  parseAmount,
  rawToInput,
  rawToUnits,
  describeRateAge,
} from "@/lib/money";
import { useXlmRate } from "@/lib/xlm-rate";
import { describeDeadline } from "@/lib/project-status";
import { EXPLORER_BASE, EXPLORER_EXPLAINER, IS_PRACTICE_NETWORK } from "@/lib/network";
import { explainError, type Outcome, type OutcomeIntent } from "@/lib/explain-error";
import { readWalletReadiness, type WalletReadiness } from "@/lib/wallet-readiness";
import { WalletPanel } from "@/components/settings/WalletSettings";
import { OutcomeCard } from "@/components/money-action/OutcomeCard";
import { WalletConfirm } from "@/components/money-action/WalletConfirm";
import {
  WalletReadinessCard,
  gatePasses,
  readinessState,
} from "./WalletReadinessCard";

/**
 * The stake sheet: an amount, the honest cost, what happens to the money, and
 * every gate as a card inside the sheet rather than a wall in front of it.
 *
 * It opens for everyone, signed in or not, so a person can read exactly what
 * staking involves before being asked for anything. The steps after "Review
 * and confirm" are: the vault simulates the stake (its refusals surface here,
 * before any wallet window), a preview of what the wallet will show, the
 * wallet itself, the send, the ledger, and a receipt in place. Every failure
 * becomes an outcome card from explainError.
 *
 * Amounts are handled in base units as bigint throughout; numbers only for
 * display.
 */

type Step =
  | { kind: "form" }
  | { kind: "preparing"; amountRaw: bigint }
  | { kind: "confirm"; amountRaw: bigint; prepared: PreparedAction; phase: SendPhase | null }
  | { kind: "done"; amountRaw: bigint; hash: string | null; at: number }
  | { kind: "outcome"; amountRaw: bigint | null; outcome: Outcome; hash?: string | null };

interface VaultTerms {
  minRaw: bigint;
  goalRaw: bigint;
  raisedRaw: bigint;
  deadlineMs: number | null;
  token: string | null;
}

/** Presets in whole units of the vault's currency. */
const DOLLAR_PRESETS = [5, 25, 100];
const XLM_PRESETS = [100, 500, 2000];
/** Offer "the remainder" as a preset when less than this is left. */
const REMAINDER_PRESET_BELOW = 500n * 10_000_000n;

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function termsFromListing(project: Project): VaultTerms {
  return {
    minRaw: 0n,
    goalRaw: BigInt(project.fundingGoalRaw || "0"),
    raisedRaw: BigInt(project.currentFundingRaw || "0"),
    deadlineMs: project.fundingDeadline ?? null,
    token: null,
  };
}

export function StakeSheet({ project, onClose }: { project: Project; onClose: () => void }) {
  const { user } = useAuth();
  const { freighterWalletAddress } = useFreighterWallet();
  const { refreshProject, signInToContinue } = useProjectDetails();
  const refreshAfterTx = useRefreshAfterTx();
  const { prepareContribute } = useStellarContract();
  const { rate: xlmUsd, updatedAt: rateAt } = useXlmRate();

  const [step, setStep] = useState<Step>({ kind: "form" });
  const [amount, setAmount] = useState("");
  const [terms, setTerms] = useState<VaultTerms>(() => termsFromListing(project));
  const [termsLoaded, setTermsLoaded] = useState(false);
  const [readiness, setReadiness] = useState<WalletReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const prefilled = useRef(false);
  const readRequest = useRef(0);

  // ── The vault's own terms, fresher than the listing ─────────────────────
  useEffect(() => {
    const vaultAddress = project.vaultAddress;
    if (!vaultAddress) {
      setTermsLoaded(true);
      return;
    }
    let cancelled = false;
    simulate(() => vaultClient(vaultAddress).get_info(), `get_info(${vaultAddress})`).then(
      (info) => {
        if (cancelled) return;
        if (info) {
          setTerms({
            minRaw: BigInt(info.min_contribution),
            goalRaw: BigInt(info.goal),
            raisedRaw: BigInt(info.raised_amount),
            deadlineMs: Number(info.deadline) * 1000,
            token: String(info.token),
          });
        }
        setTermsLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [project.vaultAddress]);

  // The deadline can pass while the sheet is open.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ── Currency and display ────────────────────────────────────────────────
  const currency = (currencyForToken(terms.token ?? undefined) ??
    project.currencyType ??
    "USDC") as string;
  const isDollar = isDollarToken(currency);

  /** "$50.00" for a dollar vault; "166 XLM (≈ $25)" for an XLM vault. */
  const display = useCallback(
    (raw: bigint, cents: "auto" | "always" = "auto") => {
      const units = rawToUnits(raw);
      if (isDollar) return formatUsd(units, cents);
      const xlm = formatToken(units, "XLM");
      return xlmUsd ? `${xlm} (≈ ${formatUsd(units * xlmUsd, "never")})` : xlm;
    },
    [isDollar, xlmUsd],
  );
  /** The bare figure, no estimate: for buttons and chips. */
  const plain = useCallback(
    (raw: bigint) => (isDollar ? formatUsd(rawToUnits(raw)) : formatToken(rawToUnits(raw), "XLM")),
    [isDollar],
  );

  // ── Amount and limits ───────────────────────────────────────────────────
  const remainingRaw = terms.goalRaw > terms.raisedRaw ? terms.goalRaw - terms.raisedRaw : 0n;
  const minRaw = terms.minRaw;
  const amountRaw = parseAmount(amount);
  const deadlinePassed = terms.deadlineMs !== null && terms.deadlineMs > 0 && terms.deadlineMs <= now;
  const isLocked = project.restriction?.locked === true;
  const goalReached = remainingRaw === 0n;
  const remainderTooSmall = !goalReached && minRaw > 0n && remainingRaw < minRaw;
  const closedReason = isLocked
    ? "This project paused new stakes. Votes and refunds still work."
    : deadlinePassed
      ? "The deadline passed while you were here."
      : goalReached
        ? "The goal was reached, so no more stakes are needed."
        : remainderTooSmall
          ? `Only ${plain(remainingRaw)} is left to reach the goal, which is under the ${plain(minRaw)} minimum, so this vault can't take another stake.`
          : null;

  // A near-complete vault: prefill what is left, once, and say why.
  const nearGoal = !closedReason && minRaw > 0n && remainingRaw >= minRaw && remainingRaw < minRaw * 2n;
  useEffect(() => {
    if (termsLoaded && nearGoal && !prefilled.current) {
      prefilled.current = true;
      setAmount(rawToInput(remainingRaw));
    }
  }, [termsLoaded, nearGoal, remainingRaw]);

  const validation: { message: string; chip?: bigint } | null = (() => {
    if (closedReason || amountRaw === null || amountRaw === 0n) return null;
    if (minRaw > 0n && amountRaw < minRaw) return { message: `Minimum stake is ${display(minRaw)}.` };
    if (amountRaw > remainingRaw) {
      return {
        message: `Only ${plain(remainingRaw)} is left to reach the goal.`,
        chip: remainingRaw >= minRaw ? remainingRaw : undefined,
      };
    }
    return null;
  })();
  const amountValid = !closedReason && amountRaw !== null && amountRaw > 0n && validation === null;

  const presets = useMemo(() => {
    const units = isDollar ? DOLLAR_PRESETS : XLM_PRESETS;
    const list = units
      .map((u) => BigInt(u) * 10_000_000n)
      .map((raw) => (raw < minRaw ? minRaw : raw))
      .filter((raw) => raw > 0n && raw <= remainingRaw);
    const unique = Array.from(new Set(list.map(String))).map((s) => BigInt(s));
    const withRemainder =
      remainingRaw > 0n && remainingRaw >= minRaw && remainingRaw < REMAINDER_PRESET_BELOW && !unique.includes(remainingRaw)
        ? [...unique, remainingRaw]
        : unique;
    return withRemainder.map((raw) => ({ raw, isRemainder: raw === remainingRaw }));
  }, [isDollar, minRaw, remainingRaw]);

  // ── Wallet readiness ────────────────────────────────────────────────────
  const refreshReadiness = useCallback(async () => {
    const request = ++readRequest.current;
    if (!freighterWalletAddress || !terms.token) {
      setReadiness(null);
      return;
    }
    setReadinessLoading(true);
    const result = await readWalletReadiness(freighterWalletAddress, terms.token);
    if (request !== readRequest.current) return;
    setReadiness(result);
    setReadinessLoading(false);
  }, [freighterWalletAddress, terms.token]);

  useEffect(() => {
    refreshReadiness();
  }, [refreshReadiness]);

  // Back from the faucet tab or the wallet: read again.
  useEffect(() => {
    const onFocus = () => {
      if (step.kind === "form") refreshReadiness();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshReadiness, step.kind]);

  const state = readinessState(readiness, readinessLoading || (!!freighterWalletAddress && !readiness && !!terms.token), amountValid ? amountRaw : null);
  const gateOpen = !!user && !!freighterWalletAddress && (gatePasses(state) || !terms.token);
  const canReview = amountValid && gateOpen && step.kind === "form";

  // ── The money action ────────────────────────────────────────────────────
  const explainCtx = {
    action: "stake" as const,
    minimum: display(minRaw),
    remaining: plain(remainingRaw),
    remainingStakeable: remainingRaw >= minRaw && remainingRaw > 0n,
    deadline: terms.deadlineMs ? shortDate(terms.deadlineMs) : undefined,
  };

  const prepare = async (raw: bigint) => {
    if (!project.vaultAddress) return;
    setStep({ kind: "preparing", amountRaw: raw });
    try {
      const prepared = await prepareContribute({ vaultAddress: project.vaultAddress, amount: raw });
      setStep({ kind: "confirm", amountRaw: raw, prepared, phase: null });
    } catch (error) {
      console.warn("[StakeSheet] prepare refused:", error);
      setStep({ kind: "outcome", amountRaw: raw, outcome: explainError(error, explainCtx) });
    }
  };

  const send = async () => {
    if (step.kind !== "confirm") return;
    const { prepared, amountRaw: raw } = step;
    const setPhase = (phase: SendPhase) =>
      setStep((s) => (s.kind === "confirm" ? { ...s, phase } : s));
    try {
      const { hash } = await prepared.send(setPhase);
      setStep({ kind: "done", amountRaw: raw, hash, at: Date.now() });
      // The figures behind the sheet catch up while the receipt shows.
      refreshProject(project.id);
      refreshAfterTx(freighterWalletAddress ?? undefined);
    } catch (error) {
      console.warn("[StakeSheet] send ended without a stake:", error);
      const hash = (error as { hash?: string | null })?.hash ?? null;
      setStep({ kind: "outcome", amountRaw: raw, outcome: explainError(error, explainCtx), hash });
    }
  };

  const onIntent = (intent: OutcomeIntent) => {
    const raw = step.kind === "outcome" ? step.amountRaw : null;
    switch (intent) {
      case "retry":
        if (raw) prepare(raw);
        else setStep({ kind: "form" });
        return;
      case "close":
        onClose();
        return;
      case "stake-remainder":
        setAmount(rawToInput(remainingRaw));
        setStep({ kind: "form" });
        return;
      case "fix-wallet":
        setStep({ kind: "form" });
        refreshReadiness();
        return;
      case "edit-amount":
        setStep({ kind: "form" });
        return;
      case "check-activity":
        window.location.assign("/profile");
        return;
      case "public-record": {
        const hash = step.kind === "outcome" ? step.hash : null;
        const url = hash
          ? `${EXPLORER_BASE}/tx/${hash}`
          : `${EXPLORER_BASE}/contract/${project.vaultAddress ?? ""}`;
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
    }
  };

  // ── Rendering ───────────────────────────────────────────────────────────
  const deadline = describeDeadline(terms.deadlineMs, now);
  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
          <span className="[overflow-wrap:anywhere]">Stake in {project.title}</span>
          {IS_PRACTICE_NETWORK && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              practice
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {plain(terms.raisedRaw)} of {plain(terms.goalRaw)} staked
          {deadline && !deadline.passed ? ` · ${deadline.label}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Close the stake sheet"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  if (step.kind === "done") {
    const ref = step.hash ? `${step.hash.slice(0, 4)}…${step.hash.slice(-4)}` : null;
    const firstStage = project.milestones?.[0];
    return (
      <section aria-label="Stake receipt" className="w-full space-y-4 rounded-xl border border-emerald-500/30 bg-card p-4 text-left">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-emerald-500" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-base font-semibold">You&apos;re a stakeholder in {project.title}</p>
            <p className="text-sm text-muted-foreground">
              {display(step.amountRaw, "always")} is now in the vault.
            </p>
          </div>
        </div>
        <dl className="divide-y divide-border/60 rounded-xl border border-border bg-muted/20 text-sm">
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">Recorded</dt>
            <dd>
              {new Date(step.at).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </dd>
          </div>
          {ref && (
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="flex items-center gap-2 font-mono text-xs">
                {ref}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(step.hash!);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {}
                  }}
                  className="text-primary"
                  aria-label="Copy the reference"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </dd>
            </div>
          )}
        </dl>
        <p className="text-sm text-muted-foreground">
          What&apos;s next:{" "}
          {firstStage
            ? `the builder opens a vote when Stage 1 is done. You'll see it on this project's Stages tab.`
            : "you'll see every vote on this project's Stages tab."}{" "}
          If the goal isn&apos;t met
          {terms.deadlineMs ? ` by ${shortDate(terms.deadlineMs)}` : " by the deadline"}, you collect
          this back.
        </p>
        {step.hash && (
          <div className="space-y-1">
            <a
              href={`${EXPLORER_BASE}/tx/${step.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              See the public record
            </a>
            <p className="text-xs text-muted-foreground">{EXPLORER_EXPLAINER}</p>
          </div>
        )}
        <Button type="button" className="h-10 w-full" onClick={onClose}>
          Done
        </Button>
      </section>
    );
  }

  if (step.kind === "outcome") {
    return (
      <section aria-label="Stake" className="w-full space-y-4 rounded-xl border border-border bg-card p-4">
        {header}
        <OutcomeCard outcome={step.outcome} onIntent={onIntent} />
      </section>
    );
  }

  if (step.kind === "preparing") {
    return (
      <section aria-label="Stake" className="w-full space-y-4 rounded-xl border border-border bg-card p-4">
        {header}
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
          <p className="font-semibold">Preparing…</p>
          <p className="text-sm text-muted-foreground">Checking the vault will accept this stake.</p>
        </div>
      </section>
    );
  }

  if (step.kind === "confirm") {
    const fee = step.prepared.feeRaw;
    const feeUnits = fee !== null ? rawToUnits(fee) : null;
    // Significant digits, not two decimals: a fee of 0.0123 XLM is real and
    // must not round to "0.00".
    const feeText =
      feeUnits !== null
        ? `${feeUnits.toLocaleString("en-US", { maximumSignificantDigits: 3 })} XLM${
            xlmUsd ? ` (≈ ${feeUnits * xlmUsd < 0.01 ? "under 1¢" : formatUsd(feeUnits * xlmUsd, "always")})` : ""
          }`
        : "A few cents at most, in XLM";
    return (
      <section aria-label="Stake" className="w-full space-y-4 rounded-xl border border-border bg-card p-4">
        {header}
        <WalletConfirm
          title="Confirm your stake"
          sentence={`You're moving ${display(step.amountRaw, "always")} into the ${project.title} vault. It stays yours until the project meets its goal.`}
          rows={[
            {
              label: "Leaves your wallet",
              value: isDollar
                ? `${formatUsd(rawToUnits(step.amountRaw), "always")} · ${formatToken(rawToUnits(step.amountRaw), currency)}`
                : display(step.amountRaw),
            },
            { label: "Network fee", value: feeText, hint: "Paid in XLM from your wallet" },
            { label: "Fee to BLKFNDR", value: "$0.00" },
          ]}
          walletShows={`the amount, ${formatToken(rawToUnits(step.amountRaw), currency)}`}
          phase={step.phase}
          onOpenWallet={send}
          onBack={() => setStep({ kind: "form" })}
        />
      </section>
    );
  }

  // ── The form ────────────────────────────────────────────────────────────
  const summaryRaw = amountValid ? amountRaw! : null;
  const deadlineText = terms.deadlineMs ? shortDate(terms.deadlineMs) : "the deadline";

  return (
    <section aria-label="Stake" className="w-full space-y-4 rounded-xl border border-border bg-card p-4 text-left">
      {header}

      {closedReason ? (
        <div className="space-y-3">
          <p className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-foreground">{closedReason}</p>
          <Button type="button" variant="outline" className="h-10 w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <>
          {/* A. Amount */}
          <div className="space-y-2">
            <Label htmlFor="stake-amount" className="text-sm font-semibold">
              Amount
            </Label>
            <div className="relative">
              {isDollar && (
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-lg font-semibold text-muted-foreground">
                  $
                </span>
              )}
              <Input
                id="stake-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder={isDollar ? "0.00" : "0"}
                className={`h-12 text-lg font-semibold ${isDollar ? "pl-8" : "pr-14"}`}
                aria-describedby="stake-amount-help"
                aria-invalid={validation ? true : undefined}
              />
              {!isDollar && (
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-muted-foreground">
                  XLM
                </span>
              )}
            </div>

            {presets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {presets.map(({ raw, isRemainder }) => (
                  <button
                    key={String(raw)}
                    type="button"
                    onClick={() => setAmount(rawToInput(raw))}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium hover:bg-muted"
                  >
                    {isRemainder ? `Remainder ${plain(raw)}` : plain(raw)}
                  </button>
                ))}
              </div>
            )}

            <p id="stake-amount-help" className="text-xs text-muted-foreground">
              {minRaw > 0n ? `Minimum ${plain(minRaw)}. ` : ""}Maximum {plain(remainingRaw)} (what&apos;s
              left to reach the goal).
            </p>
            {nearGoal && amount === rawToInput(remainingRaw) && (
              <p className="text-xs text-muted-foreground">
                Only {plain(remainingRaw)} is left to reach the goal, so that&apos;s the amount.
              </p>
            )}
            {!isDollar && amountRaw !== null && amountRaw > 0n && (
              <p className="text-xs text-muted-foreground">
                {xlmUsd
                  ? `≈ ${formatUsd(rawToUnits(amountRaw) * xlmUsd, "never")} at today's rate (${describeRateAge(rateAt)}).`
                  : `Dollar estimate unavailable right now; the vault counts this stake as ${formatToken(rawToUnits(amountRaw), "XLM")}.`}
              </p>
            )}
            {validation && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                <span>{validation.message}</span>
                {validation.chip !== undefined && (
                  <button
                    type="button"
                    onClick={() => setAmount(rawToInput(validation.chip!))}
                    className="rounded-full border border-amber-500/40 px-2.5 py-0.5 text-xs font-medium hover:bg-amber-500/10"
                  >
                    Stake {plain(validation.chip)}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* B. Summary */}
          {summaryRaw !== null && (
            <dl className="divide-y divide-border/60 rounded-xl border border-border bg-muted/20 text-sm">
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">Your stake</dt>
                <dd className="font-medium">{display(summaryRaw, "always")}</dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">
                  Fee on stakes
                  <span className="block text-xs">None. The builder paid a flat listing fee when the vault opened.</span>
                </dt>
                <dd className="font-medium">$0.00</dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="flex items-center gap-1 text-muted-foreground">
                  Network fee
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label="About the network fee" className="text-muted-foreground">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-left">
                        Every action on the network costs a small fee in XLM, the network&apos;s own
                        currency: usually one or two cents, a little more the first time you stake in a
                        vault. You see the exact fee before you confirm.
                        {IS_PRACTICE_NETWORK ? " In practice mode, your wallet's practice XLM covers it." : ""}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </dt>
                <dd className="text-right font-medium">A few cents at most, in XLM from your wallet</dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">Leaves your wallet</dt>
                <dd className="text-right font-semibold">
                  {isDollar
                    ? `${formatUsd(rawToUnits(summaryRaw), "always")} · ${formatToken(rawToUnits(summaryRaw), currency)}`
                    : display(summaryRaw)}
                </dd>
              </div>
            </dl>
          )}

          {/* C. What this means */}
          {summaryRaw !== null && (
            <p className="text-sm text-muted-foreground">
              You&apos;re moving {display(summaryRaw, "always")} into the {project.title} vault. It stays
              yours until the project meets its {plain(terms.goalRaw)} goal. If the goal isn&apos;t met by{" "}
              {deadlineText}, you collect it back. Once it&apos;s met, the builder is paid stage by stage,
              each time stakeholders, including you, vote yes.
            </p>
          )}

          {/* D. One gate */}
          {!user ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
              <p className="font-semibold">Sign in to continue</p>
              <p className="text-sm text-muted-foreground">
                Sign in with Google or email. We&apos;ll bring you straight back to this stake.
              </p>
              <Button type="button" className="h-10 w-full" onClick={() => signInToContinue({ fund: true })}>
                Sign in
              </Button>
            </div>
          ) : !freighterWalletAddress ? (
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <p className="font-semibold">
                {user.stellarPublicKey
                  ? "Reconnect your wallet to confirm"
                  : "You'll need a wallet to confirm this; we'll guide you."}
              </p>
              <WalletPanel purpose={`to stake in ${project.title}`} />
            </div>
          ) : terms.token ? (
            <WalletReadinessCard
              address={freighterWalletAddress}
              readiness={readiness}
              state={state}
              needRaw={summaryRaw}
              isDollar={isDollar}
              display={(raw) => display(raw, "always")}
              onRefresh={refreshReadiness}
            />
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              type="button"
              className="h-10 flex-1"
              disabled={!canReview}
              onClick={() => amountRaw && prepare(amountRaw)}
            >
              Review and confirm
            </Button>
            <Button type="button" variant="outline" className="h-10 flex-1" onClick={onClose}>
              Cancel
            </Button>
          </div>
          {!termsLoaded && (
            <p className="text-xs text-muted-foreground">Reading the vault&apos;s current figures…</p>
          )}
        </>
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        Your stake goes into this project&apos;s vault, never to a BLKFNDR account.{" "}
        <Link href="/#protection" className="underline underline-offset-2">
          How your money is protected
        </Link>
      </p>
    </section>
  );
}
