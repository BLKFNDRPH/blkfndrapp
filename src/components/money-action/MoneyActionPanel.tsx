"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import type { PreparedAction, SendPhase } from "@/hooks/use-stellar-contract";
import { explainError, type ExplainContext, type Outcome, type OutcomeIntent } from "@/lib/explain-error";
import { EXPLORER_BASE, EXPLORER_EXPLAINER } from "@/lib/network";
import { formatUsd, rawToUnits } from "@/lib/money";
import { WalletPanel } from "@/components/settings/WalletSettings";
import { OutcomeCard } from "./OutcomeCard";
import { WalletConfirm, type ConfirmRow } from "./WalletConfirm";

/**
 * One money action, start to finish, inline where it was asked for.
 *
 * Votes, payouts, stage closes and refunds all run the same way the stake
 * sheet does: a sign-in or wallet gate if needed, the vault's own simulation
 * before any wallet window (its refusal becomes an outcome card here, not a
 * popup later), a card saying exactly what the wallet will show and what it
 * costs, the wallet itself, the send, the ledger, and then either a short
 * success line or an outcome card that says whether money moved.
 *
 * The panel starts preparing as soon as it mounts with a wallet connected, so
 * the button that opened it is the person's first and only decision before
 * the confirm card.
 */

type Step =
  | { kind: "gate" }
  | { kind: "preparing" }
  | { kind: "confirm"; prepared: PreparedAction; phase: SendPhase | null }
  | { kind: "done"; hash: string | null }
  | { kind: "outcome"; outcome: Outcome; hash?: string | null };

export function MoneyActionPanel({
  context,
  title,
  sentence,
  rows,
  walletShows,
  prepare,
  successTitle,
  successBody,
  onSuccess,
  onClose,
}: {
  /** Which action, and the figures explainError words its refusals with. */
  context: ExplainContext;
  /** "Approve this payout". */
  title: string;
  /** "Approve the $1,500 payout for Stage 2? This is final; one vote per stakeholder." */
  sentence: string;
  /** Rows before the network fee, which the panel adds from the simulation. */
  rows: ConfirmRow[];
  /** What the wallet window shows, for its preview. */
  walletShows: string;
  prepare: () => Promise<PreparedAction>;
  /** "Recorded. Your approval counts." */
  successTitle: string;
  successBody?: ReactNode;
  /** After the ledger confirms: refresh figures behind the panel. */
  onSuccess?: (hash: string | null) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { freighterWalletAddress } = useFreighterWallet();
  const { signInToContinue } = useProjectDetails();
  const [step, setStep] = useState<Step>({ kind: "gate" });
  const started = useRef(false);

  const run = useCallback(async () => {
    setStep({ kind: "preparing" });
    try {
      const prepared = await prepare();
      setStep({ kind: "confirm", prepared, phase: null });
    } catch (error) {
      console.warn(`[MoneyAction:${context.action}] refused before the wallet:`, error);
      setStep({ kind: "outcome", outcome: explainError(error, context) });
    }
  }, [prepare, context]);

  // Begin as soon as a wallet is there; a wallet connected from the gate
  // starts it too.
  useEffect(() => {
    if (!started.current && user && freighterWalletAddress) {
      started.current = true;
      run();
    }
  }, [user, freighterWalletAddress, run]);

  const send = async () => {
    if (step.kind !== "confirm") return;
    const { prepared } = step;
    try {
      const { hash } = await prepared.send((phase) =>
        setStep((s) => (s.kind === "confirm" ? { ...s, phase } : s)),
      );
      setStep({ kind: "done", hash });
      onSuccess?.(hash);
    } catch (error) {
      console.warn(`[MoneyAction:${context.action}] ended without effect:`, error);
      const hash = (error as { hash?: string | null })?.hash ?? null;
      setStep({ kind: "outcome", outcome: explainError(error, context), hash });
    }
  };

  const onIntent = (intent: OutcomeIntent) => {
    switch (intent) {
      case "retry":
        run();
        return;
      case "fix-wallet":
        started.current = false;
        setStep({ kind: "gate" });
        return;
      case "check-activity":
        window.location.assign("/profile");
        return;
      case "public-record": {
        const hash = step.kind === "outcome" ? step.hash : null;
        if (hash) window.open(`${EXPLORER_BASE}/tx/${hash}`, "_blank", "noopener,noreferrer");
        return;
      }
      default:
        onClose();
    }
  };

  const shell = (children: ReactNode) => (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-left">{children}</div>
  );

  if (step.kind === "gate") {
    if (!user) {
      return shell(
        <>
          <p className="font-semibold">Sign in to continue</p>
          <p className="text-sm text-muted-foreground">
            Sign in with Google or email, then confirm in your wallet.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="button" className="h-10 flex-1" onClick={() => signInToContinue()}>
              Sign in
            </Button>
            <Button type="button" variant="outline" className="h-10 flex-1" onClick={onClose}>
              Not now
            </Button>
          </div>
        </>,
      );
    }
    return shell(
      <>
        <p className="font-semibold">
          {user.stellarPublicKey
            ? "Reconnect your wallet to confirm"
            : "You'll need a wallet to confirm this; we'll guide you."}
        </p>
        {freighterWalletAddress ? (
          <Button type="button" className="h-10 w-full" onClick={run}>
            Continue
          </Button>
        ) : (
          <WalletPanel purpose="to confirm this" />
        )}
        <Button type="button" variant="ghost" className="h-9 w-full" onClick={onClose}>
          Not now
        </Button>
      </>,
    );
  }

  if (step.kind === "preparing") {
    return shell(
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 py-4 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="font-semibold">Preparing…</p>
        <p className="text-sm text-muted-foreground">Checking the vault will accept this.</p>
      </div>,
    );
  }

  if (step.kind === "outcome") {
    return <OutcomeCard outcome={step.outcome} onIntent={onIntent} />;
  }

  if (step.kind === "done") {
    return (
      <div
        role="status"
        className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-left"
      >
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
          {successTitle}
        </p>
        {successBody && <div className="text-sm text-muted-foreground">{successBody}</div>}
        {step.hash && (
          <div className="space-y-0.5">
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
        <Button type="button" variant="outline" className="h-9 w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  const fee = step.prepared.feeRaw;
  const feeUnits = fee !== null ? rawToUnits(fee) : null;
  const feeRow: ConfirmRow = {
    label: "Network fee",
    hint: "Paid in XLM from your wallet",
    value:
      feeUnits !== null
        ? `${feeUnits.toLocaleString("en-US", { maximumSignificantDigits: 3 })} XLM`
        : "A few cents at most, in XLM",
  };

  return shell(
    <WalletConfirm
      title={title}
      sentence={sentence}
      rows={[...rows, feeRow, { label: "Fee to BLKFNDR", value: formatUsd(0, "always") }]}
      walletShows={walletShows}
      phase={step.phase}
      onOpenWallet={send}
      onBack={onClose}
    />,
  );
}
