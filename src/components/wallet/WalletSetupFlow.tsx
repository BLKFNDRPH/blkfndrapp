"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import { HORIZON_URL } from "@/lib/stellar-clients";
import { activatePractice } from "@/lib/wallet-readiness";
import { explainError } from "@/lib/explain-error";
import {
  ANOTHER_ACCOUNT_MESSAGE,
  CODE_DECLINED_MESSAGE,
  SIGN_IN_EXPIRED_MESSAGE,
  WalletConnectError,
  walletInstalled,
  walletNetworkMatches,
} from "@/lib/freighter-connect";
import { remindMeToSetUpWallet } from "@/app/actions";

/**
 * Set up your wallet: the Phase 1 shell of the wallet setup wizard (brief,
 * Prompt 9).
 *
 * Five short steps instead of one button and a checklist that only appeared
 * after something failed: why a wallet, which wallet, installing it, the two
 * approvals connecting asks for (each explained before its window opens), and
 * done. Phase 1 wraps today's Freighter connect, so the one wallet offered is
 * Freighter and its name appears only in steps 2 to 4.
 *
 * Phones have no browser extensions, so a phone gets step 1 and then a plain
 * card saying wallets on phones aren't supported yet, with a reminder it can
 * leave for itself on a computer. It never sees an install checklist it can't
 * follow.
 *
 * Nothing here moves money. Connecting lets the site see the account ID and
 * links the wallet to the account with a one-time code the wallet approves.
 */

const FREIGHTER_SITE = "https://freighter.app";
const STEPS = 5;

type Failure = { message: string; fix: "check" | "install" | "network" | "sign-in" | "retry" };

/** Which fix a failed connect needs, from what the provider threw. */
function failureOf(error: unknown): Failure {
  if (error instanceof WalletConnectError) {
    switch (error.code) {
      case "not-detected":
        return {
          message: "We can't see Freighter yet. Make sure it's installed and unlocked, then press Check again.",
          fix: "install",
        };
      case "locked":
        return { message: "Your wallet is locked. Unlock it, then press Check again.", fix: "check" };
      case "declined":
        return {
          message: "You didn't allow the site. Nothing happened. Allow it to continue.",
          fix: "retry",
        };
      case "wrong-network":
        return {
          message:
            "Your wallet is on the main network. Switch it to the test network (step 3 shows how), then press Check again.",
          fix: "network",
        };
      default:
        return { message: error.message, fix: "check" };
    }
  }
  const message = error instanceof Error && error.message ? error.message : "Something went wrong. Nothing was moved. Try again.";
  if (message === SIGN_IN_EXPIRED_MESSAGE) return { message, fix: "sign-in" };
  if (message === CODE_DECLINED_MESSAGE || message === ANOTHER_ACCOUNT_MESSAGE) return { message, fix: "retry" };
  return { message, fix: "retry" };
}

function Dots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={`Step ${step} of ${STEPS}`}>
      {Array.from({ length: STEPS }, (_, i) => (
        <span
          key={i}
          className={cn("h-1.5 rounded-full transition-all", i + 1 === step ? "w-5 bg-primary" : i + 1 < step ? "w-1.5 bg-primary/60" : "w-1.5 bg-muted-foreground/30")}
        />
      ))}
    </div>
  );
}

