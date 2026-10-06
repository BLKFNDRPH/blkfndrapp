"use client";

import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * What still stands between the builder and an open vault: fields to fill in,
 * and anything missing from "Before you begin", each with its fix where there
 * is one.
 *
 * Deliberately the same shape as BondBlockerDialog: both answer "why did
 * pressing Review not open anything", so they should look and read the same
 * rather than one being a dialog and the other a toast that slides away while
 * the builder is still looking at the form.
 *
 * The fields keep their own inline messages -- this says how many there are and
 * where to start, which a toast could not do for a form this long.
 */

export interface LaunchProblemAction {
  label: string;
  /** A page to go to; the draft is saved in this browser, so nothing is lost. */
  href?: string;
  /** Opens in a new tab. */
  external?: boolean;
  onClick?: () => void;
}

export type LaunchProblem = string | { text: string; actions?: LaunchProblemAction[] };

const textOf = (p: LaunchProblem) => (typeof p === "string" ? p : p.text);

export function LaunchBlockedDialog({
  problems,
  onClose,
}: {
  problems: LaunchProblem[] | null;
  onClose: () => void;
}) {
  const open = !!problems && problems.length > 0;
  const fromForm = problems?.some((p) => typeof p === "string") ?? false;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {problems && problems.length === 1
              ? "One thing still needs attention"
              : `${problems?.length ?? 0} things still need attention`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-left">
              <p>
                Nothing has been opened or charged. Fix {problems && problems.length === 1 ? "this" : "these"} and
                press Review again:
              </p>
              <ul className="space-y-3 pl-5">
                {problems?.map((p) => (
                  <li key={textOf(p)} className="list-disc space-y-1.5">
                    <span className="text-foreground">{textOf(p)}</span>
                    {typeof p !== "string" && p.actions && p.actions.length > 0 && (
                      <span className="flex flex-wrap gap-2">
                        {p.actions.map((a) =>
                          a.href ? (
                            <Button key={a.label} asChild size="sm" variant="outline" className="h-8 gap-1.5">
                              {a.external ? (
                                <a href={a.href} target="_blank" rel="noopener noreferrer" onClick={a.onClick}>
                                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                  {a.label}
                                </a>
                              ) : (
                                <Link href={a.href} onClick={a.onClick}>
                                  {a.label}
                                </Link>
                              )}
                            </Button>
                          ) : (
                            <Button
                              key={a.label}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={() => {
                                onClose();
                                a.onClick?.();
                              }}
                            >
                              {a.label}
                            </Button>
                          ),
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {fromForm && <p className="text-xs">Each field is also marked in red on the form.</p>}
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
