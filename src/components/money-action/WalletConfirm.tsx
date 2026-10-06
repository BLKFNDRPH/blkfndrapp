"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, MousePointerClick, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import type { SendPhase } from "@/hooks/use-stellar-contract";

/**
 * The moment a money action leaves the page for the wallet, narrated.
 *
 * Before: a card saying exactly what the wallet will show and where to press,
 * so its window is not a surprise. After the press: a countdown while the
 * wallet is open (its requests lapse after five minutes), then "Sending", then
 * "Waiting for the network". The calling sheet owns the outcome; this only
 * shows where things are.
 */

const WALLET_REQUEST_SECONDS = 5 * 60;

export interface ConfirmRow {
  label: string;
  value: ReactNode;
  hint?: string;
}

export function WalletConfirm({
  title,
  sentence,
  rows,
  walletShows,
  phase,
  onOpenWallet,
  onBack,
}: {
  /** "Confirm your stake". */
  title: string;
  /** "You're moving $50 into the Riverside Clinic vault." */
  sentence: string;
  rows: ConfirmRow[];
  /** What the wallet window will display, for the preview: "50 USDC". */
  walletShows: string;
  /** Null before the press; then where the action is. */
  phase: SendPhase | null;
  onOpenWallet: () => void;
  onBack: () => void;
}) {
  if (phase === null) {
    return (
      <div className="space-y-4 text-left">
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{sentence}</p>
        </div>

        <dl className="divide-y divide-border/60 rounded-xl border border-border bg-muted/20 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <dt className="text-muted-foreground">
                {row.label}
                {row.hint && <span className="block text-xs">{row.hint}</span>}
              </dt>
              <dd className="text-right font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>

        {/* A preview of the wallet window, so it is expected rather than a surprise. */}
        <div className="rounded-xl border border-dashed border-border p-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
            Your wallet opens next
          </p>
          <ol className="space-y-1.5 text-sm text-foreground">
            <li>
              <span className="text-muted-foreground">1.</span> It shows the amount:{" "}
              <span className="font-semibold">{walletShows}</span>.
            </li>
            {IS_PRACTICE_NETWORK && (
              <li>
                <span className="text-muted-foreground">2.</span> It says the network is the test
                network. That&apos;s the practice network, and it&apos;s right.
              </li>
            )}
            <li className="flex items-start gap-1.5">
              <span className="text-muted-foreground">{IS_PRACTICE_NETWORK ? "3." : "2."}</span>
              <span>
                Check the amount, then press <span className="font-semibold">Approve</span>.
              </span>
              <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            </li>
          </ol>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="button" className="h-10 flex-1" onClick={onOpenWallet}>
            Open Freighter
          </Button>
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return <PhaseView phase={phase} />;
}

function PhaseView({ phase }: { phase: SendPhase }) {
  if (phase === "waiting-for-wallet") return <WaitingForWallet />;
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-6 text-center">
      {phase === "sending" ? (
        <>
          <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden="true" />
          <p className="font-semibold">Approved. Sending…</p>
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          <p className="font-semibold">Sent. Waiting for the network</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Usually under 10 seconds. Keep this tab open.
          </p>
        </>
      )}
    </div>
  );
}

function WaitingForWallet() {
  const [left, setLeft] = useState(WALLET_REQUEST_SECONDS);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      setLeft(Math.max(0, WALLET_REQUEST_SECONDS - Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * (left / WALLET_REQUEST_SECONDS);

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-4 text-center">
      <svg width="56" height="56" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={radius} fill="none" className="stroke-muted" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          className="stroke-primary transition-[stroke-dasharray] duration-1000"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <p className="font-semibold">Waiting for you in your wallet</p>
      <p className="text-sm text-muted-foreground">
        {minutes}:{seconds} left. Wallet requests expire after 5 minutes.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">
          Can&apos;t see the window?
        </summary>
        <p className="mt-2 max-w-xs text-muted-foreground">
          It may be behind this tab or under the extension icon at the top right of your browser.
        </p>
      </details>
    </div>
  );
}
