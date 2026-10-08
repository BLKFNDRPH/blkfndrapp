"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  ListChecks,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import { PRACTICE_DOLLARS_FAUCET } from "@/lib/wallet-readiness";
import { formatToken } from "@/lib/money";
import {
  launchMoney,
  networkFeeMoney,
  type FundsView,
  type LaunchReadiness,
} from "./launch-readiness";

/**
 * Everything a builder needs before a vault can open, each with where it
 * stands right now and the one thing to do about it. Shown above the form, so
 * nobody fills in a listing and only then learns they can't open it.
 */

type Tone = "done" | "todo" | "waiting" | "problem" | "loading" | "info";

function StatusIcon({ tone }: { tone: Tone }) {
  const cls = "mt-0.5 h-5 w-5 shrink-0";
  switch (tone) {
    case "done":
      return <CheckCircle2 className={`${cls} text-emerald-500`} aria-hidden="true" />;
    case "waiting":
      return <Clock className={`${cls} text-amber-500`} aria-hidden="true" />;
    case "problem":
      return <XCircle className={`${cls} text-destructive`} aria-hidden="true" />;
    case "loading":
      return <Loader2 className={`${cls} animate-spin text-muted-foreground`} aria-hidden="true" />;
    case "info":
      return <ListChecks className={`${cls} text-muted-foreground`} aria-hidden="true" />;
    default:
      return <Circle className={`${cls} text-muted-foreground`} aria-hidden="true" />;
  }
}

