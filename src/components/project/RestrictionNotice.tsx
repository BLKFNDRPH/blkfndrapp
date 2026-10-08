"use client";

import { EyeOff, PauseCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectRestriction } from "@/lib/types";

/**
 * Why a project is restricted, for whoever can see it.
 *
 * A pause is shown to everyone who can open the listing, reason included — the
 * platform restricting a project is exactly the kind of act this platform
 * exists to make visible, and a stakeholder deciding what to do next deserves
 * the reason. An unlisted project is seen only by its builder, its stakeholders
 * and the console, so for them this explains why it is missing from the site.
 *
 * Each notice says what is NOT affected as plainly as what is. The vault has no
 * pause switch, and a reader who believed their refund was frozen would be
 * believing something false.
 *
 * Renders nothing for an unrestricted project, which is nearly all of them.
 */
export function RestrictionNotice({
  restriction,
  className,
}: {
  restriction?: ProjectRestriction | null;
  className?: string;
}) {
  if (!restriction || (!restriction.hidden && !restriction.locked)) return null;

  const pausedReason = restriction.lockedReason?.trim();

  return (
    <div className={cn("space-y-2", className)}>
      {restriction.locked && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          <p className="flex items-start gap-2 font-semibold text-amber-700 dark:text-amber-400">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-words">
              Paused by BLKFNDR{pausedReason ? `: ${pausedReason}.` : "."}
            </span>
          </p>
          <p className="mt-1 text-muted-foreground">
            New stakes are hidden from the listing in this app while BLKFNDR
            reviews it. Everything else keeps working here: the builder can
            still open a vote, stakeholders can still vote, and refunds and
            approved payouts are unaffected. Nobody, including BLKFNDR, can
            lock the vault contract itself.
          </p>
        </div>
      )}

      {restriction.hidden && (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted/40 p-3 text-sm"
        >
          <p className="flex items-start gap-2 font-semibold">
            <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Unlisted: this project doesn&apos;t appear in search. Only its
              builder, its stakeholders and BLKFNDR staff can open it. The vault
              is unaffected.
            </span>
          </p>
          {restriction.hiddenReason?.trim() && (
            <p className="mt-1 break-words text-muted-foreground">
              {restriction.hiddenReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact form, for cards and tables. The reason rides along as a tooltip. */
export function RestrictionBadges({
  restriction,
  className,
}: {
  restriction?: ProjectRestriction | null;
  className?: string;
}) {
  if (!restriction || (!restriction.hidden && !restriction.locked)) return null;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {restriction.hidden && (
        <Badge
          variant="outline"
          className="gap-1 border-muted-foreground/40 text-muted-foreground"
          title={restriction.hiddenReason || undefined}
        >
          <EyeOff className="h-3 w-3" aria-hidden="true" />
          Unlisted
        </Badge>
      )}
      {restriction.locked && (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
          title={restriction.lockedReason || undefined}
        >
          <PauseCircle className="h-3 w-3" aria-hidden="true" />
          Paused by BLKFNDR
        </Badge>
      )}
    </span>
  );
}
