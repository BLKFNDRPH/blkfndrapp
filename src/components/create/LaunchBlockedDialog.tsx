"use client";

import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

/**
 * What still has to be filled in before a campaign can launch.
 *
 * Deliberately the same shape as BondBlockerDialog: both answer "why did
 * pressing Launch Campaign not launch anything", so they should look and read
 * the same rather than one being a dialog and the other a toast that slides
 * away while the builder is still looking at the form.
 *
 * The fields keep their own inline messages -- this says how many there are and
 * where to start, which a toast could not do for a form this long.
 */
export function LaunchBlockedDialog({
  problems,
  onClose,
}: {
  problems: string[] | null;
  onClose: () => void;
}) {
  const open = !!problems && problems.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {problems && problems.length === 1
              ? "One detail still needs attention"
              : `${problems?.length ?? 0} details still need attention`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-left">
              <p>
                Your campaign has not been launched and nothing has been sent to the
                network. Fix the following and press Launch Campaign again:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {problems?.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <p className="text-xs">
                Each one is also marked in red on the form.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
