"use client";

import { Shield } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type { BondReadiness } from "@/lib/bond-readiness";

/**
 * Why this builder cannot post their bond, and what to do about it.
 *
 * Nothing is signed or submitted on the builder's behalf. Adding an asset
 * changes their own wallet, so it belongs in Freighter where they can see what
 * they are agreeing to — this says what is wrong and exactly where to fix it.
 *
 * Replaces the raw host diagnostic that used to appear after signing, which
 * ended in "VM call trapped" and gave no indication that the answer was a
 * two-minute change in the wallet.
 */
export function BondBlockerDialog({
  blocker,
  onClose,
}: {
  blocker: BondReadiness | null;
  onClose: () => void;
}) {
  const problem = blocker && !blocker.ok ? blocker : null;

  return (
    <AlertDialog open={problem !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" />
            {problem?.reason === "no-account"
              ? "This wallet has not been funded yet"
              : problem?.reason === "insufficient"
                ? `Not enough ${problem.asset.code} for the bond`
                : `Add ${problem?.asset.code ?? "the asset"} in Freighter first`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-left">
              {problem?.reason === "no-trustline" && (
                <>
                  <p>
                    Launching a campaign locks your performance bond into the vault as it is
                    created. Your wallet cannot hold {problem.asset.code} yet, so there is nowhere
                    for that bond to come from and the deployment would fail on-chain.
                  </p>
                  <p className="font-medium text-foreground">To fix it in Freighter:</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>Open the Freighter extension.</li>
                    <li>Go to <span className="font-medium">Manage Assets</span>.</li>
                    <li>
                      Add <span className="font-mono font-semibold">{problem.asset.code}</span>,
                      then approve the change.
                    </li>
                    <li>Come back and press Launch Campaign again.</li>
                  </ol>
                  {problem.asset.issuer && (
                    <p className="text-xs">
                      If Freighter asks for the issuer:
                      <br />
                      <span className="font-mono break-all select-all">{problem.asset.issuer}</span>
                    </p>
                  )}
                </>
              )}

              {problem?.reason === "insufficient" && (
                <>
                  <p>
                    The performance bond is locked into the vault as it is created, and your wallet
                    does not hold enough {problem.asset.code} to cover it.
                  </p>
                  <p>
                    You hold{" "}
                    <span className="font-semibold text-foreground">
                      {Number(problem.held).toLocaleString()} {problem.asset.code}
                    </span>
                    , and the bond needs{" "}
                    <span className="font-semibold text-foreground">
                      {Number(problem.needed).toLocaleString()} {problem.asset.code}
                    </span>
                    .
                  </p>
                  <p>
                    Top the wallet up in Freighter, or lower the bond — it only has to reach the
                    minimum shown on the form.
                  </p>
                </>
              )}

              {problem?.reason === "no-account" && (
                <>
                  <p>
                    This wallet does not exist on the network yet, so it can hold nothing and sign
                    nothing. Stellar accounts have to be funded with XLM before they can be used.
                  </p>
                  <p>
                    Fund it from Freighter, then add {problem.asset.code} under{" "}
                    <span className="font-medium">Manage Assets</span> and try again.
                  </p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
