"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { getMyRoleAction } from "@/actions/admins";
import { canRestrictProjects, type AdminRole } from "@/lib/admin-roles";
import type { Project } from "@/lib/types";
import {
  ProjectRestrictionDialog,
  type RestrictionChange,
} from "./ProjectRestrictionDialog";

/**
 * Hide and lock, inside a project's own view.
 *
 * Here rather than only in the console's table so that a listing can be acted
 * on from wherever an administrator finds it — a report usually arrives as a
 * link, not a row number. Renders nothing for anyone else. The role is asked
 * fresh from the roster for any signed-in session — not read from the auth
 * context's `user.role`, which is not filled from the roster — and a signed-out
 * visitor costs no round trip at all. The database refuses the change for any
 * other role regardless; this decides only whether the buttons appear.
 */
export function ProjectRestrictionControls({
  project,
  onChanged,
}: {
  project: Project;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [role, setRole] = useState<AdminRole | null>(null);
  const [change, setChange] = useState<RestrictionChange | null>(null);
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) {
      setRole(null);
      return;
    }
    let cancelled = false;
    getMyRoleAction().then((res) => {
      if (!cancelled) setRole(res.role);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (!canRestrictProjects(role) || !project.vaultAddress) return null;

  const hidden = project.restriction?.hidden === true;
  const locked = project.restriction?.locked === true;

  return (
    <div className="border-t pt-4">
      <h4 className="font-semibold">Platform controls</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Hiding and locking act on this platform only. Neither touches the vault.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setChange(hidden ? "unhide" : "hide")}>
          {hidden ? (
            <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          )}
          {hidden ? "Unhide" : "Hide"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setChange(locked ? "unlock" : "lock")}>
          {locked ? (
            <LockOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          )}
          {locked ? "Unlock" : "Lock"}
        </Button>
      </div>

      <ProjectRestrictionDialog
        project={change ? project : null}
        change={change}
        onClose={() => setChange(null)}
        onDone={onChanged}
      />
    </div>
  );
}
