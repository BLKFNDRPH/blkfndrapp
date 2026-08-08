"use client";

import { useEffect, useState } from "react";
import { ShieldQuestion, ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getModerationAction } from "@/actions/project-moderation";
import type { ProjectModeration } from "@/lib/data/project-moderation";

/**
 * Why a listing is not public yet, shown on its builder's own dashboard.
 *
 * The builder can still see a flagged project — the read policy keeps their own
 * listing visible to them — but without this it would simply be absent from the
 * public site with no explanation, which reads as the platform having lost it.
 *
 * Renders nothing at all for the ordinary case. Most listings are never flagged,
 * and a badge saying "not under review" would be noise on every project on the
 * platform.
 */
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
      <Badge variant="outline" className="gap-1.5 border-amber-500/40 text-amber-500">
        <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
        Under Admin Consensus Approval
      </Badge>
    );
  }

  if (moderation.state === "rejected") {
    return (
      <Badge variant="outline" className="gap-1.5 border-destructive/40 text-destructive">
        <ShieldX className="h-3 w-3" aria-hidden="true" />
        Not approved for listing
        {moderation.reason ? ` — ${moderation.reason}` : ""}
      </Badge>
    );
  }

  // Approved listings are ordinary listings. Worth saying once, because the
  // builder watched it sit under review and should see that it cleared.
  return (
    <Badge variant="outline" className="gap-1.5 border-emerald-500/40 text-emerald-500">
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      Approved by admin consensus
    </Badge>
  );
}
