"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  setProjectHiddenAction,
  setProjectLockedAction,
} from "@/actions/project-restrictions";
import type { Project, ProjectRestriction } from "@/lib/types";

export type RestrictionChange = "hide" | "unhide" | "lock" | "unlock";

/**
 * Confirm a hide or lock, and say why.
 *
 * The reason is required to restrict and optional to lift, and the database
 * enforces the first — this only keeps the button disabled until there is one.
 * Each confirmation states what the change does NOT do as well as what it does,
 * because the admin about to press it is the person most likely to overestimate
 * it: the vault keeps working whatever this platform decides.
 */
const COPY: Record<
  RestrictionChange,
  {
    title: string;
    description: string;
    warning?: string;
    reasonLabel: string;
    reasonHint: string;
    confirm: string;
    destructive: boolean;
    done: (title: string) => string;
    failed: string;
  }
> = {
  hide: {
    title: "Hide this project?",
    description:
      "It leaves explore, search, the home page and direct links. Its builder, its stakeholders and platform administrators can still open it, and its vault keeps working — stakeholders can still vote and reclaim their stake.",
    reasonLabel: "Reason",
    reasonHint: "Shown to the builder and the project's stakeholders, and kept in the audit log.",
    confirm: "Hide project",
    destructive: true,
    done: (t) => `"${t}" is hidden`,
    failed: "Could not hide the project",
  },
  unhide: {
    title: "Make this project public again?",
    description: "It returns to explore, search and the home page.",
    reasonLabel: "Note (optional)",
    reasonHint: "Kept in the audit log.",
    confirm: "Unhide project",
    destructive: false,
    done: (t) => `"${t}" is public again`,
    failed: "Could not unhide the project",
  },
  lock: {
    title: "Lock this project?",
    description:
      "The platform stops building new stakes, milestone vote openings and proof submissions for it. Stakeholders can still vote on an open milestone, execute a release they approved, and reclaim their stake.",
    warning:
      "The vault itself cannot be paused: this binds the platform, not the contract. A funded project that stays locked for 90 days without a milestone vote can be settled as stalled — stakeholders reclaim their stake and the builder's bond is forfeited.",
    reasonLabel: "Reason",
    reasonHint: "Shown on the listing to everyone who can see it, and kept in the audit log.",
    confirm: "Lock project",
    destructive: true,
    done: (t) => `"${t}" is locked`,
    failed: "Could not lock the project",
  },
  unlock: {
    title: "Unlock this project?",
    description: "New stakes, milestone votes and proof submission open again.",
    reasonLabel: "Note (optional)",
    reasonHint: "Kept in the audit log.",
    confirm: "Unlock project",
    destructive: false,
    done: (t) => `"${t}" is unlocked`,
    failed: "Could not unlock the project",
  },
};

export function ProjectRestrictionDialog({
  project,
  change,
  onClose,
  onDone,
}: {
  project: Pick<Project, "id" | "title" | "vaultAddress"> | null;
  change: RestrictionChange | null;
  onClose: () => void;
  onDone: (restriction: ProjectRestriction | null) => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const open = project !== null && change !== null;

  // A fresh reason per decision. One typed for a hide must not ride along into
  // the lock that follows it.
  useEffect(() => {
    if (open) setReason("");
  }, [open, change, project?.id]);

  if (!change) return null;
  const copy = COPY[change];
  const needsReason = change === "hide" || change === "lock";

  const submit = async () => {
    if (!project?.vaultAddress) return;
    setBusy(true);
    try {
      const res =
        change === "hide" || change === "unhide"
          ? await setProjectHiddenAction(project.vaultAddress, change === "hide", reason)
          : await setProjectLockedAction(project.vaultAddress, change === "lock", reason);

      if (res.success) {
        toast({ title: copy.done(project.title) });
        onDone(res.restriction ?? null);
        onClose();
      } else {
        toast({ title: copy.failed, description: res.error, variant: "destructive" });
      }
    } catch (error) {
      toast({
        title: copy.failed,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-[480px] max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="break-words">
            <span className="font-semibold text-foreground">{project?.title}</span>
            {" — "}
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        {copy.warning && (
          <p className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
            <span>{copy.warning}</span>
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="restriction-reason">{copy.reasonLabel}</Label>
          <Textarea
            id="restriction-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="resize-none"
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">{copy.reasonHint}</p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={copy.destructive ? "destructive" : "default"}
            onClick={submit}
            disabled={busy || (needsReason && !reason.trim())}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
