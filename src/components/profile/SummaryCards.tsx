"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import { formatUsd, formatToken, rawToUnits } from "@/lib/money";
import type { Participation } from "./ProfileHeader";

/**
 * The two cards under the header: how this account takes part, and what its
 * wallet holds. Every balance says where it is held: in the person's own
 * wallet, never with BLKFNDR.
 */
export function SummaryCards({
  participation,
  walletAddress,
  usdcRaw,
  xlmRaw,
  xlmUsd,
  stakedUsd,
  stakedVaults,
  holdingsLoading,
}: {
  participation: Participation;
  walletAddress: string;
  usdcRaw: bigint | null;
  xlmRaw: bigint | null;
  xlmUsd: number | null;
  /** Dollars staked so far, across vaults, from the indexed stakes. */
  stakedUsd: number;
  stakedVaults: number;
  holdingsLoading: boolean;
}) {
  const lastFour = walletAddress ? walletAddress.slice(-4) : "";
  const usd = usdcRaw !== null ? rawToUnits(usdcRaw) : 0;
  const xlm = xlmRaw !== null ? rawToUnits(xlmRaw) : 0;
  const xlmInUsd = xlmUsd ? xlm * xlmUsd : null;
  const total = usd + (xlmInUsd ?? 0);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-label="Your participation" className="space-y-2 rounded-xl border border-border bg-card p-4">
        <p className="font-semibold">Your participation</p>
        {participation === "watching" ? (
          <p className="text-sm text-muted-foreground">
            Watching. Stake from $5 in any project to become a stakeholder.
          </p>
        ) : participation === "stakeholder" ? (
          <p className="text-sm text-muted-foreground">
            Stakeholder.{lastFour ? ` Your wallet is set up (...${lastFour}).` : ""} You vote on every payout
            in the vaults you staked in.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Builder.{lastFour ? ` Your wallet is set up (...${lastFour}).` : ""} You open votes on your
            stages and post proof; stakeholders decide every payout.
          </p>
        )}
        {participation === "watching" && (
          <Button asChild size="sm" variant="outline">
            <Link href="/projects">Browse projects</Link>
          </Button>
        )}
      </section>

      <section aria-label="In your wallet" className="space-y-2 rounded-xl border border-border bg-card p-4">
        <p className="flex items-center gap-2 font-semibold">
          In your wallet
          {IS_PRACTICE_NETWORK && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              practice money
            </span>
          )}
        </p>
        {!walletAddress ? (
          <p className="text-sm text-muted-foreground">Set up your wallet to see what it holds.</p>
        ) : holdingsLoading ? (
          <div className="space-y-1.5" role="status" aria-label="Reading your wallet">
            <div className="h-6 w-28 animate-pulse rounded bg-muted" />
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <>
            <p className="text-2xl font-semibold">
              {xlmInUsd !== null
                ? `${xlm > 0 ? "≈ " : ""}${formatUsd(total, "always")}`
                : `${formatUsd(usd, "always")}${xlm > 0 ? ` plus ${formatToken(xlm, "XLM")}` : ""}`}
            </p>
            <ul className="space-y-0.5 text-sm text-muted-foreground">
              <li>
                {formatUsd(usd, "always")} in dollars (USDC)
              </li>
              <li>
                {xlmInUsd !== null ? `≈ ${formatUsd(xlmInUsd, "always")} · ` : ""}
                {formatToken(xlm, "XLM")}, the network&apos;s own currency
              </li>
            </ul>
          </>
        )}
        {stakedVaults > 0 && (
          <p className="text-sm text-muted-foreground">
            You&apos;ve staked {formatUsd(stakedUsd, "always")} in {stakedVaults}{" "}
            {stakedVaults === 1 ? "vault" : "vaults"} so far.
          </p>
        )}
        <p className="text-xs text-muted-foreground">Held by your wallet, not by BLKFNDR.</p>
        {walletAddress && (
          <Button asChild size="sm" variant="outline">
            <Link href="/profile?tab=wallet">Add money</Link>
          </Button>
        )}
      </section>
    </div>
  );
}
