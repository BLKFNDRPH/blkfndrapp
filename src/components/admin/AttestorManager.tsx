"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ShieldCheck,
  ShieldPlus,
  ShieldX,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { useToast } from "@/hooks/use-toast";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { shortenAddress } from "@/lib/utils";
import { getAdminsAction } from "@/actions/admins";
import { ROLE_LABELS } from "@/lib/admin-roles";

/**
 * Who may sign a KYC attestation on-chain.
 *
 * A KYC manager reviews under their own session, but writing the attestation to
 * the ledger needs their wallet on the registry's attestor roster — the whole
 * point of that roster being that the key can attest and do nothing else, so it
 * can live on a reviewer's laptop without being the deployer key.
 *
 * This lists the console admins who hold a recorded wallet and shows, for each,
 * whether the ledger will accept an attestation from them. Appointing and
 * removing is admin-only on the registry, so the controls are shown only to
 * whoever is connected as that admin — anyone else would sign a transaction the
 * ledger is certain to reject.
 *
 * There is no "list attestors" read on the contract, deliberately — it answers
 * one address at a time. So this cross-references the console roster rather than
 * enumerating the chain: the people you would ever appoint are the ones already
 * on the roster, and a wallet nobody added to the console is not one you are
 * about to trust with identity.
 */
interface Candidate {
  email: string;
  name: string;
  role: "owner" | "kyc_manager" | "project_approver" | "accountant";
  wallet: string;
  isAttestor: boolean | null;
}

export function AttestorManager() {
  const { toast } = useToast();
  const { freighterWalletAddress } = useFreighterWallet();
  const { getIdentityAdmin, isAttestor, addAttestor, removeAttestor } =
    useStellarContract();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [registryAdmin, setRegistryAdmin] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, admin] = await Promise.all([
        getAdminsAction(),
        getIdentityAdmin().catch(() => null),
      ]);
      if (cancelled) return;

      setRegistryAdmin((admin as string | null) ?? null);

      const roster = res.success ? res.admins : [];
      // Only rows with a wallet can be attestors, and a KYC manager is the
      // person you would appoint. Owners are included too — the registry admin
      // is an attestor already, but an owner who reviews KYC may want the same
      // standing without holding the admin key.
      const withWallet = roster.filter(
        (a) => a.walletAddress && (a.role === "kyc_manager" || a.role === "owner"),
      );

      const checked = await Promise.all(
        withWallet.map(async (a) => ({
          email: a.email,
          name: a.name,
          role: a.role,
          wallet: a.walletAddress as string,
          isAttestor: (await isAttestor(a.walletAddress as string)) as boolean | null,
        })),
      );
      if (cancelled) return;
      setCandidates(checked);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, getIdentityAdmin, isAttestor]);

  // The contract enforces admin-only; this only decides whether to offer the
  // control, so nobody signs a transaction the ledger will refuse.
  const isRegistryAdmin = Boolean(
    freighterWalletAddress && registryAdmin && freighterWalletAddress === registryAdmin,
  );

  const act = (wallet: string, label: string, run: () => Promise<unknown>) => {
    setBusy(wallet);
    startTransition(async () => {
      try {
        await run();
        setReload((n) => n + 1);
        toast({ title: label });
      } catch (err: any) {
        toast({ title: `${label} failed`, description: err?.message ?? String(err), variant: "destructive" });
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          KYC Attestors
        </CardTitle>
        <CardDescription>
          Wallets the identity registry will accept a KYC attestation from. A KYC
          manager needs this before their approvals reach the ledger — the key
          can attest and nothing else.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isRegistryAdmin && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              {registryAdmin
                ? `Appointing attestors needs the registry admin wallet (${shortenAddress(registryAdmin)}). Connect it to make changes.`
                : "The registry admin could not be read. Appointing attestors is unavailable."}
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading the attestor roster…
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No console admin has a recorded wallet yet. Add a KYC manager with a
            wallet under Manage Admins, then appoint them here.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {candidates.map((c) => (
              <li key={c.email} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {c.name}
                    <Badge variant="outline" className="text-muted-foreground">
                      {ROLE_LABELS[c.role].label}
                    </Badge>
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {shortenAddress(c.wallet)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.isAttestor ? (
                    <>
                      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Attestor
                      </Badge>
                      {isRegistryAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === c.wallet}
                          title="Withdraw the authority to attest"
                          onClick={() =>
                            act(c.wallet, "Attestor removed", () => removeAttestor(c.wallet))
                          }
                        >
                          {busy === c.wallet ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <ShieldX className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span className="ml-1.5">Remove</span>
                        </Button>
                      )}
                    </>
                  ) : isRegistryAdmin ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === c.wallet}
                      title="Authorise this wallet to write KYC attestations"
                      onClick={() =>
                        act(c.wallet, "Attestor appointed", () => addAttestor(c.wallet))
                      }
                    >
                      {busy === c.wallet ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ShieldPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="ml-1.5">Appoint</span>
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Not an attestor
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
