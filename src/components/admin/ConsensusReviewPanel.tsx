"use client";

import { useEffect, useState, useTransition } from "react";
import { ThumbsUp, ThumbsDown, Loader2, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  getPendingReviewsAction,
  voteOnProjectAction,
  clearModerationAction,
} from "@/actions/project-moderation";
import type { ProjectModeration } from "@/lib/data/project-moderation";

/**
 * Listings waiting on the owners' agreement.
 *
 * The tally is shown rather than just a yes/no button, because two-to-one is not
 * obvious at every roster size — three of four is needed, not two — and an owner
 * about to cast the deciding vote should be able to see that it is the deciding
 * one before they cast it.
 *
 * Owners who have never signed in are not counted. Voting needs an account, so
 * counting an outstanding invitation would raise a threshold nobody could reach.
 */
export function ConsensusReviewPanel() {
  const { toast } = useToast();
  const [reviews, setReviews] = useState<ProjectModeration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = async () => {
    const res = await getPendingReviewsAction();
    if (res.success) setReviews(res.reviews ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const act = (
    projectId: string,
    label: string,
    run: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    setBusy(projectId);
    startTransition(async () => {
      try {
        const res = await run();
        if (res.success) {
          await load();
          toast({ title: label });
        } else {
          toast({ title: `${label} failed`, description: res.error, variant: "destructive" });
        }
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listings Awaiting Consensus</CardTitle>
        <CardDescription>
          Flagged listings stay hidden from the public until two thirds of the
          owners agree to publish them — the same threshold that releases the fee
          treasury. Their builders can still see them, marked as under review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading reviews…
          </div>
        ) : reviews.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nothing is waiting on a decision. Listings appear here only when an
            owner flags one.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {reviews.map((r) => {
              const c = r.consensus;
              return (
                <li key={r.projectId} className="space-y-2 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium">
                        {r.projectId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Flagged {new Date(r.flaggedAt).toLocaleDateString()}
                        {r.reason ? ` — ${r.reason}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 gap-1">
                      <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
                      {c ? `${c.approvals} of ${c.needed} needed` : "Pending"}
                    </Badge>
                  </div>

                  {c && (
                    <p className="text-xs text-muted-foreground">
                      {c.approvals} for, {c.rejections} against, {c.owners} owner
                      {c.owners === 1 ? "" : "s"} able to vote.
                      {c.approvals + 1 >= c.needed && r.myVote === null
                        ? " Yours would carry it."
                        : ""}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={r.myVote === true ? "default" : "outline"}
                      disabled={busy === r.projectId}
                      onClick={() =>
                        act(r.projectId, "Vote recorded", () =>
                          voteOnProjectAction(r.projectId, true),
                        )
                      }
                    >
                      {busy === r.projectId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="ml-1.5">Approve</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={r.myVote === false ? "destructive" : "outline"}
                      disabled={busy === r.projectId}
                      onClick={() =>
                        act(r.projectId, "Vote recorded", () =>
                          voteOnProjectAction(r.projectId, false),
                        )
                      }
                    >
                      <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="ml-1.5">Reject</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === r.projectId}
                      title="Stop requiring consensus; the listing becomes public"
                      onClick={() =>
                        act(r.projectId, "Review cleared", () =>
                          clearModerationAction(r.projectId),
                        )
                      }
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="ml-1.5">Clear</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
