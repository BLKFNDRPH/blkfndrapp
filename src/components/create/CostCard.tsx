"use client";

import { formatToken } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  launchMoney,
  networkFeeMoney,
  type FundsView,
} from "./launch-readiness";

/**
 * What opening this vault takes from the builder's wallet today, kept in view
 * while they fill in the form. The network fee here is the usual one for a
 * plan this size; the review shows the exact figure before anything is
 * confirmed.
 */
export function CostCard({
  currency,
  deposit,
  listingFee,
  feeXlm,
  xlmUsd,
  funds,
  className,
}: {
  currency: string;
  deposit: number;
  listingFee: number;
  /** The usual network fee for this plan, in XLM. */
  feeXlm: number;
  xlmUsd: number | null;
  funds: FundsView;
  className?: string;
}) {
  const money = (n: number) => launchMoney(n, currency, xlmUsd);
  const total = deposit + listingFee;
  const fee = `about ${feeXlm.toFixed(1)} XLM`;

  const wallet = (() => {
    switch (funds.state) {
      case "ready":
        if (funds.held === null) return { text: "Enough for this", tone: "ok" as const };
        return {
          text:
            currency === "XLM" || funds.xlm === null
              ? money(funds.held)
              : `${money(funds.held)} and ${formatToken(funds.xlm, "XLM", "never")}`,
          tone: "ok" as const,
        };
      case "short":
        return { text: `${money(funds.held)} · ${money(funds.shortBy)} short`, tone: "short" as const };
      case "fee-short":
        return { text: "Needs a little more XLM for the fee", tone: "short" as const };
      case "no-account":
        return { text: "Not activated yet", tone: "short" as const };
      case "no-trustline":
        return { text: currency === "XLM" ? "Not set up for this currency" : "Not set up for dollars yet", tone: "short" as const };
      case "signed-out":
        return { text: "Sign in to check", tone: "muted" as const };
      case "no-wallet":
        return { text: "No wallet set up yet", tone: "short" as const };
      case "loading":
        return { text: "Checking…", tone: "muted" as const };
      default:
        return { text: "Can't read it right now", tone: "muted" as const };
    }
  })();

  return (
    <section aria-label="What opening this vault costs" className={cn("rounded-xl border border-border bg-card p-4 text-sm", className)}>
      <p className="font-semibold text-foreground">Opening this vault costs you</p>
      <dl className="mt-3 space-y-2.5">
        <div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Your deposit</dt>
            <dd className="font-medium tabular-nums">{money(deposit)}</dd>
          </div>
          <p className="text-xs text-muted-foreground">Returned to you when the last stage is paid</p>
        </div>
        <div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Listing fee</dt>
            <dd className="font-medium tabular-nums">{money(listingFee)}</dd>
          </div>
          <p className="text-xs text-muted-foreground">Flat, paid to BLKFNDR</p>
        </div>
        <div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Network fee</dt>
            <dd className="text-right font-medium tabular-nums">{fee}</dd>
          </div>
          <p className="text-xs text-muted-foreground">
            About {networkFeeMoney(feeXlm, xlmUsd)} on a normal day, a little more for each stage, paid from your
            wallet. You see the exact figure before you confirm.
          </p>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-2.5 font-semibold">
          <dt>Total today</dt>
          <dd className="text-right tabular-nums">
            {money(total)}
            <span className="block text-xs font-normal text-muted-foreground">plus the network fee</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">In your wallet</dt>
          <dd
            className={cn(
              "text-right font-medium tabular-nums",
              wallet.tone === "ok" && "text-emerald-600 dark:text-emerald-400",
              wallet.tone === "short" && "text-amber-600 dark:text-amber-400",
              wallet.tone === "muted" && "text-muted-foreground",
            )}
          >
            {wallet.text}
          </dd>
        </div>
      </dl>
      {wallet.tone === "short" && (
        <a href="#before-you-begin" className="mt-2 block text-xs font-medium text-primary hover:underline">
          How to sort this out
        </a>
      )}
    </section>
  );
}
