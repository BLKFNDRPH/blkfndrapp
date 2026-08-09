"use client";

import { useEffect, useState, useTransition } from "react";
import {
  UserPlus,
  Trash2,
  Loader2,
  Crown,
  Wrench,
  ShieldCheck,
  ShieldPlus,
  ShieldX,
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
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
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
  managedWallet: string | null;
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
  const { freighterWalletAddress } = useFreighterWallet();
  const { getIdentityAdmin, isAttestor, addAttestor, removeAttestor } = useStellarContract();

  const [rows, setRows] = useState<Row[]>([]);
  const [stakes, setStakes] = useState<Record<string, number>>({});
  const [registryAdmin, setRegistryAdmin] = useState<string | null>(null);
  const [attestorOf, setAttestorOf] = useState<Record<string, boolean>>({});
  const [appointBusy, setAppointBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<AdminRole | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "", wallet: "" });
  const [, startTransition] = useTransition();

  const treasury = platformInfo?.feeWalletAddress ?? "";
  const ownEmail = (user?.email ?? "").toLowerCase();

  // Whoever is connected as the identity registry's admin may appoint or
  // withdraw an attestor. That is the one on-chain, owner-signed step in the
  // managed-attestor model: the platform holds the key, but granting it the
  // authority to write KYC is a deliberate signature, not something the server
  // does alone.
  const isRegistryAdmin = Boolean(
    freighterWalletAddress && registryAdmin && freighterWalletAddress === registryAdmin,
  );

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

  // The registry admin, read once — it decides whether appoint/withdraw shows.
  useEffect(() => {
    let cancelled = false;
    getIdentityAdmin()
      .then((a) => {
        if (!cancelled) setRegistryAdmin((a as string | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setRegistryAdmin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [getIdentityAdmin]);

  // Which managed wallets the registry has appointed. Keyed by wallet so a row
  // shows its own status and the button knows which way to act.
  useEffect(() => {
    let cancelled = false;
    const wallets = rows.map((r) => r.managedWallet).filter((w): w is string => Boolean(w));
    if (wallets.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        wallets.map(async (w) => [w, Boolean(await isAttestor(w))] as const),
      );
      if (!cancelled) setAttestorOf(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, isAttestor]);

  const appoint = (wallet: string, grant: boolean) => {
    setAppointBusy(wallet);
    startTransition(async () => {
      try {
        if (grant) await addAttestor(wallet);
        else await removeAttestor(wallet);
        setAttestorOf((m) => ({ ...m, [wallet]: grant }));
        toast({ title: grant ? "Attestor appointed" : "Authority withdrawn" });
      } catch (err) {
        toast({
          title: grant ? "Appoint failed" : "Withdraw failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setAppointBusy(null);
      }
    });
  };

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
                      attestor&rsquo;s signing key when you add them, so they never
                      connect one. Once they appear below, appoint the key on-chain
                      from their row (needs the registry admin wallet).
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
                    const mw = m.managedWallet;
                    const appointed = mw ? attestorOf[mw] : undefined;
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
                            {managed && mw && (
                              <Badge
                                variant="outline"
                                className={
                                  appointed
                                    ? "gap-1 border-emerald-500/40 text-emerald-500"
                                    : "gap-1 text-muted-foreground"
                                }
                              >
                                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                                {appointed ? "Appointed" : "Not appointed"}
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {m.email}
                            {managed
                              ? mw
                                ? ` · managed ${shortenAddress(mw)}`
                                : " · provisioning key…"
                              : m.walletAddress
                                ? ` · ${shortenAddress(m.walletAddress)}`
                                : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {managed && mw && isRegistryAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={appointBusy === mw}
                              title={
                                appointed
                                  ? "Withdraw this key's authority to attest"
                                  : "Authorise this key to write KYC attestations"
                              }
                              onClick={() => appoint(mw, !appointed)}
                            >
                              {appointBusy === mw ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : appointed ? (
                                <ShieldX className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <ShieldPlus className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span className="ml-1.5">{appointed ? "Withdraw" : "Appoint"}</span>
                            </Button>
                          )}
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
                        </div>
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
