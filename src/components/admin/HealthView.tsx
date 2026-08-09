"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Users,
  FolderGit2,
  IdCard,
  Ban,
  Loader2,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import {
  factoryClient,
  treasuryClient,
  identityClient,
  simulate,
} from "@/lib/stellar-clients";
import { usePlatformInfo } from "@/context/BlockchainContext";
import { getHealthAction } from "@/actions/moderation";
import type { PlatformHealth } from "@/lib/data/moderation";

const NATIVE = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/**
 * A read of the platform's state, for the administrator who watches it.
 *
 * The indexer is the piece worth watching. It is the one moving part between the
 * chain and everything the console shows, and when it stalls the numbers do not
 * go blank — they go stale while looking fine. So its freshness leads: how long
 * since it last ran, and how far behind it is. The rest is counts and a reach
 * check on the three contracts the platform depends on.
 */
function ago(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: "never", stale: true };
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const stale = secs > 600; // 10 minutes without a run is worth a flag
  if (secs < 60) return { text: `${Math.round(secs)}s ago`, stale };
  if (secs < 3600) return { text: `${Math.round(secs / 60)}m ago`, stale };
  return { text: `${Math.round(secs / 3600)}h ago`, stale };
}

export function HealthView() {
  const { platformInfo } = usePlatformInfo();
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [reach, setReach] = useState<Record<string, boolean | null>>({
    factory: null,
    treasury: null,
    identity: null,
  });

  const treasury = platformInfo?.feeWalletAddress ?? "";

  useEffect(() => {
    getHealthAction()
      .then((res) => {
        if (res.success) setHealth(res.health);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [f, t, i] = await Promise.all([
        simulate(() => factoryClient().get_admin(), "reach factory"),
        treasury
          ? simulate(() => treasuryClient(treasury).balance_of({ token: NATIVE }), "reach treasury")
          : Promise.resolve(null),
        simulate(() => identityClient().get_admin(), "reach identity"),
      ]);
      if (cancelled) return;
      setReach({
        factory: f !== null,
        treasury: treasury ? t !== null : null,
        identity: i !== null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [treasury]);

  const indexer = ago(health?.indexerUpdatedAt ?? null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" aria-hidden="true" />
            Platform health
          </CardTitle>
          <CardDescription>
            The indexer is the one moving part between the chain and what the
            console shows. If it stalls, the numbers go stale while still looking
            fine — so its freshness is the first thing here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Reading platform health…
            </div>
          ) : (
            <>
              <div
                className={
                  "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 " +
                  (indexer.stale ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5")
                }
              >
                <div className="flex items-center gap-2">
                  {indexer.stale ? (
                    <CircleAlert className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  ) : (
                    <CircleCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                  )}
                  <span className="text-sm font-medium">
                    Indexer last ran {indexer.text}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  ledger {health?.lastProcessedLedger ?? "—"} ·{" "}
                  {health?.unprocessedEvents ?? 0} event
                  {health?.unprocessedEvents === 1 ? "" : "s"} unprocessed
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric icon={<Users className="h-4 w-4" />} label="Users" value={health?.users} />
                <Metric icon={<FolderGit2 className="h-4 w-4" />} label="Projects" value={health?.projects} />
                <Metric icon={<IdCard className="h-4 w-4" />} label="Pending KYC" value={health?.pendingKyc} />
                <Metric icon={<Ban className="h-4 w-4" />} label="Banned" value={health?.bannedUsers} />
              </div>

              <div className="space-y-1.5 rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">Contract reachability</p>
                <Reach label="Factory" ok={reach.factory} />
                <Reach label="Treasury" ok={reach.treasury} />
                <Reach label="Identity registry" ok={reach.identity} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value?: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="text-2xl font-semibold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}

function Reach({ label, ok }: { label: string; ok: boolean | null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      {ok === null ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : ok ? (
        <span className="flex items-center gap-1 text-xs text-emerald-500">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
          reachable
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          unreachable
        </span>
      )}
    </div>
  );
}
