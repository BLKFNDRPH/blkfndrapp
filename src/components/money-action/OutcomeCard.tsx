"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Copy, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Outcome, OutcomeIntent } from "@/lib/explain-error";

/**
 * One failed money action, said plainly: a noun for what happened, a sentence
 * for why and what next, a line that always says whether money moved, one
 * primary button, and the raw error folded away under "Details for support".
 *
 * Grey for choices the person made (they declined, the goal was reached), red
 * only for true failures. Shared by the stake sheet and, later, votes and
 * refunds, so every money action fails the same way.
 */
export function OutcomeCard({
  outcome,
  onIntent,
}: {
  outcome: Outcome;
  onIntent: (intent: OutcomeIntent) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isError = outcome.tone === "error";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(outcome.technical);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Selecting the text by hand still works.
    }
  };

  return (
    <div
      role="alert"
      className={cn(
        "space-y-3 rounded-xl border p-4 text-left",
        isError ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            isError ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          {isError ? (
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Info className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-foreground">{outcome.title}</p>
          <p className="text-sm text-muted-foreground">{outcome.body}</p>
          <p className="text-sm font-medium text-foreground">{outcome.moneyLine}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="h-10 flex-1" onClick={() => onIntent(outcome.primary.intent)}>
          {outcome.primary.label}
        </Button>
        {outcome.secondary && (
          <Button
            type="button"
            variant="outline"
            className="h-10 flex-1"
            onClick={() => onIntent(outcome.secondary!.intent)}
          >
            {outcome.secondary.label}
          </Button>
        )}
      </div>

      <details className="group rounded-lg border border-border/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
          <span>Details for support</span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-2 border-t border-border/60 px-3 py-2">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
            {outcome.technical}
          </pre>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy for support"}
          </Button>
        </div>
      </details>
    </div>
  );
}