function Row({
  tone,
  title,
  hint,
  status,
  children,
}: {
  tone: Tone;
  title: string;
  hint: React.ReactNode;
  status?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <StatusIcon tone={tone} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-foreground">
          {title}
          {tone === "done" && <span className="sr-only"> (done)</span>}
        </p>
        <p className="text-sm text-muted-foreground">{hint}</p>
        {status && <p className="text-sm font-medium text-foreground">{status}</p>}
        {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
      </div>
    </li>
  );
}

export function BeforeYouBegin({
  readiness,
  funds,
  address,
  currency,
  xlmUsd,
  minPct,
  listingFee,
  feeXlm,
  canSwitchToXlm,
  onSwitchToXlm,
  onSignIn,
}: {
  readiness: LaunchReadiness;
  funds: FundsView;
  address: string | null;
  currency: string;
  xlmUsd: number | null;
  /** The minimum deposit, as a percentage of the goal. */
  minPct: number;
  /** The flat listing fee, in the vault's currency. */
  listingFee: number;
  /** The usual network fee for this plan, in XLM. */
  feeXlm: number;
  canSwitchToXlm: boolean;
  onSwitchToXlm: () => void;
  onSignIn: () => void;
}) {
  const { identity, busy, fixProblem } = readiness;
  const [copied, setCopied] = useState(false);
  const isDollar = currency !== "XLM";
  const money = (n: number) => launchMoney(n, currency, xlmUsd);

  const copyId = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The full ID is in the wallet panel too.
    }
  };

  const signedOut = identity === "signed-out";

  // ── Identity ───────────────────────────────────────────────────────────
  const identityRow = (() => {
    const hint = "BLKFNDR checks who is behind every vault before it opens. It takes a passport, ID card or driver's license.";
    switch (identity) {
      case "verified":
        return <Row tone="done" title="Verified identity" hint={hint} status="Verified" />;
      case "lapsed":
        return (
          <Row tone="problem" title="Verified identity" hint={hint} status="Your ID has expired. Verify again with a current one.">
            <Button asChild size="sm">
              <Link href="/profile/kyc-attestation">Verify again</Link>
            </Button>
          </Row>
        );
      case "pending":
        return (
          <Row
            tone="waiting"
            title="Verified identity"
            hint={hint}
            status="Under review. You can fill in your listing meanwhile; the vault can open once it's approved."
          />
        );
      case "approved":
        return (
          <Row
            tone="waiting"
            title="Verified identity"
            hint={hint}
            status="Approved, but not yet recorded on-chain: attach your wallet, or wait for a reviewer to record it."
          >
            <Button asChild size="sm" variant="outline">
              <Link href="/profile/kyc-attestation">See what's left</Link>
            </Button>
          </Row>
        );
      case "rejected":
        return (
          <Row tone="problem" title="Verified identity" hint={hint} status="Not approved. You can send it again.">
            <Button asChild size="sm">
              <Link href="/profile/kyc-attestation">Try again</Link>
            </Button>
          </Row>
        );
      case "none":
        return (
          <Row tone="todo" title="Verified identity" hint={hint} status="Not started">
            <Button asChild size="sm">
              <Link href="/profile/kyc-attestation">Verify now</Link>
            </Button>
          </Row>
        );
      case "loading":
        return <Row tone="loading" title="Verified identity" hint={hint} status="Checking…" />;
      default:
        return (
          <Row tone="todo" title="Verified identity" hint={hint} status="We couldn't check this just now.">
            <Button asChild size="sm" variant="outline">
              <Link href="/profile/kyc-attestation">See where it stands</Link>
            </Button>
          </Row>
        );
    }
  })();

  // ── Wallet ─────────────────────────────────────────────────────────────
  const walletRow = (
    <Row
      tone={address ? "done" : "todo"}
      title="A wallet you control"
      hint="Opening a vault uses your own wallet, because the deposit and every payout are tied to it. BLKFNDR never holds its key."
      status={address ? `Set up · wallet address …${address.slice(-4)}` : "Not set up yet"}
    >
      {!address && (
        <Button asChild size="sm">
          <Link href="/profile?tab=wallet&for=vault">Set up your wallet</Link>
        </Button>
      )}
    </Row>
  );

  // ── Money ──────────────────────────────────────────────────────────────
  const moneyHint = (
    <>
      Your deposit (at least {minPct}% of your goal) and the flat listing fee ({money(listingFee)}),
      in the currency you pick, plus about {feeXlm.toFixed(1)} XLM for
      the network fee.
    </>
  );
  const fixError = fixProblem && <p className="basis-full text-sm text-destructive">{fixProblem}</p>;
  const checkAgain = (
    <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={readiness.refresh}>
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      Check again
    </Button>
  );

  const moneyRow = (() => {
    const title = "Enough in that wallet";
    switch (funds.state) {
      case "signed-out":
      case "no-wallet":
        return <Row tone="todo" title={title} hint={moneyHint} status="Set up your wallet first." />;
      case "loading":
        return <Row tone="loading" title={title} hint={moneyHint} status="Checking your wallet…" />;
      case "unknown":
        return (
          <Row tone="todo" title={title} hint={moneyHint} status="We can't read your wallet right now. Your wallet still shows the final amount before you sign.">
            {checkAgain}
          </Row>
        );
      case "no-account":
        return (
          <Row tone="todo" title={title} hint={moneyHint} status="Your Stellar account isn't activated yet. It needs its first XLM to exist on the ledger.">
            {IS_PRACTICE_NETWORK && (
              <Button type="button" size="sm" onClick={readiness.activate} disabled={busy !== null}>
                {busy === "activate" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {busy === "activate" ? "Activating…" : "Get testnet XLM"}
              </Button>
            )}
            {checkAgain}
            {fixError}
          </Row>
        );
      case "no-trustline":
        return (
          <Row
            tone="todo"
            title={title}
            hint={moneyHint}
            status={
              isDollar
                ? "Your wallet has no USDC trustline yet. You sign this once in your wallet; it sets aside 0.5 XLM of your own as a reserve while it's on."
                : "Your wallet has no trustline for this asset yet."
            }
          >
            <Button
              type="button"
              size="sm"
              onClick={() => readiness.enable(funds.asset)}
              disabled={busy !== null}
            >
              {busy === "enable" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {busy === "enable" ? "Waiting for your wallet…" : isDollar ? "Add a USDC trustline" : "Add the trustline"}
            </Button>
            {checkAgain}
            {fixError}
          </Row>
        );
      case "short":
        return (
          <Row
            tone="todo"
            title={title}
            hint={moneyHint}
            status={`Your wallet has ${money(funds.held)}; it needs ${money(funds.shortBy)} more.`}
          >
            {isDollar && IS_PRACTICE_NETWORK && address && (
              <>
                <p className="basis-full text-sm text-muted-foreground">
                  Circle, the company behind USDC, gives testnet USDC for free from its faucet: 20 every
                  2 hours. On their page pick Stellar Testnet, paste your wallet address (this button
                  copies it) and press Send. Or lower your deposit, or switch the vault to XLM.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    copyId();
                    window.open(PRACTICE_DOLLARS_FAUCET, "_blank", "noopener,noreferrer");
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
                  {copied ? "Address copied" : "Get testnet USDC"}
                </Button>
                {canSwitchToXlm && (
                  <Button type="button" size="sm" variant="outline" onClick={onSwitchToXlm}>
                    Switch to XLM
                  </Button>
                )}
              </>
            )}
            {(!isDollar || !IS_PRACTICE_NETWORK) && address && (
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={copyId}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? "Copied" : "Copy your wallet address to add money"}
              </Button>
            )}
            {checkAgain}
          </Row>
        );
      case "fee-short":
        return (
          <Row
            tone="todo"
            title={title}
            hint={moneyHint}
            status={`Your wallet needs a little more XLM for the network fee: about ${networkFeeMoney(feeXlm, xlmUsd)}, and it has ${formatToken(funds.xlm, "XLM")} to spend.`}
          >
            {checkAgain}
          </Row>
        );
      case "ready":
        return (
          <Row
            tone="done"
            title={title}
            hint={moneyHint}
            status={
              isDollar && funds.held !== null
                ? `Ready: ${money(funds.held)}${funds.xlm !== null ? ` and ${formatToken(funds.xlm, "XLM", "never")}` : ""} in your wallet`
                : funds.held !== null
                  ? `Ready: ${money(funds.held)} in your wallet`
                  : "Ready"
            }
          />
        );
    }
  })();

  return (
    <section
      id="before-you-begin"
      aria-labelledby="before-you-begin-title"
      className="scroll-mt-24 rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="before-you-begin-title" className="text-lg font-semibold">
          Before you begin
        </h2>
        {signedOut && (
          <Button type="button" size="sm" onClick={onSignIn}>
            Sign in to see where you stand
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Here is everything you need before the vault can open. You can start the listing now and
        come back to these.
      </p>
      <ul className="mt-2 divide-y divide-border/60">
        {signedOut ? (
          <>
            <Row tone="todo" title="Verified identity" hint="BLKFNDR checks who is behind every vault before it opens. It takes a passport, ID card or driver's license." />
            <Row tone="todo" title="A wallet you control" hint="Opening a vault uses your own wallet, because the deposit and every payout are tied to it." />
            <Row tone="todo" title="Enough in that wallet" hint={moneyHint} />
          </>
        ) : (
          <>
            {identityRow}
            {walletRow}
            {moneyRow}
          </>
        )}
        <Row
          tone="info"
          title="Your plan"
          hint="Stages with an amount each, what you'll deliver at each one, and a deadline to reach the goal. You fill these in below."
        />
      </ul>
      <details className="mt-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">Why a deposit?</summary>
        <p className="mt-2 text-muted-foreground">
          The deposit is your guarantee. It is locked in the vault when it opens, returned to you when
          every stage is paid, and shared among stakeholders if a stage fails its vote.
        </p>
      </details>
    </section>
  );
}
