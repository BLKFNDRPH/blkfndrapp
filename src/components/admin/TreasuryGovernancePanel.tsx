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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { treasuryClient, simulate } from "@/lib/stellar-clients";
import { signerFor, send } from "@/lib/treasury-signing";
import { shortenAddress } from "@/lib/utils";

/**
 * Changing a platform setting, by vote.
 *
 * Once the factory's admin is this treasury, every one of its settings — the
 * listing fee, the performance bond, the vault wasm, the fee destination, the
 * identity registry, the voting window, the minimum contribution — moves only
 * when two thirds of the owners agree. This is where that happens.
 *
 * It exists because the alternative was the CLI. Handing the factory to a
 * contract that only responds to `stellar contract invoke` would mean every
 * owner needed the toolchain installed and their key in a CLI keystore, which is
 * a worse position than the single admin key it replaced — the governance would
 * be real and unusable at the same time.
 *
 * One proposal at a time, which the contract enforces. That is deliberate: two
 * open votes on the same setting would make "what did we agree" a question about
 * ordering.
 */

/** The actions, and how to read the one number each of them takes. */
const ACTIONS = [
  {
    key: "SetFee",
    label: "Listing fee",
    hint: "A flat amount in stroops. 10 000 000 stroops = 1 XLM.",
    placeholder: "100000000",
    parse: (v: string) => ({ SetFee: BigInt(v) }),
  },
  {
    key: "SetBondBps",
    label: "Performance bond",
    hint: "Basis points of the raise. 500 = 5%. What a builder forfeits by missing a milestone.",
    placeholder: "500",
    parse: (v: string) => ({ SetBondBps: BigInt(v) }),
  },
  {
    key: "SetMinContribution",
    label: "Minimum contribution",
    hint: "The smallest amount a vault will accept, in stroops.",
    placeholder: "50000000",
    parse: (v: string) => ({ SetMinContribution: BigInt(v) }),
  },
  {
    key: "SetVotingWindow",
    label: "Milestone voting window",
    hint: "Seconds contributors have to vote on a milestone. 604 800 = 7 days.",
    placeholder: "604800",
    parse: (v: string) => ({ SetVotingWindow: BigInt(v) }),
  },
  {
    key: "SetFeeWallet",
    label: "Fee destination",
    hint: "Where listing fees go. Pointing this away is how this treasury is eventually replaced.",
    placeholder: "C…",
    parse: (v: string) => ({ SetFeeWallet: v.trim() }),
  },
  {
    key: "SetIdentityRegistry",
    label: "Identity registry",
    hint: "Which contract vouches for builder identity.",
    placeholder: "C…",
    parse: (v: string) => ({ SetIdentityRegistry: v.trim() }),
  },
  {
    key: "TransferAdmin",
    label: "Hand factory admin away",
    hint: "The escape hatch. Returns control of the factory to an address outside this treasury.",
    placeholder: "G… or C…",
    parse: (v: string) => ({ TransferAdmin: v.trim() }),
  },
] as const;

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
  const [actionKey, setActionKey] = useState<string>(ACTIONS[0].key);
  const [value, setValue] = useState("");
  const [, startTransition] = useTransition();

  const address = platformInfo?.feeWalletAddress ?? "";
  const chosen = ACTIONS.find((a) => a.key === actionKey) ?? ACTIONS[0];

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
        // Two thirds rounded up, matching the contract exactly. Shown rather
        // than left implicit because it is not obvious at every roster size —
        // three of four is needed, not two.
        const needed = Math.ceil((list.length * 2) / 3);
        setProposal({
          id: Number(p.id),
          approvals,
          owners: list.length,
          needed,
          closesAt: Number(p.closes_at) * 1000,
          action: typeof p.action?.tag === "string" ? p.action.tag : String(p.action),
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
        setValue("");
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="h-5 w-5" aria-hidden="true" />
          Platform Governance
        </CardTitle>
        <CardDescription>
          Platform settings change by vote, not by one signature. A proposal
          carries on two thirds of the owners and can then be executed by anyone
          — execution should not depend on the goodwill of whoever proposed it.
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
              <p className="text-sm text-muted-foreground">
                No proposal is open.
              </p>
            )}

            {isOwner ? (
              <div className="space-y-2 border-t pt-4">
                <Label>Propose a change</Label>
                <div className="flex flex-wrap gap-2">
                  <Select value={actionKey} onValueChange={setActionKey}>
                    <SelectTrigger className="w-[240px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIONS.map((a) => (
                        <SelectItem key={a.key} value={a.key}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={chosen.placeholder}
                    className="max-w-xs font-mono text-xs"
                    spellCheck={false}
                    aria-label={`New value for ${chosen.label}`}
                  />
                  <Button
                    size="sm"
                    disabled={busy !== null || !value.trim() || Boolean(proposal && !expired && !proposal.carried)}
                    title={
                      proposal && !expired && !proposal.carried
                        ? "A proposal is already open — one at a time"
                        : `Propose a change to the ${chosen.label.toLowerCase()}`
                    }
                    onClick={() =>
                      act("propose", "Proposal opened", async (c) =>
                        send(
                          await (c as any).propose({
                            proposer: freighterWalletAddress,
                            action: chosen.parse(value),
                          }),
                        ),
                      )
                    }
                  >
                    {busy === "propose" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span className="ml-1.5">Propose</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{chosen.hint}</p>
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
