"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getUsersByAddresses } from "@/lib/data.client";
import type { FundReceipt, Project } from "@/lib/types";
import { describeMoney, rawToUnits } from "@/lib/money";
import { projectHref } from "@/lib/project-href";

/**
 * For builders: who has staked in each of their vaults, by name where the
 * stakeholder has one and "Stakeholder #N" where they don't, largest first.
 * Never an address, never a stand-in face for someone without a picture.
 */

interface Row {
  address: string;
  totalRaw: bigint;
  firstAt: number;
}

export function StakeholdersTab({
  projects,
  allReceipts,
  loading,
  xlmUsd,
}: {
  projects: Project[];
  allReceipts: FundReceipt[];
  loading: boolean;
  xlmUsd: number | null;
}) {
  const [profiles, setProfiles] = useState<Record<string, { name?: string; creatorAvatar?: string }>>({});

  const byProject = useMemo(() => {
    const out = new Map<string, Row[]>();
    for (const p of projects) {
      const rows = new Map<string, Row>();
      for (const r of allReceipts) {
        if (String(r.project_id) !== String(p.id)) continue;
        const row = rows.get(r.contributor) ?? { address: r.contributor, totalRaw: 0n, firstAt: Infinity };
        row.totalRaw += BigInt(r.amount || "0");
        row.firstAt = Math.min(row.firstAt, r.fund_date || 0);
        rows.set(r.contributor, row);
      }
      out.set(p.id, [...rows.values()]);
    }
    return out;
  }, [projects, allReceipts]);

  useEffect(() => {
    const addresses = [...new Set([...byProject.values()].flat().map((r) => r.address))];
    if (addresses.length === 0) return;
    let cancelled = false;
    getUsersByAddresses(addresses)
      .then((found) => {
        if (!cancelled) setProfiles(found ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [byProject]);

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading stakeholders">
        {[0, 1].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        Once you open a vault, the people who stake in it show here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {projects.map((p) => {
        const rows = byProject.get(p.id) ?? [];
        // Numbered in the order they first staked, so a number keeps meaning
        // the same person as more people join.
        const order = [...rows].sort((a, b) => a.firstAt - b.firstAt).map((r) => r.address);
        const sorted = [...rows].sort((a, b) => Number(b.totalRaw - a.totalRaw));
        const currency = p.currencyType ?? "USDC";
        const total = sorted.reduce((sum, r) => sum + r.totalRaw, 0n);
        return (
          <section key={p.id} aria-label={`Stakeholders of ${p.title}`} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <Link href={projectHref(p.id)} className="font-semibold hover:underline">
                {p.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {sorted.length} {sorted.length === 1 ? "stakeholder" : "stakeholders"} ·{" "}
                {describeMoney(rawToUnits(total), currency, xlmUsd, "always").primary} staked
              </p>
            </div>
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stakeholders yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {sorted.map((r) => {
                  const profile = profiles[r.address];
                  const looksLikeAddress = /^[GC][A-Z2-7]{55}$/.test(profile?.name ?? "");
                  const number = order.indexOf(r.address) + 1;
                  const named = Boolean(profile?.name) && !looksLikeAddress;
                  const name = named ? profile!.name! : `Stakeholder #${number}`;
                  const initial = named ? name.charAt(0).toUpperCase() : String(number);
                  return (
                    <li key={r.address} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar className="h-7 w-7 shrink-0">
                          {profile?.creatorAvatar && <AvatarImage src={profile.creatorAvatar} alt="" />}
                          <AvatarFallback className="text-xs">{initial}</AvatarFallback>
                        </Avatar>
                        <span className="truncate text-sm">{name}</span>
                      </span>
                      <span className="shrink-0 text-sm font-medium">
                        {describeMoney(rawToUnits(r.totalRaw), currency, xlmUsd, "always").primary}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
