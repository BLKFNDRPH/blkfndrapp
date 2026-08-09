"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Fuel,
  Gavel,
  Loader2,
  ThumbsUp,
  PlayCircle,
  AlertTriangle,
  Users,
  Send,
} from "lucide-react";
import { Asset } from "@stellar/stellar-sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { useToast } from "@/hooks/use-toast";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { operationsClient, simulate, OPERATIONS_ID, NETWORK_PASSPHRASE } from "@/lib/stellar-clients";
import { signerFor, send } from "@/lib/treasury-signing";
import { shortenAddress } from "@/lib/utils";
import { getAdminsAction } from "@/actions/admins";

/**
 * The Operations Vault: the platform's gas budget, spent by owner vote.
 *
 * The moderation side runs on gas — a KYC attestor's managed wallet needs a
 * little XLM to sign. This vault holds that budget, and hands it out the same way
 * the fee treasury pays: a release is a proposal the owners vote on, carried by
 * two of three, executed by anyone. The marquee action is the monthly top-up —
 * one vote that funds every active custodial wallet at once (ReleaseMany).
 *
 * Reading needs no wallet; proposing and voting need an owner's, connected in
 * Freighter. Amounts are entered in XLM and converted to stroops, so nobody
 * multiplies by ten million to move a lumen.
 */
const XLM = 10_000_000;
const STRKEY = /^[GC][A-Z2-7]{55}$/;
const NATIVE = Asset.native().contractId(NETWORK_PASSPHRASE);

const isNum = (v: string) => v.trim() !== "" && !Number.isNaN(Number(v));
const toStroops = (v: string) => BigInt(Math.round(Number(v) * XLM));
const fmtXlm = (stroops: bigint) =>
  (Number(stroops) / XLM).toLocaleString(undefined, { maximumFractionDigits: 7 });

interface ProposalState {
  id: number;
  approvals: number;
  owners: number;
  needed: number;
  closesAt: number;
  label: string;
  carried: boolean;
}

interface Attestor {
  name: string;
  wallet: string;
}

/** A live proposal's action, read back for a person. */
function describeAction(action: { tag: string; values: readonly unknown[] }): string {
  switch (action.tag) {
    case "Release": {
      const t = action.values[0] as { amount: bigint; to: string };
      return `Release ${fmtXlm(BigInt(t.amount))} XLM → ${shortenAddress(t.to)}`;
    }
    case "ReleaseMany": {
      const items = action.values[0] as { amount: bigint }[];
      const total = items.reduce((s, i) => s + BigInt(i.amount), 0n);
      return `Fund ${items.length} wallet${items.length === 1 ? "" : "s"} — ${fmtXlm(total)} XLM total`;
    }
    case "SetVotingWindow": {
      const secs = Number(action.values[0]);
      return `Set voting window to ${Math.round(secs / 86_400)} days`;
    }
    case "SetOwners": {
      const owners = action.values[0] as string[];
      return `Replace owners (${owners.length})`;
    }
    default:
      return action.tag;
  }
}

