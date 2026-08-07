"use client";

import { useEffect, useState, useTransition } from "react";
import { UserPlus, Trash2, Loader2, ShieldCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import {
  getAdminsAction,
  grantAdminAction,
  revokeAdminAction,
} from "@/actions/admins";

interface Row {
  email: string;
  grantedAt: string;
  note: string;
  claimed: boolean;
}

/**
 * Who may use the console.
 *
 * Distinct from the on-chain admin roster shown elsewhere in this dashboard.
 * That one decides whose signature a contract will accept; this one decides who
 * can sign in here. Someone reviewing KYC applications needs the second and has
 * no business holding the first, which is exactly why they are separate lists.
 *
 * An address can be added before the account exists — the row is claimed on
 * first sign-in — so onboarding does not depend on the person registering first.
 */
export function PlatformAdminManager() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [admins, setAdmins] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getAdminsAction()
      .then((res) => {
        if (!cancelled && res.success) setAdmins(res.admins ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = (
    label: string,
    key: string,
    action: () => Promise<{ success: boolean; admins?: Row[]; error?: string }>,
  ) => {
    setBusy(key);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.success) {
          setAdmins(res.admins ?? []);
          setDraft("");
          toast({ title: label });
        } else {
          toast({ title: `${label} failed`, description: res.error, variant: "destructive" });
        }
      } finally {
        setBusy(null);
      }
    });
  };

  const ownEmail = (user?.email ?? "").toLowerCase();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Console Administrators</CardTitle>
        <CardDescription>
          Who can sign in to this dashboard, by email — password or Google, either
          works. This is separate from the on-chain admin roster: adding someone
          here does not let them sign a contract change, and the ledger does not
          consult this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                e.preventDefault();
                run("Administrator added", "__add__", () => grantAdminAction(draft));
              }
            }}
            placeholder="name@example.com"
            aria-label="Email address to grant administrator access"
          />
          <Button
            onClick={() => run("Administrator added", "__add__", () => grantAdminAction(draft))}
            disabled={!draft.trim() || busy === "__add__"}
          >
            {busy === "__add__" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1.5">Add</span>
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading administrators…
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {admins.map((a) => {
              const isSelf = a.email.toLowerCase() === ownEmail;
              return (
                <li key={a.email} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {a.email}
                      {isSelf && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(a.grantedAt).toLocaleDateString()}
                      {a.note ? ` — ${a.note}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {a.claimed ? (
                      <Badge variant="secondary" className="gap-1">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        Not signed in yet
                      </Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      // Blocked in the database too, by guard_admin_removal.
                      // Disabling it here just avoids offering an action that
                      // will always be refused.
                      disabled={isSelf || busy === a.email}
                      title={isSelf ? "You cannot remove your own access" : "Remove"}
                      aria-label={`Remove ${a.email}`}
                      onClick={() =>
                        run(`Removed ${a.email}`, a.email, () => revokeAdminAction(a.email))
                      }
                    >
                      {busy === a.email ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          You cannot remove your own access, and the last administrator cannot be
          removed — a roster that can be emptied leaves nobody able to restore it.
        </p>
      </CardContent>
    </Card>
  );
}
