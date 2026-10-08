"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { StatusPill } from "@/components/project/ProjectCard";
import type { FundReceipt, Project } from "@/lib/types";
import { describeMoney, rawToUnits } from "@/lib/money";
import { describeStatus } from "@/lib/project-status";
import { projectHref } from "@/lib/project-href";
import { EXPLORER_BASE, EXPLORER_EXPLAINER } from "@/lib/network";

/**
 * "Your stakes": one row per vault, newest or largest first, with the one
 * thing worth doing next. Read from the stakes indexed for the account's
 * linked wallet, so the list never empties because a wallet isn't connected.
 */

type Sort = "latest" | "largest";

const shortDate = (ms: number) =>
  ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

interface Group {
  projectId: string;
  project: Project | undefined;
  receipts: FundReceipt[];
  totalRaw: bigint;
  latest: number;
}

function refundable(project: Project, now: number): boolean {
  if (project.status === "failed" || project.status === "refunding") return true;
  return (
    project.status === "raising" &&
    typeof project.fundingDeadline === "number" &&
    project.fundingDeadline > 0 &&
    project.fundingDeadline <= now &&
    project.currentFunding < project.fundingGoal
  );
}

export function StakesTab({
  receipts,
  projects,
  loading,
  xlmUsd,
}: {
  receipts: FundReceipt[];
  projects: Project[];
  loading: boolean;
  xlmUsd: number | null;
}) {
  const [sort, setSort] = useState<Sort>("latest");
  const now = Date.now();

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const r of receipts) {
      const g = map.get(r.project_id) ?? {
        projectId: r.project_id,
        project: projects.find((p) => p.id === r.project_id),
        receipts: [],
        totalRaw: 0n,
        latest: 0,
      };
      g.receipts.push(r);
      g.totalRaw += BigInt(r.amount || "0");
      g.latest = Math.max(g.latest, r.fund_date || 0);
      map.set(r.project_id, g);
    }
    const list = [...map.values()];
    return list.sort((a, b) =>
      sort === "latest" ? b.latest - a.latest : Number(b.totalRaw - a.totalRaw),
    );
  }, [receipts, projects, sort]);

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading your stakes">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">
          You haven&apos;t staked yet. Start with $5 in a project you believe in.
        </p>
        <Button asChild>
          <Link href="/projects">Browse projects</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Sort your stakes">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Latest</SelectItem>
            <SelectItem value="largest">Largest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ul className="space-y-3">
        {groups.map((g) => {
          const currency = g.project?.currencyType ?? g.receipts[0]?.currency_type ?? "USDC";
          const total = describeMoney(rawToUnits(g.totalRaw), currency, xlmUsd, "always").primary;
          const status = g.project ? describeStatus(g.project) : null;
          const action = g.project
            ? refundable(g.project, now)
              ? { label: "Collect your refund", href: projectHref(g.project.id, { tab: "stages" }) }
              : g.project.status === "funded" || g.project.status === "active"
                ? { label: "See the stages", href: projectHref(g.project.id, { tab: "stages" }) }
                : { label: "View project", href: projectHref(g.project.id) }
            : null;
          const vault = g.receipts[0]?.vault_address ?? g.project?.vaultAddress;

          return (
            <li key={g.projectId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {g.project?.imageUrl && (
                    <ImageWithFallback src={g.project.imageUrl} alt="" className="h-full w-full object-cover" fill />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  {g.project ? (
                    <Link
                      href={projectHref(g.project.id)}
                      className="block truncate font-semibold hover:underline"
                    >
                      {g.project.title}
                    </Link>
                  ) : (
                    <p className="truncate font-semibold">A vault no longer listed</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {total} staked · {shortDate(g.latest)}
                  </p>
                  {status && <StatusPill status={status} />}
                </div>
                {action && (
                  <Button asChild size="sm" variant={action.label === "Collect your refund" ? "default" : "outline"} className="shrink-0">
                    <Link href={action.href}>{action.label}</Link>
                  </Button>
                )}
              </div>

              <details className="group mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                  {g.receipts.length === 1 ? "1 stake" : `${g.receipts.length} stakes`}
                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {[...g.receipts]
                    .sort((a, b) => (b.fund_date || 0) - (a.fund_date || 0))
                    .map((r) => (
                      <li key={r.fund_id} className="flex justify-between gap-3 text-muted-foreground">
                        <span>
                          {describeMoney(rawToUnits(BigInt(r.amount || "0")), currency, xlmUsd, "always").primary} ·{" "}
                          {shortDate(r.fund_date)}
                        </span>
                      </li>
                    ))}
                </ul>
                {vault && (
                  <div className="mt-2 space-y-0.5">
                    <a
                      href={`${EXPLORER_BASE}/contract/${vault}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      Verify on Stellar Expert
                    </a>
                    <p className="text-[11px] text-muted-foreground">{EXPLORER_EXPLAINER}</p>
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
