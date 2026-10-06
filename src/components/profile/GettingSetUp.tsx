"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import { activatePractice } from "@/lib/wallet-readiness";

interface Step {
  key: string;
  done: boolean;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

/**
 * What is left before this account can take part fully, as a checklist that
 * goes away once the required steps are done. Identity is only needed to open
 * a vault, so it is shown, and says so, but never holds the card open for
 * someone who only stakes.
 */
export function GettingSetUp({
  walletAddress,
  walletActivated,
  identityVerified,
  isBuilder,
  onChanged,
}: {
  /** The account's linked wallet, or "" when none is set up. */
  walletAddress: string;
  /** Whether that wallet exists on the network; null when unknown. */
  walletActivated: boolean | null;
  identityVerified: boolean;
  isBuilder: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const hasWallet = Boolean(walletAddress);
  const activated = walletActivated === true;

  const activate = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await activatePractice(walletAddress);
      onChanged();
    } catch {
      setProblem("The practice faucet didn't answer. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  const steps: Step[] = [
    { key: "account", done: true, title: "Account created" },
    {
      key: "wallet",
      done: hasWallet,
      title: "Wallet set up",
      hint: "Needed to stake, vote and collect refunds. It lives on your device, not with BLKFNDR.",
      action: (
        <Button asChild size="sm" variant="outline">
          <Link href="/profile?tab=wallet">Set up</Link>
        </Button>
      ),
    },
    ...(IS_PRACTICE_NETWORK
      ? [
          {
            key: "xlm",
            done: activated,
            title: "Practice XLM added",
            hint: "Activates your wallet and covers network fees. Free on the practice network.",
            action: (
              <Button size="sm" variant="outline" disabled={!hasWallet || busy} onClick={activate}>
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {busy ? "Adding…" : "Add"}
              </Button>
            ),
          },
        ]
      : []),
    {
      key: "identity",
      done: identityVerified,
      title: "Identity verified",
      hint: "Only if you want to open a vault for your own project.",
      action: (
        <Button asChild size="sm" variant="outline">
          <Link href="/profile/kyc-attestation">Verify</Link>
        </Button>
      ),
    },
  ];

  const requiredDone = hasWallet && (!IS_PRACTICE_NETWORK || activated || walletActivated === null);
  const identityPending = isBuilder && !identityVerified;
  if (requiredDone && !identityPending) return null;

  return (
    <section aria-label="Getting set up" className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 font-semibold">Getting set up</p>
      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className={step.done ? "text-sm text-muted-foreground" : "text-sm font-medium"}>
                  {step.title}
                  {step.done && <span className="sr-only"> (done)</span>}
                </p>
                {!step.done && step.hint && <p className="text-xs text-muted-foreground">{step.hint}</p>}
              </div>
            </div>
            {!step.done && step.action}
          </li>
        ))}
      </ol>
      {problem && <p className="mt-2 text-sm text-destructive">{problem}</p>}
    </section>
  );
}
