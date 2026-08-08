"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ChevronUp,
  Loader2,
  Lightbulb,
  ThumbsUp,
  ThumbsDown,
  CircleCheck,
  CircleX,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  getFeatureRequestsAction,
  submitFeatureRequestAction,
  toggleUpvoteAction,
  decideFeatureRequestAction,
} from "@/actions/feature-requests";
import type { FeatureRequest } from "@/lib/data/feature-requests";

/**
 * The community roadmap.
 *
 * An upvote is a request to be counted, not a vote that decides anything — the
 * owners' two-thirds does that. The two are shown separately and never summed,
 * because a board that let popularity carry a decision would hand the roadmap to
 * whoever can organise the most accounts, and would leave no way to decline
 * something popular and unbuildable.
 *
 * Owners see the tally; everyone else sees the outcome. What was decided is
 * public; how each owner voted is not.
 */
const STATUS: Record<
  FeatureRequest["status"],
  { label: string; icon: typeof CircleCheck; className: string }
> = {
  open: { label: "Open", icon: Lightbulb, className: "border-border text-muted-foreground" },
  planned: { label: "Planned", icon: CircleCheck, className: "border-emerald-500/40 text-emerald-500" },
  declined: { label: "Declined", icon: CircleX, className: "border-destructive/40 text-destructive" },
  shipped: { label: "Shipped", icon: Rocket, className: "border-sky-500/40 text-sky-500" },
};

export function FeatureRequestBoard() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    getFeatureRequestsAction()
      .then((res) => {
        if (res.success) setRequests(res.requests ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const run = (
    key: string,
    label: string,
    action: () => Promise<{ success: boolean; requests?: FeatureRequest[]; error?: string }>,
  ) => {
    setBusy(key);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.success) {
          setRequests(res.requests ?? []);
          if (key === "__submit__") {
            setTitle("");
            setBody("");
          }
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Request a feature</CardTitle>
          <CardDescription>
            Anyone with an account can ask. Upvotes show how many people want
            something; whether it gets built is decided by the platform owners,
            who need a two-thirds vote either way.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short title"
            maxLength={160}
            aria-label="Feature request title"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What would this do, and who would it help?"
            rows={3}
            maxLength={5000}
            aria-label="Feature request detail"
          />
          <Button
            disabled={title.trim().length < 3 || busy === "__submit__"}
            onClick={() =>
              run("__submit__", "Request submitted", () =>
                submitFeatureRequestAction(title, body),
              )
            }
          >
            {busy === "__submit__" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Lightbulb className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1.5">Submit</span>
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the roadmap…
        </div>
      ) : requests.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Nothing has been requested yet. Yours would be the first.
        </p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const s = STATUS[r.status];
            const Icon = s.icon;
            return (
              <li key={r.id} className="flex gap-3 rounded-xl border p-4">
                <button
                  type="button"
                  disabled={r.hasUpvoted === null || busy === r.id}
                  title={
                    r.hasUpvoted === null
                      ? "Sign in to upvote"
                      : r.hasUpvoted
                        ? "Remove your upvote"
                        : "Upvote"
                  }
                  aria-label={`Upvote ${r.title}`}
                  onClick={() =>
                    run(r.id, r.hasUpvoted ? "Upvote removed" : "Upvoted", () =>
                      toggleUpvoteAction(r.id, !r.hasUpvoted),
                    )
                  }
                  className={cn(
                    "flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-lg border",
                    r.hasUpvoted
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                    r.hasUpvoted === null && "opacity-60",
                  )}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-semibold">{r.upvotes}</span>
                </button>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{r.title}</p>
                    <Badge variant="outline" className={cn("gap-1", s.className)}>
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {s.label}
                    </Badge>
                    {r.mine && (
                      <span className="text-xs text-muted-foreground">(yours)</span>
                    )}
                  </div>

                  {r.body && (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {r.body}
                    </p>
                  )}

                  {r.response && (
                    <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
                      {r.response}
                    </p>
                  )}

                  {/* Owners only. The tally is how the decision is going, which
                      is not the same as what was decided — the latter is the
                      badge above and is public. */}
                  {r.consensus && r.status === "open" && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs text-muted-foreground">
                        {r.consensus.approvals} of {r.consensus.needed} owner votes
                        needed
                        {r.consensus.rejections > 0
                          ? `, ${r.consensus.rejections} against`
                          : ""}
                      </span>
                      <Button
                        size="sm"
                        variant={r.myDecision === true ? "default" : "outline"}
                        disabled={busy === r.id}
                        onClick={() =>
                          run(r.id, "Decision recorded", () =>
                            decideFeatureRequestAction(r.id, true),
                          )
                        }
                      >
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="ml-1.5">Plan it</span>
                      </Button>
                      <Button
                        size="sm"
                        variant={r.myDecision === false ? "destructive" : "outline"}
                        disabled={busy === r.id}
                        onClick={() =>
                          run(r.id, "Decision recorded", () =>
                            decideFeatureRequestAction(r.id, false),
                          )
                        }
                      >
                        <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="ml-1.5">Decline</span>
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
