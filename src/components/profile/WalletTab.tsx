"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WalletPanel } from "@/components/settings/WalletSettings";
import {
  WalletReadinessCard,
  readinessState,
} from "@/components/project/stake/WalletReadinessCard";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import { formatToken, formatUsd, rawToUnits } from "@/lib/money";
import { PRACTICE_DOLLARS_FAUCET, type WalletReadiness } from "@/lib/wallet-readiness";

/**
 * The wallet: the shared panel (set up, reconnect, the account ID, disconnect
 * or remove), what it holds, and the fixes a person makes themselves to get
 * practice money into it. Balances are public, so they show for the linked
 * wallet even when it isn't connected in this browser.
 */
export function WalletTab({
  address,
  readiness,
  readinessLoading,
  xlmUsd,
  onRefresh,
}: {
  address: string;
  readiness: WalletReadiness | null;
  readinessLoading: boolean;
  xlmUsd: number | null;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const state = readinessState(readiness, readinessLoading, null);
  const usdcRaw = readiness?.holding.status === "ok" ? readiness.holding.raw : null;
  const xlmRaw = readiness?.xlmRaw ?? null;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // "Show full ID" in the panel above shows it for copying by hand.
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-label="Your wallet" className="space-y-3 rounded-xl border border-border bg-card p-4">
        <p className="font-semibold">Your wallet</p>
        <WalletPanel />
      </section>

      {address && (
        <section aria-label="What your wallet holds" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 font-semibold">
            What your wallet holds
            {IS_PRACTICE_NETWORK && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                practice money
              </span>
            )}
          </p>

          {readinessLoading && !readiness ? (
            <div className="space-y-2" role="status" aria-label="Reading your wallet">
              <div className="h-10 animate-pulse rounded-lg bg-muted" />
              <div className="h-10 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : (
            <dl className="divide-y divide-border/60 rounded-xl border border-border bg-muted/20 text-sm">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <dt>
                  Dollars <span className="text-muted-foreground">(USDC)</span>
                </dt>
                <dd className="font-semibold">
                  {usdcRaw !== null ? formatUsd(rawToUnits(usdcRaw), "always") : "Not enabled yet"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <dt>
                  XLM <span className="text-muted-foreground">(the network&apos;s own currency, for fees)</span>
                </dt>
                <dd className="text-right font-semibold">
                  {xlmRaw !== null ? (
                    <>
                      {xlmUsd ? `≈ ${formatUsd(rawToUnits(xlmRaw) * xlmUsd, "always")} · ` : ""}
                      {formatToken(rawToUnits(xlmRaw), "XLM")}
                    </>
                  ) : (
                    "Not activated yet"
                  )}
                </dd>
              </div>
            </dl>
          )}

          {state !== "ready" && state !== "loading" && (
            <WalletReadinessCard
              address={address}
              readiness={readiness}
              state={state}
              needRaw={null}
              isDollar
              display={(raw) => formatUsd(rawToUnits(raw), "always")}
              onRefresh={onRefresh}
            />
          )}

          {IS_PRACTICE_NETWORK && state === "ready" && (
            <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">Add practice dollars</p>
              <p className="text-muted-foreground">
                Circle, the company behind USDC, gives practice dollars for free. On their page pick
                Stellar Testnet, paste your account ID (this button copies it), and press Send. You get
                20 practice dollars every 2 hours, straight to your wallet.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    copyId();
                    window.open(PRACTICE_DOLLARS_FAUCET, "_blank", "noopener,noreferrer");
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Get practice dollars
                </Button>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={copyId}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : `Copy account ID ...${address.slice(-4)}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={onRefresh}>
                  Check again
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {IS_PRACTICE_NETWORK
              ? "Practice money can't be cashed out. Moving real money to a bank or card arrives with the main network."
              : "Held by your wallet, not by BLKFNDR."}
          </p>
        </section>
      )}
    </div>
  );
}
