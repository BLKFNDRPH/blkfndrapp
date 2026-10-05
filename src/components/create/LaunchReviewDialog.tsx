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

/**
 * The last look before Freighter opens.
 *
 * Everything that leaves the builder's wallet in the launch transaction, in
 * one place, before they are asked to sign it: the bond and the flat listing
 * fee in the vault's own asset, and the network fee in XLM. The network fee
 * used to appear for the first time inside Freighter -- QA Trial #3 met a
 * 172 XLM figure there with no warning and no explanation.
 *
 * The fee is the simulated one, the same number Freighter will show. It is the
 * most the launch can charge: the network takes what it actually uses and
 * refunds the rest, so the charge is usually lower (QA saw a maximum about
 * twice the 5.42 XLM charged).
 */

export interface LaunchReview {
  title: string;
  currency: string;
  goal: number;
  bond: number;
  platformFee: number;
  /** Total network fee for the transaction, in XLM. */
  networkFeeXlm: number;
  /** The funding deadline being sent, in epoch milliseconds. */
  deadlineMs: number;
}

function amount(value: number, unit: string) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 7 })} ${unit}`;
}

/**
 * The deadline in the builder's own time, and in UTC, which is what the
 * contract counts in. QA could not tell from anything on screen which
 * deadline a launch had actually sent.
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

  return (
    <AlertDialog open={review !== null} onOpenChange={(open) => { if (!open) decide(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Review and sign
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-sm text-left">
              <p className="break-words">
                <span className="font-semibold text-foreground">{review?.title}</span> gets
                its own vault as soon as this transaction lands.
              </p>

              {review && (
                <dl className="divide-y rounded-lg border text-foreground">
                  <div className="flex justify-between gap-4 px-3 py-2">
                    <dt className="text-muted-foreground">Funding goal</dt>
                    <dd className="font-medium tabular-nums">{amount(review.goal, review.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 px-3 py-2">
                    <dt className="text-muted-foreground">Funding deadline</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {deadline(review.deadlineMs).local}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {deadline(review.deadlineMs).utc}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 px-3 py-2">
                    <dt className="text-muted-foreground">Performance bond, locked in the vault</dt>
                    <dd className="font-medium tabular-nums">{amount(review.bond, review.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 px-3 py-2">
                    <dt className="text-muted-foreground">Listing fee (flat)</dt>
                    <dd className="font-medium tabular-nums">{amount(review.platformFee, review.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 px-3 py-2">
                    <dt className="text-muted-foreground">
                      Network fee, at most
                      <span className="block text-xs">Paid to Stellar. Unused fee is refunded.</span>
                    </dt>
                    <dd className="font-medium tabular-nums">{amount(Number(review.networkFeeXlm.toFixed(4)), "XLM")}</dd>
                  </div>
                </dl>
              )}

              <p>
                Freighter opens next. Approve or reject there within about five
                minutes — Freighter drops a request left open longer, and nothing
                is sent until you approve.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => decide(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => decide(true)}>Sign in Freighter</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
