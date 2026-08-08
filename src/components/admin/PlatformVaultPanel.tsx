"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Vault,
  Loader2,
  AlertTriangle,
  Clock,
  Users,
  PlayCircle,
  ThumbsUp,
  HandCoins,
  ArrowRightLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { useToast } from "@/hooks/use-toast";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { treasuryClient, simulate } from "@/lib/stellar-clients";
import { signerFor, send } from "@/lib/treasury-signing";
import { usePlatformInfo } from "@/context/BlockchainContext";
import { shortenAddress } from "@/lib/utils";

/**
 * What the platform vault holds, and when it can next be released.
 *
 * Reads the vault at whatever address the factory currently sends fees to,
 * rather than a configured one. There is exactly one correct answer to "where do
 * the fees go", the factory holds it, and a second copy in configuration is the
 * kind of mistake that shows a healthy balance for a vault the fees stopped
 * arriving at months ago.
 *
 * The three numbers are deliberately separate. `balance` is everything the
 * contract holds; `reserved` is what earlier cycles still owe owners who have
 * not claimed; `available` is what a cycle opened now would actually settle.
 * Showing only the balance would overstate what is distributable, which is the
 * error that matters here.
 */
const XLM = 10_000_000; // stroops per unit

function amount(raw: bigint | null): string {
  if (raw === null) return "—";
  return (Number(raw) / XLM).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

interface VaultState {
  address: string;
  balance: bigint | null;
  reserved: bigint | null;
  available: bigint | null;
  nextReleaseAt: bigint | null;
  owners: { address: string; shareBps: number }[] | null;
  openCycle: { id: number; approvals: number; amount: bigint } | null;
  /**
   * The most recent cycle that carried and can still be claimed against.
   *
   * Found by probing, because the contract exposes no "latest cycle" read — and
   * adding one would mean redeploying a treasury that now holds real fees. The
   * scan is bounded: claims are per cycle by design, so an owner who has missed
   * several needs to claim each, and offering only the newest is the honest
   * limit of what this panel does.
   */
  lastCycleId: number | null;
  /** The vault could not be read at all — usually a superseded deployment. */
  unreadable: boolean;
}

const NATIVE = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";


export function PlatformVaultPanel() {
  const { platformInfo } = usePlatformInfo();
  const { freighterWalletAddress } = useFreighterWallet();
  const { toast } = useToast();
  const [state, setState] = useState<VaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [reload, setReload] = useState(0);
  const [destination, setDestination] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { updateFeeWallet } = useStellarContract();

  const address = platformInfo?.feeWalletAddress ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setLoading(false);
      return;
    }

    (async () => {
      const c = treasuryClient(address);

      const [balance, reserved, available, nextReleaseAt, owners, openCycle] =
        await Promise.all([
          simulate(() => c.balance_of({ token: NATIVE }), "balance_of"),
          simulate(() => c.get_reserved({ token: NATIVE }), "get_reserved"),
          simulate(() => c.get_available({ token: NATIVE }), "get_available"),
          simulate(() => c.next_release_at(), "next_release_at"),
          simulate(() => c.get_shareholders(), "get_shareholders"),
          simulate(() => c.get_open_cycle(), "get_open_cycle"),
        ]);

      // Reserved is the sum still owed to owners of payable cycles, so a
      // reserve of zero means there is nothing anywhere left to claim. Checking
      // it first turns the common case — an empty or fully settled vault — from
      // eight sequential round trips into none, which is what was making the
      // panel sit on "Reading the vault" for several seconds on every visit.
      //
      // When there is something owed, the cycles are probed together rather
      // than in a descending loop. The loop stopped early on a hit, which reads
      // as the cheaper option and is not: its best case is one request and its
      // worst is eight *in series*, while eight in parallel cost one round trip
      // either way.
      let lastCycleId: number | null = null;
      const owed = (reserved as bigint | null) ?? 0n;
      if (owed > 0n) {
        const highest = openCycle ? (openCycle as any).id : 8;
        const ids = Array.from({ length: highest }, (_, i) => highest - i);
        const cycles = await Promise.all(
          ids.map((id) => simulate(() => c.get_cycle({ cycle_id: id }), "get_cycle")),
        );
        const hit = cycles.findIndex((cyc) => cyc && (cyc as any).state?.tag === "Payable");
        if (hit >= 0) lastCycleId = ids[hit];
      }

      if (cancelled) return;

      setState({
        address,
        balance: (balance as bigint | null) ?? null,
        reserved: (reserved as bigint | null) ?? null,
        available: (available as bigint | null) ?? null,
        nextReleaseAt: (nextReleaseAt as bigint | null) ?? null,
        owners:
          (owners as { address: string; share_bps: number }[] | null)?.map((o) => ({
            address: o.address,
            shareBps: o.share_bps,
          })) ?? null,
        openCycle: openCycle
          ? {
              id: (openCycle as any).id,
              approvals: (openCycle as any).approvals,
              amount: (openCycle as any).amount,
            }
          : null,
        // A vault whose balance cannot be read is not an empty vault. Saying so
        // matters most when the address points at a superseded deployment, which
        // is exactly when a confident "0.00" would be the wrong thing to show.
        lastCycleId,
        unreadable: balance === null && owners === null,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [address, reload]);

  /**
   * Only an owner can do any of this, and the contract is the one enforcing it.
   * These buttons are shown to owners and hidden from everyone else purely so
   * nobody signs a transaction the ledger is certain to reject — the check that
   * matters happens on chain.
   */
  const isOwner = Boolean(
    freighterWalletAddress &&
      state?.owners?.some((o) => o.address === freighterWalletAddress),
  );

  const act = (key: string, label: string, run: (c: ReturnType<typeof treasuryClient>) => Promise<unknown>) => {
    if (!freighterWalletAddress) {
      toast({ title: "Connect your wallet first", variant: "destructive" });
      return;
    }
    setBusy(key);
    startTransition(async () => {
      try {
        await run(treasuryClient(address, signerFor(freighterWalletAddress)));
        setReload((n) => n + 1);
        toast({ title: label });
      } catch (err: any) {
        toast({
          title: `${label} failed`,
          description: err?.message ?? String(err),
          variant: "destructive",
        });
      } finally {
        setBusy(null);
      }
    });
  };

  /**
   * Repoint the factory at a different vault.
   *
   * The single most consequential setting on the platform: every future listing
   * fee follows it, and a wrong address sends them somewhere nobody controls
   * with nothing to undo it. It used to be a bare text field with a Save button
   * next to a contact email. It is now beside the balance it redirects, and
   * behind a confirmation that names both the current vault and the proposed
   * one, because "is this the address I meant" is a question best asked before
   * the transaction rather than after the fees stop arriving.
   */
  const changeDestination = () => {
    setConfirming(false);
    setBusy("destination");
    startTransition(async () => {
      try {
        const result = await updateFeeWallet(destination.trim());
        const status = (result as any)?.getTransactionResponse?.status;
        if (status !== "SUCCESS") {
          throw new Error("The factory rejected the change.");
        }
        setDestination("");
        toast({
          title: "Fee destination changed",
          description: "New listing fees will arrive at the new vault.",
        });
        // The address lives on the factory, so the whole platform read has to
        // refresh rather than just this panel.
        window.location.reload();
      } catch (err: any) {
        toast({
          title: "Could not change the destination",
          description: err?.message ?? String(err),
          variant: "destructive",
        });
      } finally {
        setBusy(null);
      }
    });
  };

  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Platform Vault</CardTitle>
          <CardDescription>
            The factory has no fee destination set, so listing fees are not being
            collected anywhere.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const nextRelease =
    state?.nextReleaseAt && state.nextReleaseAt > 0n
      ? new Date(Number(state.nextReleaseAt) * 1000)
      : null;
  const releasable = nextRelease ? nextRelease.getTime() <= Date.now() : true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Vault className="h-5 w-5" aria-hidden="true" />
          Platform Vault
        </CardTitle>
        <CardDescription>
          Where listing fees pool. Nobody can move money out alone — a release
          needs two thirds of the owners, and at most one release every 30 days.
          <span className="ml-1 font-mono text-xs">{shortenAddress(address)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading the vault…
          </div>
        ) : state?.unreadable ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium">This vault could not be read.</p>
              <p className="text-muted-foreground">
                The factory is sending fees to {shortenAddress(address)}, but it
                does not answer as a platform vault. Fees are still arriving
                there and cannot be released from the console.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure label="Available to release" value={amount(state?.available ?? null)} strong />
              <Figure label="Owed to earlier cycles" value={amount(state?.reserved ?? null)} />
              <Figure label="Total held" value={amount(state?.balance ?? null)} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {nextRelease ? (
                releasable ? (
                  <span>A cycle can be opened now.</span>
                ) : (
                  <span>
                    Next release available {nextRelease.toLocaleDateString()}.
                  </span>
                )
              ) : (
                <span>No release has happened yet, so a cycle can be opened now.</span>
              )}

              {state?.owners && (
                <>
                  <Users className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {state.owners.length} owner
                    {state.owners.length === 1 ? "" : "s"}, sharing equally
                  </span>
                </>
              )}
            </div>

            {state?.openCycle && (
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500">
                Cycle {state.openCycle.id} open — {state.openCycle.approvals} approval
                {state.openCycle.approvals === 1 ? "" : "s"} so far
              </Badge>
            )}

            {isOwner && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                {/* Opening is only offered when there is something to settle and
                    the monthly gap has passed. The contract refuses both cases
                    anyway; disabling here means the reason is legible before a
                    signature rather than as a raw HostError after one. */}
                <Button
                  size="sm"
                  disabled={
                    busy !== null ||
                    Boolean(state?.openCycle) ||
                    !releasable ||
                    !state?.available ||
                    state.available <= 0n
                  }
                  title={
                    state?.openCycle
                      ? "A cycle is already open"
                      : !releasable
                        ? "The next release is not due yet"
                        : !state?.available || state.available <= 0n
                          ? "There is nothing to release"
                          : "Open a release cycle over the available balance"
                  }
                  onClick={() =>
                    act("open", "Cycle opened", async (c) =>
                      send(
                        await (c as any).open_cycle({
                          opener: freighterWalletAddress,
                          token: NATIVE,
                        }),
                      ),
                    )
                  }
                >
                  {busy === "open" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="ml-1.5">Open cycle</span>
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !state?.openCycle}
                  title={
                    state?.openCycle
                      ? "Approve this release. Two thirds of owners carries it."
                      : "No cycle is open to approve"
                  }
                  onClick={() =>
                    act("approve", "Approval recorded", async (c) =>
                      send(await (c as any).approve_cycle({ voter: freighterWalletAddress })),
                    )
                  }
                >
                  {busy === "approve" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="ml-1.5">Approve release</span>
                </Button>

                {/* Claiming is pull-based, so it is per owner and always
                    available for a carried cycle — including long after the
                    fact, which is the point of not pushing payments. */}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !state?.lastCycleId}
                  title="Claim your share of the most recent carried cycle"
                  onClick={() =>
                    act("claim", "Claim submitted", async (c) =>
                      send(
                        await (c as any).claim({
                          shareholder: freighterWalletAddress,
                          cycle_id: state?.lastCycleId ?? 1,
                        }),
                      ),
                    )
                  }
                >
                  {busy === "claim" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <HandCoins className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="ml-1.5">Claim my share</span>
                </Button>
              </div>
            )}
          </>
        )}

        {/* Shown whether or not the vault reads, because a vault that does not
            answer is precisely when you need to point the factory somewhere
            else — which was the state this platform was in until today. */}
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Fee destination</p>
          <p className="text-xs text-muted-foreground">
            Every future listing fee goes here. Changing it is a factory-admin
            action and needs the factory admin&rsquo;s signature.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="C… vault address"
              className="max-w-md font-mono text-xs"
              spellCheck={false}
              aria-label="New fee destination"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy !== null ||
                !/^C[A-Z2-7]{55}$/.test(destination.trim()) ||
                destination.trim() === address
              }
              title={
                destination.trim() === address
                  ? "That is already the destination"
                  : "Point the factory at a different vault"
              }
              onClick={() => setConfirming(true)}
            >
              {busy === "destination" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="ml-1.5">Change</span>
            </Button>
          </div>
        </div>

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Redirect every future listing fee?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    Fees currently arrive at{" "}
                    <span className="font-mono">{shortenAddress(address)}</span>.
                    They will instead arrive at{" "}
                    <span className="font-mono">
                      {shortenAddress(destination.trim())}
                    </span>
                    .
                  </p>
                  <p>
                    Fees already held by the current vault stay there and are
                    unaffected. If the new address is not a platform vault, fees
                    sent to it may not be recoverable.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={changeDestination}>
                Change destination
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={strong ? "text-xl font-semibold" : "text-lg"}>
        {value} <span className="text-xs font-normal text-muted-foreground">XLM</span>
      </p>
    </div>
  );
}
