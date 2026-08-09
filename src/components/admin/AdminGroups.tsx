"use client";

import { useEffect, useState, useTransition } from "react";
import {
  UserPlus,
  Trash2,
  Loader2,
  Crown,
  Wrench,
  ShieldCheck,
  ClipboardCheck,
  Wallet,
  Check,
  Clock,
} from "lucide-react";
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
import { usePlatformInfo } from "@/context/BlockchainContext";
import { treasuryClient, simulate } from "@/lib/stellar-clients";
import { shortenAddress } from "@/lib/utils";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  PLATFORM_MANAGED_WALLET,
  type AdminRole,
} from "@/lib/admin-roles";
import {
  getAdminsAction,
  grantAdminAction,
  revokeAdminAction,
} from "@/actions/admins";

/**
 * The people who run the platform, grouped by what they are.
 *
 * This replaces the two overlapping cards that used to sit here — one listing
 * the console roster, one listing the on-chain wallets — which showed the same
 * people twice and answered neither "who owns this" nor "who does what" cleanly.
 * Now each group is its own section: owners with a stake, the operational
 * administrators, the KYC attestors, the project administrators.
 *
 * An owner's stake is read from the treasury, not this table: a console row
 * makes someone an owner of the *console*, and their share of the money is the
 * on-chain shareholder register, which only a governance vote changes. Showing
 * both together is how you see the gap — an owner in the console who holds no
 * share yet — rather than discovering it later.
 */
interface Row {
  name: string;
  email: string;
  role: AdminRole;
  walletAddress: string | null;
  claimed: boolean;
}

const GROUP_ICON: Record<AdminRole, typeof Crown> = {
  owner: Crown,
  platform_admin: Wrench,
  kyc_manager: ShieldCheck,
  project_approver: ClipboardCheck,
  accountant: Wallet,
};

export function AdminGroups() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { platformInfo } = usePlatformInfo();

  const [rows, setRows] = useState<Row[]>([]);
  const [stakes, setStakes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<AdminRole | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "", wallet: "" });
  const [, startTransition] = useTransition();

  const treasury = platformInfo?.feeWalletAddress ?? "";
  const ownEmail = (user?.email ?? "").toLowerCase();

  const loadRoster = async () => {
    const res = await getAdminsAction();
    if (res.success) setRows(res.admins as Row[]);
  };

  useEffect(() => {
    (async () => {
      await loadRoster();
      setLoading(false);
    })();
  }, []);

  // Stakes come from the treasury's shareholder register, keyed by wallet.
  useEffect(() => {
    let cancelled = false;
    if (!treasury) return;
    simulate(() => treasuryClient(treasury).get_shareholders(), "get_shareholders").then((list) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const s of (list as { address: string; share_bps: number }[] | null) ?? []) {
        map[s.address] = s.share_bps;
      }
      setStakes(map);
    });
    return () => {
      cancelled = true;
    };
  }, [treasury]);

  const run = (
    key: string,
    label: string,
    action: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    setBusy(key);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.success) {
          await loadRoster();
          setAddingTo(null);
          setDraft({ name: "", email: "", wallet: "" });
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
      {ASSIGNABLE_ROLES.map((role) => {
        const meta = ROLE_LABELS[role];
        const Icon = GROUP_ICON[role];
        const members = rows.filter((r) => r.role === role);
        const managed = PLATFORM_MANAGED_WALLET[role];

        return (
          <Card key={role}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {meta.plural}
                </CardTitle>
                <CardDescription>{meta.blurb}</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddingTo(addingTo === role ? null : role);
                  setDraft({ name: "", email: "", wallet: "" });
                }}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5">Add</span>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {addingTo === role && (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="Name"
                      aria-label="Name"
                    />
                    <Input
                      type="email"
                      value={draft.email}
                      onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                      placeholder="name@example.com"
                      aria-label="Email"
                    />
                  </div>
                  {role === "owner" && (
                    <Input
                      value={draft.wallet}
                      onChange={(e) => setDraft((d) => ({ ...d, wallet: e.target.value }))}
                      placeholder="Stellar wallet — G…"
                      className="font-mono text-xs"
                      spellCheck={false}
                      aria-label="Owner wallet"
                    />
                  )}
                  {managed && (
                    <p className="text-xs text-muted-foreground">
                      No wallet field: the platform generates and funds this
                      attestor&rsquo;s signing key, so they never connect one. (Key
                      generation lands in a following change; for now this records
                      the person.)
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      busy === `add:${role}` ||
                      draft.name.trim() === "" ||
                      draft.email.trim() === ""
                    }
                    onClick={() =>
                      run(`add:${role}`, `${meta.label} added`, () =>
                        grantAdminAction(draft.email, draft.wallet || undefined, draft.name, role),
                      )
                    }
                  >
                    {busy === `add:${role}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="ml-1.5">Add {meta.label.toLowerCase()}</span>
                  </Button>
                </div>
              )}

              {members.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  No {meta.plural.toLowerCase()} yet.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {members.map((m) => {
                    const isSelf = m.email.toLowerCase() === ownEmail;
                    const bps = m.walletAddress ? stakes[m.walletAddress] : undefined;
                    return (
                      <li key={m.email} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate text-sm font-medium">
                            {m.name}
                            {isSelf && (
                              <span className="text-xs font-normal text-muted-foreground">(you)</span>
                            )}
                            {!m.claimed && (
                              <Badge variant="outline" className="gap-1 text-muted-foreground">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                Not signed in
                              </Badge>
                            )}
                            {role === "owner" && (
                              <Badge
                                variant="outline"
                                className={
                                  bps
                                    ? "border-emerald-500/40 text-emerald-500"
                                    : "text-muted-foreground"
                                }
                              >
                                {bps ? `${(bps / 100).toFixed(2)}% stake` : "no stake yet"}
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {m.email}
                            {m.walletAddress ? ` · ${shortenAddress(m.walletAddress)}` : ""}
                          </p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={isSelf || busy === `rm:${m.email}`}
                          title={isSelf ? "You cannot remove your own access" : "Remove"}
                          aria-label={`Remove ${m.email}`}
                          onClick={() =>
                            run(`rm:${m.email}`, `Removed ${m.email}`, () =>
                              revokeAdminAction(m.email),
                            )
                          }
                        >
                          {busy === `rm:${m.email}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}

      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the roster…
        </div>
      )}
    </div>
  );
}
