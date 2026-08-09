"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Gavel,
  Loader2,
  ThumbsUp,
  PlayCircle,
  AlertTriangle,
} from "lucide-react";
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
import { usePlatformInfo } from "@/context/BlockchainContext";
import { Asset } from "@stellar/stellar-sdk";
import { treasuryClient, simulate, OPERATIONS_ID, NETWORK_PASSPHRASE } from "@/lib/stellar-clients";
import { signerFor, send } from "@/lib/treasury-signing";
import { shortenAddress } from "@/lib/utils";

/**
 * Proposing and voting on platform settings.
 *
 * Once the factory's admin is this treasury, every one of its settings moves
 * only when two thirds of the owners agree. Each setting gets its own row —
 * enter a change, propose it — rather than a dropdown you have to open to
 * discover what is governable. The contract allows one open proposal at a time,
 * so while a vote is live every row's Propose is held.
 *
 * Values are entered in the units a person thinks in and converted to the units
 * the ledger stores. The fee is XLM on screen and stroops on chain; the bond is
 * a percentage and basis points; the window is days and seconds. Nobody should
 * have to multiply by ten million to raise the fee by one XLM.
 */
const XLM = 10_000_000;
/** The native asset (XLM) contract — the asset operations funding routes. */
const NATIVE = Asset.native().contractId(NETWORK_PASSPHRASE);

interface ActionSpec {
  key: string;
  label: string;
  /** Shown beside the field. */
  unit: string;
  placeholder: string;
  hint: string;
  valid: (v: string) => boolean;
  /** Human input to the contract's action shape and units. */
  toAction: (v: string) => Record<string, unknown>;
}

const isNum = (v: string) => v.trim() !== "" && !Number.isNaN(Number(v));

// Only the economic terms are here. The contract can also repoint the fee
// destination, the identity registry and factory admin — but those are core
// wiring, fixed when the platform is deployed. Fees flow to the treasury, vaults
// check the identity registry, the factory has its admin, and none of that is
// meant to move in normal operation; a wrong address there does real damage a
// wrong fee does not. So they are not surfaced as routine proposals. The
// capability stays in the contract for a genuine emergency, exercised
// deliberately by a key holder rather than a click, the same way the wasm-hash
// upgrade was always kept out of this list.
// The action is the binding's tagged-union shape — { tag, values } — not the
// { Variant: value } shorthand, which the contract Spec rejects at serialization
// with "no such enum entry". Confirmed on-chain: a { tag, values } proposal reads
// back with the right variant; the shorthand throws before it ever leaves the
// browser.
const ACTIONS: ActionSpec[] = [
  {
    key: "SetFee",
    label: "Listing fee",
    unit: "XLM",
    placeholder: "10",
    hint: "A flat amount charged once per listing.",
    valid: (v) => isNum(v) && Number(v) >= 0,
    toAction: (v) => ({ tag: "SetFee", values: [BigInt(Math.round(Number(v) * XLM))] }),
  },
  {
    key: "SetBondBps",
    label: "Performance bond",
    unit: "%",
    placeholder: "5",
    hint: "What a builder posts against their raise and forfeits by missing a milestone.",
    valid: (v) => isNum(v) && Number(v) >= 0 && Number(v) <= 100,
    toAction: (v) => ({ tag: "SetBondBps", values: [BigInt(Math.round(Number(v) * 100))] }),
  },
  {
    key: "SetMinContribution",
    label: "Minimum contribution",
    unit: "XLM",
    placeholder: "5",
    hint: "The smallest amount a vault will accept from a contributor.",
    valid: (v) => isNum(v) && Number(v) >= 0,
    toAction: (v) => ({ tag: "SetMinContribution", values: [BigInt(Math.round(Number(v) * XLM))] }),
  },
  {
    key: "SetVotingWindow",
    label: "Milestone voting window",
    unit: "days",
    placeholder: "7",
    hint: "How long contributors have to vote on a milestone once it opens.",
    valid: (v) => isNum(v) && Number(v) > 0,
    toAction: (v) => ({ tag: "SetVotingWindow", values: [BigInt(Math.round(Number(v) * 86_400))] }),
  },
  {
    // The monthly cut of the treasury's XLM that funds the Operations Vault's gas
    // budget. Vault and asset are fixed — the Operations Vault and XLM — so this
    // asks only for the percentage. Present only when the vault address is
    // configured; without it there is nowhere to route the funds.
    key: "SetOpsFunding",
    label: "Operations funding",
    unit: "%",
    placeholder: "10",
    hint: "Monthly share of the treasury's XLM routed to the Operations Vault for moderation gas.",
    valid: (v) => isNum(v) && Number(v) >= 0 && Number(v) <= 100,
    toAction: (v) => ({
      tag: "SetOpsFunding",
      values: [{ vault: OPERATIONS_ID as string, token: NATIVE, bps: Math.round(Number(v) * 100) }],
    }),
  },
];

/** How a live proposal's stored action reads back for a person. */
const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  ACTIONS.map((a) => [a.key, a.label]),
);

interface ProposalState {
  id: number;
  approvals: number;
  owners: number;
  needed: number;
  closesAt: number;
  action: string;
  carried: boolean;
}

