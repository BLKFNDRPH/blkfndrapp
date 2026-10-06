"use client";

import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { CubeSpinner } from "@/components/ui/CubeSpinner";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import type { BondAsset, BondReadiness } from "@/lib/bond-readiness";
import { formatToken } from "@/lib/money";
import { launchMoney } from "./launch-readiness";

/**
 * Why this builder's wallet cannot cover the vault opening, and what to do.
 *
 * Nothing is signed on the builder's behalf. For a wallet that can't hold the
 * vault's currency yet, the dialog can ask the wallet to allow exactly the
 * asset the vault uses; the builder approves it there, where they see what it
 * changes. A new wallet on the practice network can be activated from the
 * public faucet, which pays the builder's own address.
 *
 * Replaces the raw host diagnostic that used to appear after signing, which
 * ended in "VM call trapped" and gave no indication that the answer was a
 * two-minute change in the wallet.
 */
export function BondBlockerDialog({
  blocker,
  onClose,
  onEnableAsset,
  onActivate,
}: {
  blocker: BondReadiness | null;
  onClose: () => void;
  /**
   * Ask the wallet to allow the asset. Resolves once it is allowed, and the
   * dialog closes; a rejection's message is shown in the dialog.
   */
  onEnableAsset?: (asset: BondAsset) => Promise<void>;
  /** Activate a new wallet with practice XLM. Same contract as onEnableAsset. */
  onActivate?: () => Promise<void>;
}) {
  const problem = blocker && !blocker.ok ? blocker : null;
  const [working, setWorking] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  // A fresh problem starts without the last attempt's error.
  useEffect(() => {
    setWorking(false);
    setFixError(null);
  }, [blocker]);

  const canEnable =
    problem?.reason === "no-trustline" && !!problem.asset.issuer && !!onEnableAsset;
  const canActivate = problem?.reason === "no-account" && IS_PRACTICE_NETWORK && !!onActivate;

  const run = async (fix: () => Promise<void>) => {
    setWorking(true);
    setFixError(null);
    try {
      await fix();
    } catch (error) {
      setFixError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };

  const asset = problem && problem.reason !== "network-fee" ? problem.asset : null;
  const isDollar = asset !== null && !asset.isNative;
  const currencyName = (asset: BondAsset) => (asset.isNative ? "XLM" : asset.code === "USDC" ? "dollars" : asset.code);
  const money = (n: number, asset: BondAsset) => launchMoney(n, asset.isNative ? "XLM" : asset.code, null);

  return (
    <AlertDialog
      open={problem !== null}
      onOpenChange={(open) => {
        if (!open && !working) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" />
            {problem?.reason === "no-account"
              ? "This wallet hasn't been activated yet"
              : problem?.reason === "insufficient"
                ? `Not enough ${currencyName(problem.asset)} for the deposit and listing fee`
                : problem?.reason === "network-fee"
                  ? "Not enough XLM for the network fee"
                  : `Your wallet can't hold ${asset ? currencyName(asset) : "this currency"} yet`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-left">
              {problem?.reason === "no-trustline" && (
                <>
                  <p>
                    Opening the vault moves your deposit into it straight away. Your wallet hasn&apos;t
                    said yes to holding {isDollar ? "dollars (USDC)" : problem.asset.code} yet, so there is
                    nothing for the deposit to come from. Nothing has been opened or charged.
                  </p>
                  {canEnable ? (
                    <p>
                      It takes one approval in your wallet. It sets aside 0.5 XLM of your own while
                      it&apos;s on, which you get back if you turn it off. Nothing goes to BLKFNDR.
                    </p>
                  ) : (
                    <p>
                      Allow {problem.asset.code} in your wallet&apos;s settings, then come back and press
                      Review again.
                    </p>
                  )}
                </>
              )}

              {problem?.reason === "insufficient" && (
                <>
                  <p>
                    Your deposit is locked into the vault as it opens, and the flat listing fee is paid
                    in the same step, both in {currencyName(problem.asset)}. Your wallet doesn&apos;t hold
                    enough to cover them. Nothing has been opened or charged.
                  </p>
                  <dl className="divide-y rounded-lg border text-foreground">
                    <div className="flex justify-between gap-4 px-3 py-1.5">
                      <dt className="text-muted-foreground">Your deposit</dt>
                      <dd className="tabular-nums">{money(problem.bond, problem.asset)}</dd>
                    </div>
                    <div className="flex justify-between gap-4 px-3 py-1.5">
                      <dt className="text-muted-foreground">Listing fee</dt>
                      <dd className="tabular-nums">{money(problem.fee, problem.asset)}</dd>
                    </div>
                    <div className="flex justify-between gap-4 px-3 py-1.5 font-medium">
                      <dt>Needed</dt>
                      <dd className="tabular-nums">{money(problem.bond + problem.fee, problem.asset)}</dd>
                    </div>
                    {problem.held !== null && (
                      <>
                        <div className="flex justify-between gap-4 px-3 py-1.5">
                          <dt className="text-muted-foreground">
                            {problem.asset.isNative ? "You can spend" : "In your wallet"}
                          </dt>
                          <dd className="tabular-nums">{money(problem.held, problem.asset)}</dd>
                        </div>
                        <div className="flex justify-between gap-4 px-3 py-1.5 font-semibold">
                          <dt>Short by</dt>
                          <dd className="tabular-nums">
                            {money(Math.max(0, problem.bond + problem.fee - problem.held), problem.asset)}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  <p>
                    {isDollar && IS_PRACTICE_NETWORK
                      ? "Add practice dollars from “Enough in that wallet” at the top of the page, or lower your deposit; it only has to reach the minimum shown on the form."
                      : "Add money to your wallet, or lower your deposit; it only has to reach the minimum shown on the form."}
                  </p>
                </>
              )}

              {problem?.reason === "network-fee" && (
                <>
                  <p>
                    Every vault opening pays a network fee in XLM, whatever the vault&apos;s currency, and
                    the network won&apos;t take it from the small XLM reserve it keeps on your account.
                    Nothing has been opened or charged.
                  </p>
                  <dl className="divide-y rounded-lg border text-foreground">
                    <div className="flex justify-between gap-4 px-3 py-1.5">
                      <dt className="text-muted-foreground">Network fee, at most</dt>
                      <dd className="tabular-nums">{formatToken(Number(problem.needed.toFixed(4)), "XLM")}</dd>
                    </div>
                    <div className="flex justify-between gap-4 px-3 py-1.5">
                      <dt className="text-muted-foreground">You can spend</dt>
                      <dd className="tabular-nums">{formatToken(Number(problem.spendable.toFixed(4)), "XLM")}</dd>
                    </div>
                  </dl>
                  <p>Add a little XLM to your wallet, then press Review again.</p>
                </>
              )}

              {problem?.reason === "no-account" && (
                <>
                  <p>
                    A new wallet is empty until it receives its first XLM, so it can&apos;t hold a
                    deposit or confirm anything yet. Nothing has been opened or charged.
                  </p>
                  <p>
                    {canActivate
                      ? "The practice network's free faucet sends practice XLM straight to your wallet. It also covers network fees."
                      : "Send a little XLM to it from another wallet or an exchange, then press Review again."}
                    {!problem.asset.isNative && " After that, your wallet also needs to allow dollars; the next step offers it."}
                  </p>
                </>
              )}

              {fixError && (
                <p role="alert" className="font-medium text-destructive">
                  {fixError}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {(canEnable && problem?.reason === "no-trustline") || canActivate ? (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={working}>
                Not now
              </Button>
              {/* A plain button, not AlertDialogAction: that one closes the
                  dialog on click, before the wallet has answered. */}
              <Button
                type="button"
                onClick={() =>
                  run(async () => {
                    if (problem?.reason === "no-trustline" && onEnableAsset) await onEnableAsset(problem.asset);
                    else if (problem?.reason === "no-account" && onActivate) await onActivate();
                  })
                }
                disabled={working}
                aria-busy={working}
                className="min-w-[200px]"
              >
                {working && <CubeSpinner />}
                {problem?.reason === "no-account"
                  ? working
                    ? "Activating…"
                    : "Activate with practice XLM"
                  : working
                    ? "Waiting for your wallet…"
                    : isDollar
                      ? "Enable dollars"
                      : `Enable ${asset?.code ?? "it"}`}
              </Button>
            </>
          ) : (
            <AlertDialogAction onClick={onClose}>Got it</AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