export function OperationsVaultPanel() {
  const { freighterWalletAddress } = useFreighterWallet();
  const { toast } = useToast();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [owners, setOwners] = useState<string[]>([]);
  const [proposal, setProposal] = useState<ProposalState | null>(null);
  const [attestors, setAttestors] = useState<Attestor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [release, setRelease] = useState({ to: "", amount: "" });
  const [fundEach, setFundEach] = useState("");
  const [windowDays, setWindowDays] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    if (!OPERATIONS_ID) {
      setLoading(false);
      return;
    }
    (async () => {
      const c = operationsClient();
      const [bal, roster, open, admins] = await Promise.all([
        simulate(() => c.balance_of({ token: NATIVE }), "ops.balance_of"),
        simulate(() => c.get_owners(), "ops.get_owners"),
        simulate(() => c.get_proposal(), "ops.get_proposal"),
        getAdminsAction(),
      ]);
      if (cancelled) return;

      setBalance(bal === null ? null : BigInt(bal as bigint));
      const list = (roster as string[] | null) ?? [];
      setOwners(list);

      if (open) {
        const p = open as {
          id: number;
          approvals: number;
          closes_at: bigint | number;
          action: { tag: string; values: readonly unknown[] };
        };
        const approvals = Number(p.approvals ?? 0);
        const needed = Math.ceil((list.length * 2) / 3);
        setProposal({
          id: Number(p.id),
          approvals,
          owners: list.length,
          needed,
          closesAt: Number(p.closes_at) * 1000,
          label: describeAction(p.action),
          carried: approvals >= needed,
        });
      } else {
        setProposal(null);
      }

      // The custodial wallets a batch top-up would fund: admins the platform
      // holds a managed key for.
      const rows = admins.success ? admins.admins : [];
      setAttestors(
        rows
          .filter((a) => a.managedWallet)
          .map((a) => ({ name: a.name, wallet: a.managedWallet as string })),
      );

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const isOwner = Boolean(
    freighterWalletAddress && owners.includes(freighterWalletAddress),
  );

  const expired = proposal ? proposal.closesAt <= Date.now() : false;
  const slotTaken = Boolean(proposal && !expired && !proposal.carried);

  const act = (
    key: string,
    label: string,
    run: (c: ReturnType<typeof operationsClient>) => Promise<unknown>,
  ) => {
    if (!freighterWalletAddress) {
      toast({ title: "Connect your wallet first", variant: "destructive" });
      return;
    }
    setBusy(key);
    startTransition(async () => {
      try {
        await run(operationsClient(signerFor(freighterWalletAddress)));
        setReload((n) => n + 1);
        setRelease({ to: "", amount: "" });
        setFundEach("");
        setWindowDays("");
        toast({ title: label });
      } catch (err: unknown) {
        toast({
          title: `${label} failed`,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setBusy(null);
      }
    });
  };

  const releaseReady =
    STRKEY.test(release.to.trim()) && isNum(release.amount) && Number(release.amount) > 0;
  const fundReady = isNum(fundEach) && Number(fundEach) > 0 && attestors.length > 0;
  const windowReady = isNum(windowDays) && Number(windowDays) > 0;

  const fundTotal = useMemo(() => {
    if (!fundReady) return 0n;
    return toStroops(fundEach) * BigInt(attestors.length);
  }, [fundEach, fundReady, attestors.length]);

  if (!OPERATIONS_ID) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fuel className="h-5 w-5" aria-hidden="true" />
            Operations Vault
          </CardTitle>
          <CardDescription>The platform&rsquo;s gas budget, released by owner vote.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              Not configured. Set <span className="font-mono">NEXT_PUBLIC_BLKFNDR_OPERATIONS_CONTRACT_ID</span>{" "}
              to the deployed Operations Vault to manage its gas budget here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fuel className="h-5 w-5" aria-hidden="true" />
          Operations Vault
        </CardTitle>
        <CardDescription>
          The gas budget for moderation — funding the custodial wallets KYC
          attestors sign with. Every release is an owner vote, carried by two in
          three and executed by anyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading the vault…
          </div>
        ) : (
          <>
            {/* Balance + owners */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Fuel className="h-3.5 w-3.5" aria-hidden="true" /> Gas balance
                </p>
                <p className="text-xl font-semibold">
                  {balance === null ? "—" : fmtXlm(balance)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">XLM</span>
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" /> Owners
                </p>
                <p className="text-xl font-semibold">
                  {owners.length}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">voters</span>
                </p>
              </div>
            </div>

            {/* Open proposal */}
            {proposal ? (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      Proposal {proposal.id}: {proposal.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {proposal.approvals} of {proposal.needed} needed
                      {proposal.owners > 0 && ` — ${proposal.owners} owners`}
                      {expired ? " — voting closed" : ""}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      proposal.carried
                        ? "border-emerald-500/40 text-emerald-500"
                        : "border-amber-500/40 text-amber-500"
                    }
                  >
                    {proposal.carried ? "Carried" : "Voting"}
                  </Badge>
                </div>

                {isOwner && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy !== null || proposal.carried || expired}
                      title={
                        proposal.carried ? "Already carried" : expired ? "Voting has closed" : "Approve this proposal"
                      }
                      onClick={() =>
                        act("approve", "Approval recorded", async (c) =>
                          send(await c.approve({ voter: freighterWalletAddress! })),
                        )
                      }
                    >
                      {busy === "approve" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="ml-1.5">Approve</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || !proposal.carried}
                      title={proposal.carried ? "Release the funds" : "Not carried yet"}
                      onClick={() =>
                        act("execute", "Proposal executed", async (c) => send(await c.execute()))
                      }
                    >
                      {busy === "execute" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="ml-1.5">Execute</span>
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No proposal is open.</p>
            )}

            {/* Owner proposal forms */}
            {isOwner ? (
              <div className="space-y-5 border-t pt-4">
                {slotTaken && (
                  <p className="text-xs text-amber-500">
                    A proposal is open. Settle it before starting another.
                  </p>
                )}

                {/* Fund custodial wallets — the monthly batch top-up */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Fund custodial wallets</p>
                  <p className="text-xs text-muted-foreground">
                    One vote tops up every active custodial wallet by the same amount — the
                    monthly gas top-up. {attestors.length} wallet
                    {attestors.length === 1 ? "" : "s"} would be funded.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 sm:max-w-[200px]">
                      <Input
                        value={fundEach}
                        onChange={(e) => setFundEach(e.target.value)}
                        placeholder="5"
                        disabled={slotTaken || attestors.length === 0}
                        className="pr-24"
                        inputMode="decimal"
                        spellCheck={false}
                        aria-label="XLM to each custodial wallet"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        XLM each
                      </span>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy !== null || slotTaken || !fundReady}
                      title={
                        attestors.length === 0
                          ? "No custodial wallets to fund yet"
                          : slotTaken
                            ? "A proposal is already open"
                            : fundReady
                              ? `Propose funding ${attestors.length} wallets — ${fmtXlm(fundTotal)} XLM`
                              : "Enter an amount"
                      }
                      onClick={() =>
                        act("fund", "Funding proposed", async (c) =>
                          send(
                            await c.propose({
                              proposer: freighterWalletAddress!,
                              action: {
                                tag: "ReleaseMany",
                                values: [
                                  attestors.map((a) => ({
                                    token: NATIVE,
                                    amount: toStroops(fundEach),
                                    to: a.wallet,
                                  })),
                                ],
                              },
                            }),
                          ),
                        )
                      }
                    >
                      {busy === "fund" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Fuel className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="ml-1.5">
                        Propose{fundReady ? ` · ${fmtXlm(fundTotal)} XLM` : ""}
                      </span>
                    </Button>
                  </div>
                </div>

                {/* Single release to any address */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Release to an address</p>
                  <p className="text-xs text-muted-foreground">
                    A one-off transfer — an on-demand top-up, or moving gas anywhere the
                    owners agree.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={release.to}
                      onChange={(e) => setRelease((r) => ({ ...r, to: e.target.value }))}
                      placeholder="Destination — G… or C…"
                      disabled={slotTaken}
                      className="min-w-0 flex-1 font-mono text-xs sm:max-w-[320px]"
                      spellCheck={false}
                      aria-label="Release destination"
                    />
                    <div className="relative w-32 shrink-0">
                      <Input
                        value={release.amount}
                        onChange={(e) => setRelease((r) => ({ ...r, amount: e.target.value }))}
                        placeholder="10"
                        disabled={slotTaken}
                        className="pr-12"
                        inputMode="decimal"
                        spellCheck={false}
                        aria-label="Release amount in XLM"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        XLM
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || slotTaken || !releaseReady}
                      title={
                        slotTaken
                          ? "A proposal is already open"
                          : releaseReady
                            ? "Propose this release"
                            : "Enter a valid address and amount"
                      }
                      onClick={() =>
                        act("release", "Release proposed", async (c) =>
                          send(
                            await c.propose({
                              proposer: freighterWalletAddress!,
                              action: {
                                tag: "Release",
                                values: [
                                  { token: NATIVE, amount: toStroops(release.amount), to: release.to.trim() },
                                ],
                              },
                            }),
                          ),
                        )
                      }
                    >
                      {busy === "release" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="ml-1.5">Propose</span>
                    </Button>
                  </div>
                </div>

                {/* Voting window */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-44 shrink-0 text-sm font-medium">Voting window</div>
                  <div className="relative min-w-0 flex-1 sm:max-w-[200px]">
                    <Input
                      value={windowDays}
                      onChange={(e) => setWindowDays(e.target.value)}
                      placeholder="7"
                      disabled={slotTaken}
                      className="pr-14"
                      inputMode="decimal"
                      spellCheck={false}
                      aria-label="Voting window in days"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      days
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || slotTaken || !windowReady}
                    onClick={() =>
                      act("window", "Window change proposed", async (c) =>
                        send(
                          await c.propose({
                            proposer: freighterWalletAddress!,
                            action: {
                              tag: "SetVotingWindow",
                              values: [BigInt(Math.round(Number(windowDays) * 86_400))],
                            },
                          }),
                        ),
                      )
                    }
                  >
                    {busy === "window" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span className="ml-1.5">Propose</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                <p className="text-xs text-muted-foreground">
                  {freighterWalletAddress
                    ? `${shortenAddress(freighterWalletAddress)} is not an owner of the Operations Vault, so it cannot propose or vote. Connect an owner wallet.`
                    : "Connect an owner wallet to propose or vote."}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
