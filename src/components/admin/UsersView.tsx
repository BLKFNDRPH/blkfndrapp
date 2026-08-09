"use client";

import { useEffect, useState, useTransition } from "react";
import { Ban, ShieldCheck, Loader2, Search, UserX } from "lucide-react";
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
import { shortenAddress } from "@/lib/utils";
import {
  getUsersAction,
  banUserAction,
  unbanUserAction,
} from "@/actions/moderation";
import type { PlatformUser } from "@/lib/data/moderation";

/**
 * Users, and the ban a platform administrator can place on one.
 *
 * A ban here reaches two places at once — it hides the person's listings from
 * the public and locks their account out — so the button carries more weight
 * than it looks. Banning asks for a reason, because "why" is the thing a later
 * administrator (or the banned person's appeal) will need, and a ban with no
 * recorded reason is a decision nobody can review.
 */
export function UsersView() {
  const { toast } = useToast();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    getUsersAction()
      .then((res) => {
        if (res.success) setUsers(res.users ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const run = (
    id: string,
    label: string,
    action: () => Promise<{ success: boolean; users?: PlatformUser[]; error?: string }>,
  ) => {
    setBusy(id);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.success) {
          setUsers(res.users ?? []);
          setReasonFor(null);
          setReason("");
          toast({ title: label });
        } else {
          toast({ title: `${label} failed`, description: res.error, variant: "destructive" });
        }
      } finally {
        setBusy(null);
      }
    });
  };

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      (u.wallet ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserX className="h-5 w-5" aria-hidden="true" />
          Users
        </CardTitle>
        <CardDescription>
          Banning a user hides their listings from the public and locks their
          account out. It asks for a reason, because a ban nobody can explain is a
          ban nobody can review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or wallet"
            className="pl-9"
            aria-label="Search users"
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading users…
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No users match.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {filtered.map((u) => (
              <li key={u.id} className="space-y-2 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {u.name}
                      {u.banned && (
                        <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
                          <Ban className="h-3 w-3" aria-hidden="true" />
                          Banned
                        </Badge>
                      )}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {u.wallet ? shortenAddress(u.wallet) : "no wallet"}
                      {u.banned && u.banReason ? ` · ${u.banReason}` : ""}
                    </p>
                  </div>
                  {u.banned ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === u.id}
                      onClick={() => run(u.id, "Ban lifted", () => unbanUserAction(u.id))}
                    >
                      {busy === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="ml-1.5">Lift ban</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={busy === u.id}
                      onClick={() => {
                        setReasonFor(reasonFor === u.id ? null : u.id);
                        setReason("");
                      }}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="ml-1.5">Ban</span>
                    </Button>
                  )}
                </div>

                {reasonFor === u.id && (
                  <div className="flex gap-2">
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason for the ban"
                      aria-label={`Reason for banning ${u.name}`}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === u.id || reason.trim() === ""}
                      onClick={() => run(u.id, `${u.name} banned`, () => banUserAction(u.id, reason))}
                    >
                      {busy === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="ml-1.5">Confirm ban</span>
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