export function WalletSetupFlow({
  purpose,
  onLater,
  onStart,
  onFinish,
  doneHref,
  doneLabel,
}: {
  /** "to stake in Solar Pump", "to open a vault", "to verify your identity". */
  purpose?: string;
  /** Shown as "Do this later" in the header when given. */
  onLater?: () => void;
  /** Called as the wallet's windows are about to open, before anything links. */
  onStart?: () => void;
  /** Called when the person is done with the last step. */
  onFinish?: () => void;
  /** Where "continue" goes after setup, e.g. back to the verification page. */
  doneHref?: string;
  doneLabel?: string;
}) {
  const { user, login, refreshUser } = useAuth();
  const { login: connectWallet } = useFreighterWallet();
  const isPhone = useMediaQuery("(hover: none) and (pointer: coarse)");

  const [step, setStep] = useState(1);
  const [wroteDown, setWroteDown] = useState(false);
  const [wroteDownNudge, setWroteDownNudge] = useState(false);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [network, setNetwork] = useState<"match" | "mismatch" | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reminder, setReminder] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [activation, setActivation] = useState<"unknown" | "needed" | "done" | "working" | "failed">("unknown");
  const [activationProblem, setActivationProblem] = useState<string | null>(null);

  // While the person installs in another tab, look for the wallet every two
  // seconds: "Looking for it..." turns into "Found it" on its own.
  useEffect(() => {
    if (step !== 3 && step !== 4) return;
    let active = true;
    const look = async () => {
      const [found, net] = await Promise.all([walletInstalled(), walletNetworkMatches()]);
      if (!active) return;
      setInstalled(found);
      setNetwork(found ? net : null);
    };
    look();
    const timer = setInterval(look, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [step]);

  // Done: does the new wallet need its first practice XLM?
  useEffect(() => {
    if (step !== 5 || !address || !IS_PRACTICE_NETWORK) return;
    let active = true;
    fetch(`${HORIZON_URL}/accounts/${address}`)
      .then((res) => {
        if (active) setActivation(res.ok ? "done" : res.status === 404 ? "needed" : "unknown");
      })
      .catch(() => {
        if (active) setActivation("unknown");
      });
    return () => {
      active = false;
    };
  }, [step, address]);

  const connect = async () => {
    if (!user) {
      login();
      return;
    }
    onStart?.();
    setConnecting(true);
    setFailure(null);
    try {
      const linked = await connectWallet();
      await refreshUser();
      setAddress(typeof linked === "string" ? linked : null);
      setStep(5);
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setConnecting(false);
    }
  };

  const activate = async () => {
    if (!address) return;
    setActivation("working");
    setActivationProblem(null);
    try {
      await activatePractice(address);
      setActivation("done");
    } catch (error) {
      setActivation("failed");
      setActivationProblem(explainError(error, { action: "activate" }).body);
    }
  };

  const remind = async () => {
    setReminder("saving");
    const here = `${window.location.pathname}${window.location.search}`;
    const res = await remindMeToSetUpWallet(here).catch(() => null);
    setReminder(res && res.success ? "saved" : "failed");
  };

  const copyId = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The ID is printed in full beside the button.
    }
  };

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1.5">
        <p className="font-semibold">
          Set up your wallet{purpose ? <span className="font-normal text-muted-foreground"> · {purpose}</span> : null}
        </p>
        <Dots step={step} />
      </div>
      {onLater && step < 5 && (
        <button type="button" onClick={onLater} className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
          Do this later
        </button>
      )}
    </div>
  );

  // ── Phone: one honest card after step 1 ─────────────────────────────────
  if (isPhone && step > 1 && step < 5) {
    return (
      <div className="space-y-4 text-left">
        {header}
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            Wallets on phones aren&apos;t supported yet
          </p>
          <p className="text-sm text-muted-foreground">
            For now you can set up a wallet on a computer; staking, voting and refunds then work from
            there.
          </p>
          {user && (
            <Button type="button" className="h-10 w-full" onClick={remind} disabled={reminder === "saving" || reminder === "saved"}>
              {reminder === "saving" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              {reminder === "saved" ? "Reminder saved" : "Remind me on a computer"}
            </Button>
          )}
          {reminder === "saved" && (
            <p className="text-sm text-muted-foreground">
              It&apos;s in your notifications, with a link straight back to this step. Sign in on a
              computer and open the bell.
            </p>
          )}
          {reminder === "failed" && (
            <p role="alert" className="text-sm text-destructive">
              We couldn&apos;t save the reminder just now. Try again in a moment.
            </p>
          )}
          <Button type="button" variant="outline" className="h-10 w-full" onClick={() => (onLater ? onLater() : setStep(1))}>
            Keep browsing
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-left">
      {header}

      {step === 1 && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="font-semibold">Why you need a wallet</p>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>A wallet holds the key to your money. It lives on your device, not with BLKFNDR.</li>
            <li>You&apos;ll use it to confirm each thing you do here: staking, voting, collecting refunds.</li>
            <li>
              No one, including us, can move your money or reset your wallet. That&apos;s the point, and it&apos;s
              why the recovery words matter.
            </li>
          </ul>
          <Button type="button" className="h-10 w-full" onClick={() => setStep(2)}>
            Choose a wallet
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="font-semibold">Choose a wallet</p>
          <div className="space-y-3 rounded-xl border border-border p-4">
            <div>
              <p className="font-medium">Freighter · Browser extension</p>
              <p className="text-sm text-muted-foreground">Free. Installs in Chrome, Firefox, Brave or Edge.</p>
            </div>
            <Button type="button" className="h-10 w-full" onClick={() => setStep(3)}>
              Install Freighter
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Have it already?{" "}
              <button type="button" onClick={() => setStep(4)} className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
                Connect
              </button>
            </p>
          </div>
          <button type="button" onClick={() => setStep(1)} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Back
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="font-semibold">Install and create your wallet</p>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">1</span>
              <div className="space-y-1.5">
                <p>Install Freighter from its official page.</p>
                <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
                  <a href={FREIGHTER_SITE} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Open freighter.app
                  </a>
                </Button>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">2</span>
              <p>Create a new wallet and set a password.</p>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">3</span>
              <div className="space-y-2">
                <p>Write down the recovery words your wallet shows you, on paper, and keep them somewhere safe.</p>
                <label className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5", wroteDownNudge && !wroteDown ? "border-destructive" : "border-border")}>
                  <input
                    type="checkbox"
                    checked={wroteDown}
                    onChange={(e) => {
                      setWroteDown(e.target.checked);
                      setWroteDownNudge(false);
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                  />
                  <span>I&apos;ve written down my recovery words. I understand nobody can restore them for me.</span>
                </label>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Why paper?</summary>
                  <p className="mt-1">
                    Anyone with these words can take your money, and nobody can replace them if they&apos;re lost.
                    A screenshot can be stolen; paper in a drawer can&apos;t be hacked.
                  </p>
                </details>
              </div>
            </li>
            {IS_PRACTICE_NETWORK && (
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">4</span>
                <div className="space-y-1">
                  <p>
                    Switch the wallet to the test network. Freighter shows its network at the top of its window;
                    choose Test Net there.
                  </p>
                  <p
                    className={cn(
                      "text-xs font-medium",
                      network === "match" ? "text-emerald-600 dark:text-emerald-400" : network === "mismatch" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                    )}
                  >
                    {network === "match" ? "Test network, good" : network === "mismatch" ? "Still on the main network" : "We'll check this when you connect."}
                  </p>
                </div>
              </li>
            )}
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                {IS_PRACTICE_NETWORK ? 5 : 4}
              </span>
              <div className="space-y-1">
                <p>Come back to this tab.</p>
                <p className={cn("flex items-center gap-1.5 text-xs font-medium", installed ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} role="status" aria-live="polite">
                  {installed ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> Found it
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Looking for it…
                    </>
                  )}
                </p>
              </div>
            </li>
          </ol>
          {wroteDownNudge && !wroteDown && (
            <p role="alert" className="text-sm font-medium text-destructive">
              Tick the box once your recovery words are on paper.
            </p>
          )}
          <Button
            type="button"
            className="h-10 w-full"
            onClick={() => {
              if (!wroteDown) {
                setWroteDownNudge(true);
                return;
              }
              setStep(4);
            }}
          >
            Continue
          </Button>
          <button type="button" onClick={() => setStep(2)} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Back
          </button>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <p className="font-semibold">Connect it</p>
          <p className="text-sm text-muted-foreground">Freighter will ask you two things, one after the other:</p>
          <div className="space-y-2">
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">1 · Allow this site</p>
              <p className="text-muted-foreground">
                This lets BLKFNDR see your account ID. It can&apos;t see your recovery words or move money.
              </p>
            </div>
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">2 · Prove it&apos;s yours</p>
              <p className="text-muted-foreground">
                Your wallet approves a one-time code. It&apos;s free, moves nothing, and attaches this wallet to your
                BLKFNDR account.
              </p>
            </div>
          </div>
          <Button type="button" className="h-10 w-full" onClick={connect} disabled={connecting} aria-busy={connecting}>
            {connecting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {connecting ? "Waiting for you in Freighter…" : "Open Freighter"}
          </Button>
          {connecting && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Can&apos;t see the window?</summary>
              <p className="mt-1">
                Click the Freighter icon in your browser&apos;s toolbar; it may be inside the puzzle-piece menu. A
                request left open closes after about five minutes.
              </p>
            </details>
          )}
          {failure && !connecting && (
            <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p>{failure.message}</p>
              <div className="flex flex-wrap gap-2">
                {failure.fix === "sign-in" ? (
                  <Button type="button" size="sm" onClick={() => login()}>
                    Sign in
                  </Button>
                ) : (
                  <Button type="button" size="sm" className="gap-1.5" onClick={connect}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    {failure.fix === "retry" ? "Try again" : "Check again"}
                  </Button>
                )}
                {(failure.fix === "install" || failure.fix === "network") && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setStep(3)}>
                    {failure.fix === "install" ? "Show me how to install it" : "How to switch"}
                  </Button>
                )}
              </div>
            </div>
          )}
          <button type="button" onClick={() => setStep(2)} className="text-sm text-muted-foreground underline-offset-4 hover:underline" disabled={connecting}>
            Back
          </button>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden="true" />
            Your wallet is set up on your account.
          </p>
          {address && (
            <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>
                  Your account ID <span className="font-mono">…{address.slice(-4)}</span>
                </span>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={copyId} aria-label="Copy your account ID">
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">{address}</p>
              <p className="text-xs text-muted-foreground">This is like a bank account number: safe to share.</p>
            </div>
          )}
          {IS_PRACTICE_NETWORK && activation === "needed" && (
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <p>
                A new wallet is empty until it receives its first XLM, which also pays network fees. On the practice
                network it&apos;s free.
              </p>
              <Button type="button" size="sm" onClick={activate}>
                Add practice XLM
              </Button>
            </div>
          )}
          {activation === "working" && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Adding practice XLM…
            </p>
          )}
          {activation === "done" && IS_PRACTICE_NETWORK && (
            <p className="text-sm text-muted-foreground">Your wallet has practice XLM for network fees.</p>
          )}
          {activation === "failed" && activationProblem && (
            <p role="alert" className="text-sm text-destructive">
              {activationProblem}
            </p>
          )}
          {doneHref ? (
            <Button asChild className="h-10 w-full">
              <Link href={doneHref} onClick={onFinish}>
                {doneLabel ?? "Continue"}
              </Link>
            </Button>
          ) : (
            <Button type="button" className="h-10 w-full" onClick={onFinish}>
              {doneLabel ?? "Finish for now"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
