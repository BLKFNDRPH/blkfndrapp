"use client";

import { useEffect, useState } from "react";
import { Vault, Loader2, AlertTriangle, Clock, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { treasuryClient, simulate } from "@/lib/stellar-clients";
import { usePlatformInfo } from "@/context/BlockchainContext";
import { shortenAddress } from "@/lib/utils";

/**
 * What the platform vault holds, and when it can next be released.
 *
 * Reads the vault at whatever address the factory currently sends fees to,
 * rather than a configured one. There is exactly one correct answer to "where do
 * the fees go", the factory holds it, and a second copy in configuration is the
 * kind of mistake that shows a healthy balance for a vault the fees stopped
 * arriving at months ago.
 *
 * The three numbers are deliberately separate. `balance` is everything the
 * contract holds; `reserved` is what earlier cycles still owe owners who have
 * not claimed; `available` is what a cycle opened now would actually settle.
 * Showing only the balance would overstate what is distributable, which is the
 * error that matters here.
 */
const XLM = 10_000_000; // stroops per unit

function amount(raw: bigint | null): string {
  if (raw === null) return "—";
  return (Number(raw) / XLM).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

interface VaultState {
  address: string;
  balance: bigint | null;
  reserved: bigint | null;
  available: bigint | null;
  nextReleaseAt: bigint | null;
  owners: { address: string; shareBps: number }[] | null;
  openCycle: { id: number; approvals: number; amount: bigint } | null;
  /** The vault could not be read at all — usually a superseded deployment. */
  unreadable: boolean;
}

const NATIVE = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export function PlatformVaultPanel() {
  const { platformInfo } = usePlatformInfo();
  const [state, setState] = useState<VaultState | null>(null);
  const [loading, setLoading] = useState(true);

  const address = platformInfo?.feeWalletAddress ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setLoading(false);
      return;
    }

    (async () => {
      const c = treasuryClient(address);

      const [balance, reserved, available, nextReleaseAt, owners, openCycle] =
        await Promise.all([
          simulate(() => c.balance_of({ token: NATIVE }), "balance_of"),
          simulate(() => c.get_reserved({ token: NATIVE }), "get_reserved"),
          simulate(() => c.get_available({ token: NATIVE }), "get_available"),
          simulate(() => c.next_release_at(), "next_release_at"),
          simulate(() => c.get_shareholders(), "get_shareholders"),
          simulate(() => c.get_open_cycle(), "get_open_cycle"),
        ]);

      if (cancelled) return;

      setState({
        address,
        balance: (balance as bigint | null) ?? null,
        reserved: (reserved as bigint | null) ?? null,
        available: (available as bigint | null) ?? null,
        nextReleaseAt: (nextReleaseAt as bigint | null) ?? null,
        owners:
          (owners as { address: string; share_bps: number }[] | null)?.map((o) => ({
            address: o.address,
            shareBps: o.share_bps,
          })) ?? null,
        openCycle: openCycle
          ? {
              id: (openCycle as any).id,
              approvals: (openCycle as any).approvals,
              amount: (openCycle as any).amount,
            }
          : null,
        // A vault whose balance cannot be read is not an empty vault. Saying so
        // matters most when the address points at a superseded deployment, which
        // is exactly when a confident "0.00" would be the wrong thing to show.
        unreadable: balance === null && owners === null,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Platform Vault</CardTitle>
          <CardDescription>
            The factory has no fee destination set, so listing fees are not being
            collected anywhere.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const nextRelease =
    state?.nextReleaseAt && state.nextReleaseAt > 0n
      ? new Date(Number(state.nextReleaseAt) * 1000)
      : null;
  const releasable = nextRelease ? nextRelease.getTime() <= Date.now() : true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Vault className="h-5 w-5" aria-hidden="true" />
          Platform Vault
        </CardTitle>
        <CardDescription>
          Where listing fees pool. Nobody can move money out alone — a release
          needs two thirds of the owners, and at most one release every 30 days.
          <span className="ml-1 font-mono text-xs">{shortenAddress(address)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading the vault…
          </div>
        ) : state?.unreadable ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium">This vault could not be read.</p>
              <p className="text-muted-foreground">
                The factory is sending fees to {shortenAddress(address)}, but it
                does not answer as a platform vault. Fees are still arriving
                there and cannot be released from the console.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure label="Available to release" value={amount(state?.available ?? null)} strong />
              <Figure label="Owed to earlier cycles" value={amount(state?.reserved ?? null)} />
              <Figure label="Total held" value={amount(state?.balance ?? null)} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {nextRelease ? (
                releasable ? (
                  <span>A cycle can be opened now.</span>
                ) : (
                  <span>
                    Next release available {nextRelease.toLocaleDateString()}.
                  </span>
                )
              ) : (
                <span>No release has happened yet, so a cycle can be opened now.</span>
              )}

              {state?.owners && (
                <>
                  <Users className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {state.owners.length} owner
                    {state.owners.length === 1 ? "" : "s"}, sharing equally
                  </span>
                </>
              )}
            </div>

            {state?.openCycle && (
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500">
                Cycle {state.openCycle.id} open — {state.openCycle.approvals} approval
                {state.openCycle.approvals === 1 ? "" : "s"} so far
              </Badge>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={strong ? "text-xl font-semibold" : "text-lg"}>
        {value} <span className="text-xs font-normal text-muted-foreground">XLM</span>
      </p>
    </div>
  );
}
