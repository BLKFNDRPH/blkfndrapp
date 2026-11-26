"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { EXPLORER_BASE } from "@/lib/network";
import type { ClaimRefusal } from "@/lib/campaign/claim-rules";

/**
 * The campaign page's own panel: for a visitor, the way in (create an
 * account); for a signed-in person, where they stand (wallet linked, practice
 * USDC claimed, ready to stake) and their referral link.
 */

interface CampaignMe {
  referral: { code: string; link: string; referred: number };
  claim: {
    open: boolean;
    closedReason: ClaimRefusal | null;
    amount: string;
    linkedWallet: string | null;
    claim: { status: string; txHash: string | null; createdAt: string } | null;
  };
}

function StepRow({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={
          done
            ? "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "mt-0.5 h-5 w-5 shrink-0 rounded-full border border-muted-foreground/40"
        }
        aria-hidden="true"
      >
        {done && <Check className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium text-foreground">
          {title}
          <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

export function CampaignPanel() {
  const { user, ready, login } = useAuth();
  const [me, setMe] = useState<CampaignMe | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState<{ text: string; code?: ClaimRefusal } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/campaign/me", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setMe((await res.json()) as CampaignMe);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
    else setMe(null);
  }, [user, load]);

  const claim = async () => {
    setClaiming(true);
    setClaimMessage(null);
    try {
      const res = await fetch("/api/campaign/claim", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: ClaimRefusal; error?: string; amount?: string };
      if (body.ok) {
        setClaimMessage({ text: `Sent ${body.amount} testnet USDC to your wallet.` });
      } else {
        setClaimMessage({ text: body.error ?? "The claim didn't go through. Nothing was sent.", code: body.code });
      }
      await load();
    } catch {
      setClaimMessage({ text: "We couldn't reach BLKFNDR. Nothing was sent. Try again." });
    } finally {
      setClaiming(false);
    }
  };

  const copyLink = async () => {
    if (!me) return;
    try {
      await navigator.clipboard.writeText(me.referral.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen to copy by hand.
    }
  };

  if (!ready) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-border p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking whether you&apos;re signed in…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-5">
        <p className="font-semibold text-foreground">Start with a free account</p>
        <p className="text-sm text-muted-foreground">
          An email address or a Google account is enough. You&apos;ll set up a wallet after that.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => login()} className="h-10">
            Create an account
          </Button>
          <Button onClick={() => login()} variant="outline" className="h-10">
            I already have one: sign in
          </Button>
        </div>
      </div>
    );
  }

  if (loadError && !me) {
    return (
      <div className="space-y-2 rounded-xl border border-border p-5 text-sm">
        <p className="text-muted-foreground">We couldn&apos;t load your campaign progress.</p>
        <Button variant="outline" className="h-9" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!me) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-border p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading your progress…
      </div>
    );
  }

  const linked = Boolean(me.claim.linkedWallet);
  const claimed = me.claim.claim;
  const needsWalletFix = claimMessage?.code === "no-trustline" || claimMessage?.code === "no-account";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border p-5">
        <p className="mb-4 font-semibold text-foreground">Your progress</p>
        <ol className="space-y-4 text-sm">
          <StepRow done title="Account created" />

          <StepRow done={linked} title="Wallet set up and linked">
            {!linked && (
              <p className="text-muted-foreground">
                Follow the <Link href="/campaign/freighter" className="font-medium text-primary underline-offset-4 hover:underline">Freighter guide</Link>{" "}
                to install Freighter, switch it to Testnet, fund it with Friendbot, add a USDC trustline
                and link it here.
              </p>
            )}
          </StepRow>

          <StepRow done={claimed?.status === "paid"} title={`Claim ${me.claim.amount} practice USDC`}>
            {claimed ? (
              <p className="text-muted-foreground">
                {claimed.status === "paid" ? "Sent to your wallet." : "Sent; waiting for the network to confirm it."}{" "}
                {claimed.txHash && (
                  <a
                    href={`${EXPLORER_BASE}/tx/${claimed.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                  >
                    View on Stellar Expert
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </p>
            ) : !me.claim.open ? (
              <p className="text-muted-foreground">
                {me.claim.closedReason === "mainnet"
                  ? "Practice USDC only exists on Testnet."
                  : "The practice USDC dispenser is closed right now."}
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Testnet USDC, paid by BLKFNDR straight into your own linked wallet. One claim per
                  account. It&apos;s practice money: it can&apos;t be cashed out, and once it&apos;s
                  in your wallet nobody, BLKFNDR included, can take it back.
                </p>
                <Button className="h-9" onClick={claim} disabled={claiming || !linked}>
                  {claiming && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {claiming ? "Sending…" : `Claim ${me.claim.amount} practice USDC`}
                </Button>
              </>
            )}
            {claimMessage && (
              <p className={claimMessage.code ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"} role="status">
                {claimMessage.text}{" "}
                {needsWalletFix && (
                  <Link href="/campaign/freighter#fund" className="font-medium underline underline-offset-4">
                    Open the Freighter guide
                  </Link>
                )}
              </p>
            )}
          </StepRow>

          <StepRow done={false} title="Stake in a real vault">
            <p className="text-muted-foreground">
              Pick a project and stake from $5 of your practice USDC. The vault is a real Soroban
              contract on Testnet; you vote on its payouts like any stakeholder.
            </p>
            <Button asChild variant="outline" className="h-9">
              <Link href="/projects">See live projects</Link>
            </Button>
          </StepRow>
        </ol>
      </div>

      <div className="space-y-3 rounded-xl border border-border p-5">
        <p className="font-semibold text-foreground">Invite someone</p>
        <p className="text-sm text-muted-foreground">
          Share your link. When someone creates an account through it, it counts here. There&apos;s
          no reward attached; it tells us how the campaign spread.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            {me.referral.link}
          </code>
          <Button variant="outline" className="h-9 gap-1.5" onClick={copyLink}>
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {me.referral.referred === 1
            ? "1 person has signed up with your link."
            : `${me.referral.referred} people have signed up with your link.`}
        </p>
      </div>
    </div>
  );
}