export function TreasuryGovernancePanel() {
  const { platformInfo } = usePlatformInfo();
  const { freighterWalletAddress } = useFreighterWallet();
  const { toast } = useToast();

  const [proposal, setProposal] = useState<ProposalState | null>(null);
  const [owners, setOwners] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const address = platformInfo?.feeWalletAddress ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setLoading(false);
      return;
    }

    (async () => {
      const c = treasuryClient(address);
      const [open, roster] = await Promise.all([
        simulate(() => c.get_proposal(), "get_proposal"),
        simulate(() => c.get_shareholders(), "get_shareholders"),
      ]);
      if (cancelled) return;

      const list =
        (roster as { address: string }[] | null)?.map((o) => o.address) ?? [];
      setOwners(list);

      if (open) {
        const p = open as any;
        const approvals = Number(p.approvals ?? 0);
        const needed = Math.ceil((list.length * 2) / 3);
        const tag = typeof p.action?.tag === "string" ? p.action.tag : String(p.action);
        setProposal({
          id: Number(p.id),
          approvals,
          owners: list.length,
          needed,
          closesAt: Number(p.closes_at) * 1000,
          action: ACTION_LABELS[tag] ?? tag,
          carried: approvals >= needed,
        });
      } else {
        setProposal(null);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [address, reload]);

  const isOwner = Boolean(
    freighterWalletAddress && owners.includes(freighterWalletAddress),
  );

  const act = (
    key: string,
    label: string,
    run: (c: ReturnType<typeof treasuryClient>) => Promise<unknown>,
  ) => {
    if (!freighterWalletAddress) {
      toast({ title: "Connect your wallet first", variant: "destructive" });
      return;
    }
    setBusy(key);
    startTransition(async () => {
      try {
        await run(treasuryClient(address, signerFor(freighterWalletAddress)));
        setReload((n) => n + 1);
        setDrafts({});
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

  if (!address) return null;

  const expired = proposal ? proposal.closesAt <= Date.now() : false;
  // A proposal that is open and still being voted on holds the single slot.
  const slotTaken = Boolean(proposal && !expired && !proposal.carried);

  // One row: label, a value in human units, a Propose.
  const proposeRow = (a: ActionSpec) => {
    const value = drafts[a.key] ?? "";
    const ready = value.trim() !== "" && a.valid(value);
    return (
      <div key={a.key} className="flex flex-wrap items-center gap-2">
        <div className="w-44 shrink-0 text-sm font-medium">{a.label}</div>
        <div className="relative min-w-0 flex-1 sm:max-w-[260px]">
          <Input
            value={value}
            onChange={(e) => setDrafts((d) => ({ ...d, [a.key]: e.target.value }))}
            placeholder={a.placeholder}
            title={a.hint}
            disabled={slotTaken}
            className="pr-14"
            inputMode="decimal"
            spellCheck={false}
            aria-label={`New ${a.label.toLowerCase()}`}
          />
          {a.unit && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {a.unit}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || slotTaken || !ready}
          title={
            slotTaken
              ? "A proposal is already open — one at a time"
              : !ready
                ? a.hint
                : `Propose a new ${a.label.toLowerCase()}`
          }
          onClick={() =>
            act(`propose:${a.key}`, "Proposal opened", async (c) =>
              send(
                await (c as any).propose({
                  proposer: freighterWalletAddress,
                  action: a.toAction(value),
                }),
              ),
            )
          }
        >
          {busy === `propose:${a.key}` ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="ml-1.5">Propose</span>
        </Button>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="h-5 w-5" aria-hidden="true" />
          Proposals
        </CardTitle>
        <CardDescription>
          A change carries on two thirds of the owners and can then be executed
          by anyone — applying an agreed change should not wait on the goodwill of
          whoever proposed it. One proposal runs at a time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading governance state…
          </div>
        ) : (
          <>
            {proposal ? (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      Proposal {proposal.id}: {proposal.action}
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
                        proposal.carried
                          ? "Already carried"
                          : expired
                            ? "Voting has closed"
                            : "Approve this proposal"
                      }
                      onClick={() =>
                        act("approve", "Approval recorded", async (c) =>
                          send(
                            await (c as any).approve_proposal({
                              voter: freighterWalletAddress,
                            }),
                          ),
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

                    {/* Permissionless once carried — the contract does not check
                        who executes, only that the vote passed. */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || !proposal.carried}
                      title={
                        proposal.carried
                          ? "Apply this change to the factory"
                          : "Not carried yet"
                      }
                      onClick={() =>
                        act("execute", "Proposal executed", async (c) =>
                          send(await (c as any).execute_proposal()),
                        )
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

            {isOwner ? (
              <div className="space-y-2 border-t pt-4">
                {slotTaken && (
                  <p className="text-xs text-amber-500">
                    A proposal is open. Settle it before starting another.
                  </p>
                )}
                {ACTIONS.filter(
                  (a) => a.key !== "SetOpsFunding" || Boolean(OPERATIONS_ID),
                ).map(proposeRow)}
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                <p className="text-xs text-muted-foreground">
                  {freighterWalletAddress
                    ? `${shortenAddress(freighterWalletAddress)} is not an owner of this treasury, so it cannot propose or vote. Connect an owner wallet.`
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
