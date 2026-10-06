"use client";

import { Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ListingDraft } from "@/lib/listing-draft";
import { launchMoney } from "./launch-readiness";

export type DepositChoice = ListingDraft["deposit"];

/** The most the slider offers, as a percentage of the goal; a typed amount can go higher. */
const SLIDER_MAX_PCT = 25;

/**
 * The builder's deposit: what it is for, the minimum, and three ways to set
 * it -- a quick percentage, the slider, or an exact amount. A typed amount is
 * the builder's own and nothing overwrites it; when the stages change, the
 * field says what the minimum has become instead.
 */
export function DepositField({
  currency,
  xlmUsd,
  goal,
  minPct,
  minDeposit,
  deposit,
  choice,
  onChoose,
  minChangedTo,
  isValid,
}: {
  currency: string;
  xlmUsd: number | null;
  /** The goal, the sum of the stages. */
  goal: number;
  /** The minimum deposit as a percentage of the goal. */
  minPct: number;
  /** The minimum deposit, rounded up to the cent. */
  minDeposit: number;
  /** The deposit as it stands. */
  deposit: number;
  choice: DepositChoice;
  onChoose: (choice: DepositChoice) => void;
  /** Set when the stages changed the minimum after the builder chose a deposit. */
  minChangedTo: number | null;
  isValid: boolean;
}) {
  const money = (n: number) => launchMoney(n, currency, xlmUsd);
  const maxPct = Math.max(SLIDER_MAX_PCT, minPct);
  const chips = [...new Set([minPct, 10, 15])].filter((p) => p >= minPct && p <= maxPct).sort((a, b) => a - b);
  const currentPct = goal > 0 ? (deposit / goal) * 100 : minPct;
  const sliderPct = Math.min(maxPct, Math.max(minPct, currentPct));
  const unit = currency === "XLM" ? "XLM" : "$";

  const isActive = (p: number) =>
    (choice.kind === "min" && p === minPct) || (choice.kind === "pct" && choice.pct === p);

  return (
    <div className="space-y-3 rounded-xl border border-border/80 bg-accent/5 p-4">
      <div className="space-y-1">
        <label htmlFor="builder-deposit" className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Shield className="h-4 w-4 text-primary" aria-hidden="true" />
          Your deposit
        </label>
        <p className="text-sm text-muted-foreground">
          Locked in the vault when it opens. Returned to you when every stage is paid. Shared among
          stakeholders if a stage fails its vote.{" "}
          <span className="font-medium text-foreground">
            Minimum {minPct}% of your goal{goal > 0 ? `: ${money(minDeposit)}` : ""}.
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick deposit choices">
        {chips.map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={isActive(p) ? "default" : "outline"}
            className="h-8 rounded-full px-3"
            aria-pressed={isActive(p)}
            disabled={goal <= 0}
            onClick={() => onChoose(p === minPct ? { kind: "min" } : { kind: "pct", pct: p })}
          >
            {p}%{p === minPct ? " · minimum" : ""}
          </Button>
        ))}
      </div>

      <Slider
        min={minPct}
        max={maxPct}
        step={1}
        value={[Math.round(sliderPct)]}
        disabled={goal <= 0}
        onValueChange={([p]) => onChoose(p <= minPct ? { kind: "min" } : { kind: "pct", pct: p })}
        aria-label="Deposit as a percentage of your goal"
      />

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          {unit === "$" && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
              $
            </span>
          )}
          <Input
            id="builder-deposit"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={choice.kind === "amount" ? choice.amount : String(deposit)}
            onChange={(e) => onChoose({ kind: "amount", amount: e.target.value })}
            aria-invalid={!isValid}
            aria-describedby="builder-deposit-note"
            className={cn("h-10 rounded-xl text-sm font-semibold", unit === "$" ? "pl-7" : "pr-14")}
          />
          {unit === "XLM" && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
              XLM
            </span>
          )}
        </div>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {goal > 0 ? `${currentPct.toFixed(currentPct < 10 ? 1 : 0)}% of your goal` : ""}
        </span>
      </div>

      <div id="builder-deposit-note" className="space-y-1 text-sm">
        {minChangedTo !== null && (
          <p className="text-amber-700 dark:text-amber-400">
            Your stages changed; the minimum is now {money(minChangedTo)}.
          </p>
        )}
        {!isValid && goal > 0 && (
          <p className="flex flex-wrap items-center gap-2 font-medium text-destructive">
            That&apos;s below the minimum of {money(minDeposit)}.
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onChoose({ kind: "min" })}>
              Use the minimum
            </Button>
          </p>
        )}
      </div>
    </div>
  );
}
