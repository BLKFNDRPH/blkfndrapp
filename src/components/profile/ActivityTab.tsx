"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { getRecentAccountOperations, type StellarAccountActivityItem } from "@/lib/stellar";
import { describeActivity } from "@/lib/activity";
import { EXPLORER_BASE, EXPLORER_EXPLAINER } from "@/lib/network";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Everything the wallet has done lately, as sentences, newest first. Each row
 * opens to a reference and a link to the same entry on the public record, so
 * the statement never has to be taken on trust.
 */
export function ActivityTab({
  address,
  projects,
  xlmUsd,
}: {
  address: string;
  projects: Project[];
  xlmUsd: number | null;
}) {
  const [items, setItems] = useState<StellarAccountActivityItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    if (!address) return;
    setState("loading");
    try {
      setItems(await getRecentAccountOperations(address, 25));
      setState("ready");
    } catch (error) {
      console.warn("[ActivityTab] couldn't read activity:", error);
      setState("error");
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  const titleOf = useCallback(
    (vault: string | undefined) =>
      vault ? projects.find((p) => p.vaultAddress === vault)?.title ?? null : null,
    [projects],
  );

  if (!address) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        Set up your wallet to see your activity here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Your wallet&apos;s last 25 actions, newest first.</p>
        <Button variant="ghost" size="sm" onClick={load} disabled={state === "loading"} className="gap-1.5">
          <RefreshCw className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {state === "loading" && items.length === 0 ? (
        <div className="space-y-2" role="status" aria-label="Loading your activity">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg border border-border bg-muted/40" />
          ))}
        </div>
      ) : state === "error" ? (
        <div className="space-y-2 rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
          <p>We couldn&apos;t load your activity just now. Your money is where it was; try again.</p>
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          Nothing yet. Your stakes, votes and refunds will show here, with a receipt for each.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {items.map((item) => {
            const line = describeActivity(item, titleOf, xlmUsd);
            return (
              <li key={item.id}>
                <details className="group px-3 py-2.5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className={cn("block text-sm", line.failed ? "text-muted-foreground" : "text-foreground")}>
                        {line.sentence}
                        {line.failed && " (didn't go through)"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {line.amount && !line.failed && (
                        <span
                          className={cn(
                            "text-sm font-medium",
                            line.amount.startsWith("+") ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                          )}
                        >
                          {line.amount}
                        </span>
                      )}
                      <ChevronDown
                        className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {line.failed && (
                      <p>The network ran it and it didn&apos;t go through. Only the network fee was charged.</p>
                    )}
                    <p>
                      Reference{" "}
                      <span className="font-mono">
                        {item.transaction_hash.slice(0, 4)}…{item.transaction_hash.slice(-4)}
                      </span>
                    </p>
                    <a
                      href={`${EXPLORER_BASE}/tx/${item.transaction_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      See the public record
                    </a>
                    <p>{EXPLORER_EXPLAINER}</p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
