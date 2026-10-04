"use client";

import { useEffect, useState } from "react";
import { ShieldQuestion, ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getModerationAction } from "@/actions/project-moderation";
import type { ProjectModeration } from "@/lib/data/project-moderation";

/**
 * Where a listing stands in BLKFNDR's listing review, shown on its builder's
 * own dashboard.
 *
 * The builder can still see a flagged project — the read policy keeps their own
 * listing visible to them — but without this it would simply be absent from the
 * public site with no explanation, which reads as the platform having lost it.
 *
 * Listing review is about the listing, never the vault: the words here say so,
 * because "approval" would imply the platform can gate the money.
 *
 * Renders nothing at all for the ordinary case. Most listings are never flagged,
 * and a badge saying "not under review" would be noise on every project on the
 * platform.
 */

export const UNDER_REVIEW_LABEL = "Under listing review";
export const UNDER_REVIEW_TOOLTIP =
  "A BLKFNDR reviewer hasn't checked this listing yet. The vault rules apply either way.";

export function ConsensusBadge({ projectId }: { projectId: string }) {
  const [moderation, setModeration] = useState<ProjectModeration | null>(null);

  useEffect(() => {
    let cancelled = false;
    getModerationAction(projectId).then((res) => {
      if (!cancelled && res.success) setModeration(res.moderation ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!moderation) return null;

  if (moderation.state === "pending") {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              tabIndex={0}
              className="cursor-default gap-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400"
            >
              <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
              {UNDER_REVIEW_LABEL}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">
            {UNDER_REVIEW_TOOLTIP}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (moderation.state === "rejected") {
    return (
      <Badge variant="outline" className="gap-1.5 border-destructive/40 text-destructive">
        <ShieldX className="h-3 w-3" aria-hidden="true" />
        Not listed
        {moderation.reason ? ` — ${moderation.reason}` : ""}
      </Badge>
    );
  }

  // A reviewed listing is an ordinary listing. Worth saying once, because the
  // builder watched it sit under review and should see that it cleared.
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
    >
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      Reviewed
    </Badge>
  );
}
