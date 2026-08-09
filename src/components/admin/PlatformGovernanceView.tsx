"use client";

import { useEffect, useState } from "react";
import { Landmark, AlertTriangle, Coins, ShieldAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { usePlatformInfo } from "@/context/BlockchainContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { TreasuryGovernancePanel } from "./TreasuryGovernancePanel";
import { shortenAddress } from "@/lib/utils";

/**
 * Platform policy, changed by vote rather than by one signature.
 *
 * The listing fee and the performance bond used to be sliders with a Save
 * button — the deployer's key set them directly. They are not a slider any more:
 * they are proposals the owners vote on, because a fee that funds the platform
 * and a bond that decides what a broken promise costs are not one person's to
 * set. The vote flow lives below; this view frames it with the terms as they
 * stand.
 *
 * There is a gap between proposing and applying, and it is honest to show it.
 * Executing a carried proposal calls the factory as its admin, and until the
 * factory's admin is the treasury, that call has nobody to make it. Owners can
 * propose and vote today; the change lands once the handover is done. A banner
 * says so rather than letting a carried vote fail at the last step with a raw
 * error.
 */
const XLM = 10_000_000;

export function PlatformGovernanceView() {
  const { platformInfo } = usePlatformInfo();
  const { getFactoryAdmin } = useStellarContract();
  const [factoryAdmin, setFactoryAdmin] = useState<string | null>(null);

  const treasury = platformInfo?.feeWalletAddress ?? "";

  useEffect(() => {
    let cancelled = false;
    getFactoryAdmin().then((a) => {
      if (!cancelled) setFactoryAdmin((a as string | null) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [getFactoryAdmin]);

  // The handover is done when the factory answers to the treasury. Until then a
  // carried proposal cannot be executed, because the treasury is not yet the
  // admin the factory's setters require.
  const handoverDone = Boolean(
    factoryAdmin && treasury && factoryAdmin === treasury,
  );
  const handoverKnown = factoryAdmin !== null;

  // feePercentage carries the flat fee in stroops despite its name; bond is
  // basis points. Presented as what each actually is.
  const feeXlm = platformInfo ? Number(platformInfo.feePercentage) / XLM : null;
  const bondPct =
    platformInfo?.bondPercentage != null
      ? Number(platformInfo.bondPercentage) / 100
      : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" aria-hidden="true" />
            Platform Governance
          </CardTitle>
          <CardDescription>
            The listing fee and the performance bond are set by an owner vote, not
            a single signature. These are the terms as they stand; propose a change
            below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                Listing fee
              </p>
              <p className="text-xl font-semibold">
                {feeXlm === null ? "—" : feeXlm.toLocaleString(undefined, { maximumFractionDigits: 7 })}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  XLM flat
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                A flat amount, charged once per listing. Never a percentage of
                what a project raises.
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                Performance bond
              </p>
              <p className="text-xl font-semibold">
                {bondPct === null ? "—" : `${bondPct}%`}
              </p>
              <p className="text-xs text-muted-foreground">
                What a builder posts against their raise and forfeits by missing a
                milestone.
              </p>
            </div>
          </div>

          {handoverKnown && !handoverDone && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-medium">
                  Proposals can be raised and voted now, but not yet applied.
                </p>
                <p className="text-muted-foreground">
                  Applying a carried change calls the factory as its admin, which
                  is still the deployer
                  {factoryAdmin ? ` (${shortenAddress(factoryAdmin)})` : ""} rather
                  than the treasury. Once the factory is handed to the treasury,
                  a carried vote executes. Until then, Execute will be refused by
                  the ledger.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <TreasuryGovernancePanel />
    </div>
  );
}
