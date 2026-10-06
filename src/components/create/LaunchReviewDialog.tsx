"use client";

import { useEffect, useRef } from "react";
import { ShieldCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  isUnusualOpeningFee,
  launchMoney,
  networkFeeMoney,
  openingFeeXlm,
} from "./launch-readiness";

/**
 * The last look before the wallet opens.
 *
 * Everything that leaves the builder's wallet when the vault opens, in one
 * place, before they are asked to confirm it: the deposit and the flat listing
 * fee in the vault's own currency, and the network fee in XLM. The network fee
 * used to appear for the first time inside the wallet -- QA Trial #3 met a
 * 172 XLM figure there with no warning and no explanation.
 *
 * The fee is the simulated one, the same number the wallet will show. It is
 * the most the opening can charge: the network takes what it actually uses
 * and refunds the rest. On a normal day it is about half an XLM; far above
 * that, the dialog says so before anyone confirms.
 */

export interface LaunchReview {
  title: string;
  currency: string;
  goal: number;
  bond: number;
  platformFee: number;
  /** Total network fee for the transaction, in XLM. */
  networkFeeXlm: number;
  /** How many stages the plan has, which sets the usual fee to compare against. */
  stages: number;
  /** The deadline being sent, in epoch milliseconds. */
  deadlineMs: number;
  /** What the wallet can put toward the deposit and fee, in the vault's currency; null when unread. */
  held: number | null;
  /** Dollars per XLM, or null when no rate is available. */
  xlmUsd: number | null;
}

/**
 * The deadline in the builder's own time, and in UTC, which is what the
 * vault counts in. QA could not tell from anything on screen which deadline
 * a launch had actually sent.
 */
function deadline(ms: number) {
  const local = new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const utc = new Date(ms).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return { local, utc: `${utc} UTC` };
}

function Row({ label, note, value, className }: { label: string; note?: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex justify-between gap-4 px-3 py-2", className)}>
      <dt className="text-muted-foreground">
        {label}
        {note && <span className="block text-xs">{note}</span>}
      </dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function LaunchReviewDialog({
  review,
  onDecide,
}: {
  review: LaunchReview | null;
  onDecide: (approved: boolean) => void;
}) {
  // One answer per opening. Radix closes the dialog after the action button's
  // onClick, and that close arrives as onOpenChange(false) -- which would
  // otherwise report a cancel straight after the approval it follows.
  const decided = useRef(false);
  useEffect(() => {
    if (review) decided.current = false;
  }, [review]);
  const decide = (approved: boolean) => {
    if (decided.current) return;
    decided.current = true;
    onDecide(approved);
  };

  const money = (n: number) => (review ? launchMoney(n, review.currency, review.xlmUsd) : "");
  const total = review ? review.bond + review.platformFee : 0;
  const unusual = review ? isUnusualOpeningFee(review.networkFeeXlm, review.stages) : false;
  const shortBy = review && review.held !== null ? total - review.held : null;

  return (
    <AlertDialog open={review !== null} onOpenChange={(open) => { if (!open) decide(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Review before you open the vault
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-sm text-left">
              <p className="break-words">
                <span className="font-semibold text-foreground">{review?.title}</span> gets its own
                vault as soon as you confirm.
              </p>

              {review && (
                <dl className="divide-y rounded-lg border text-foreground">
                  <Row label="Goal" value={money(review.goal)} />
                  <Row
                    label="Deadline to reach it"
                    value={
                      <>
                        {deadline(review.deadlineMs).local}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {deadline(review.deadlineMs).utc}
                        </span>
                      </>
                    }
                  />
                  <Row
                    label="Your deposit"
                    note="Locked in the vault, returned when the last stage is paid"
                    value={money(review.bond)}
                  />
                  <Row label="Listing fee" note="Flat, paid to BLKFNDR" value={money(review.platformFee)} />
                  <Row
                    label={unusual ? "Network fee today, at most" : "Network fee, at most"}
                    note="Paid from your wallet in XLM. Whatever isn't used comes back."
                    value={networkFeeMoney(review.networkFeeXlm, review.xlmUsd)}
                    className={unusual ? "bg-amber-500/10" : undefined}
                  />
                  <div className="px-3 py-2">
                    <div className="flex justify-between gap-4 font-semibold">
                      <dt>Total from your wallet today</dt>
                      <dd className="text-right tabular-nums">
                        {money(total)}
                        <span className="block text-xs font-normal text-muted-foreground">plus the network fee</span>
                      </dd>
                    </div>
                    {review.held !== null && (
                      <p
                        className={cn(
                          "mt-1 text-right text-xs",
                          shortBy !== null && shortBy > 0
                            ? "font-medium text-destructive"
                            : "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {shortBy !== null && shortBy > 0
                          ? `You have ${money(review.held)}, ${money(shortBy)} short`
                          : `You have ${money(review.held)}`}
                      </p>
                    )}
                  </div>
                </dl>
              )}

              {unusual && review && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-foreground">
                  That network fee is far above the usual{" "}
                  {networkFeeMoney(openingFeeXlm(review.stages), review.xlmUsd)}. It most likely means storage
                  every vault shares has lapsed, and this opening would pay its one-off renewal. You can
                  go ahead, or wait and try again later.
                </p>
              )}

              <p>
                You&apos;ll confirm this once in your wallet. Nothing is paid until you approve there,
                and the request expires after about five minutes.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => decide(false)}>Not yet</AlertDialogCancel>
          <AlertDialogAction onClick={() => decide(true)}>
            {unusual ? "Open it anyway" : "Confirm in your wallet"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
