"use client";

import { useEffect, useState, useTransition } from "react";
import {
  UserPlus,
  Trash2,
  Loader2,
  ShieldCheck,
  ShieldPlus,
  Clock,
  Wallet,
  Check,
  X,
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
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { shortenAddress } from "@/lib/utils";
import {
  getAdminsAction,
  grantAdminAction,
  revokeAdminAction,
  setAdminWalletAction,
} from "@/actions/admins";

interface Row {
  email: string;
  grantedAt: string;
  note: string;
  claimed: boolean;
  walletAddress: string | null;
}

/**
 * Sign-in access, and the place to repair an entry.
 *
 * Administrators are created under Manage Admins, which takes name, email and
 * wallet together and signs the wallet onto the on-chain roster in one step.
 * Adding was removed from here because doing it in two places produced admins
 * that existed on one side and not the other — the state that made a correctly
 * connected wallet read as unrecognised.
 *
 * What is left is the repair path: an admin whose wallet was never recorded, or
 * whose key has changed. That case survives the merge, because a row can still
 * be claimed by email before its holder has a wallet to name.
 */
export function PlatformAdminManager() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { freighterWalletAddress } = useFreighterWallet();
  const [admins, setAdmins] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [walletDraft, setWalletDraft] = useState("");
  /** Email of the row whose wallet is being edited, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const { getAdmins, getAdminOwner, addAdmin } = useStellarContract();
  /** The on-chain roster, which is a different list from the one above. */
  const [chainAdmins, setChainAdmins] = useState<string[] | null>(null);
  const [chainOwner, setChainOwner] = useState<string | null>(null);

  const loadChain = async () => {
    try {
      const [list, owner] = await Promise.all([getAdmins(), getAdminOwner()]);
      setChainAdmins((list as string[] | null) ?? []);
      setChainOwner((owner as string | null) ?? null);
    } catch {
      // A contract that cannot be read should not take the roster down with it;
      // the console half of this card works without the chain half.
      setChainAdmins(null);
      setChainOwner(null);
    }
  };

  useEffect(() => {
    void loadChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only the owner may edit the on-chain roster, so anyone else pressing Enrol
  // would sign a transaction the ledger is certain to reject.
  const isOwner = Boolean(
    freighterWalletAddress && chainOwner && freighterWalletAddress === chainOwner,
  );

  const enroll = (email: string, address: string) => {
    setBusy(email);
    startTransition(async () => {
      try {
        await addAdmin(address);
        await loadChain();
        toast({
          title: "Enrolled on-chain",
          description: `${shortenAddress(address)} can now sign contract actions.`,
        });
      } catch (err: any) {
        toast({
          title: "Enrolment failed",
          description: err?.message ?? String(err),
          variant: "destructive",
        });
      } finally {
        setBusy(null);
      }
    });
  };
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
          setWalletDraft("");
          setEditing(null);
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
          Sign-in access, matched on email. Administrators are added under Manage
          Admins, which records the name, email and wallet together and signs the
          wallet onto the on-chain roster in the same step. This view is for
          repairing an entry — filling in a wallet that was never recorded, or
          correcting one that changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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

                    {editing === a.email ? (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Input
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              run(`Wallet updated`, a.email, () =>
                                setAdminWalletAction(a.email, editDraft),
                              );
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                          placeholder="G…"
                          aria-label={`Stellar address for ${a.email}`}
                          className="h-7 font-mono text-xs"
                          spellCheck={false}
                          autoFocus
                        />
                        {freighterWalletAddress && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            title="Use the connected wallet"
                            aria-label="Use the connected wallet"
                            onClick={() => setEditDraft(freighterWalletAddress)}
                          >
                            <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          title="Save"
                          aria-label={`Save wallet address for ${a.email}`}
                          disabled={busy === a.email}
                          onClick={() =>
                            run(`Wallet updated`, a.email, () =>
                              setAdminWalletAction(a.email, editDraft),
                            )
                          }
                        >
                          {busy === a.email ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          title="Cancel"
                          aria-label="Cancel editing the wallet address"
                          onClick={() => setEditing(null)}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditing(a.email);
                          setEditDraft(a.walletAddress ?? "");
                        }}
                        title={a.walletAddress ?? "No wallet recorded"}
                      >
                        <Wallet className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {a.walletAddress ? (
                          <span className="font-mono">
                            {shortenAddress(a.walletAddress)}
                          </span>
                        ) : (
                          <span className="italic">No wallet — add one</span>
                        )}
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* The bridge between the two rosters. Being on the console
                        list grants no contract authority, and previously the
                        only way across was to copy an address into a separate
                        dialog — with nothing on screen saying it was needed. */}
                    {a.walletAddress && chainAdmins !== null && (
                      chainAdmins.includes(a.walletAddress) ? (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          On-chain
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isOwner || busy === a.email}
                          title={
                            isOwner
                              ? "Add this wallet to the on-chain admin roster"
                              : chainOwner
                                ? `Only the roster owner (${shortenAddress(chainOwner)}) can enrol a wallet. Connect that wallet to continue.`
                                : "The on-chain roster could not be read."
                          }
                          onClick={() => enroll(a.email, a.walletAddress!)}
                        >
                          {busy === a.email ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <ShieldPlus className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span className="ml-1.5">Enrol on-chain</span>
                        </Button>
                      )
                    )}
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
