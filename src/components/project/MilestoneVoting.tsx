"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  CheckCircle2,
  Clock,
  Lock,
  Loader2,
  ShieldCheck,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { currencyForToken, fromStroops } from "@/lib/currencies";

/**
 * Milestone release, from the contributor's side.
 *
 * This is the mechanism the platform exists for, so the panel is explicit
 * about it rather than presenting a bare Approve button: it shows what a
 * wallet's vote is worth after the 20% cap, how far the milestone is from the
 * threshold, and how long the window has left. A backer who cannot see why
 * their large contribution counts for less than they expect will assume the
 * cap is a bug.
 */

interface VaultMilestone {
  id: number;
  amount: bigint;
  released: boolean;
  failed: boolean;
  vote_opens_at: bigint;
  approved_weight: bigint;
}

interface Props {
  vaultAddress: string;
  /**
   * The listing's currency label, used only until the vault reports its own
   * token. It comes from creator-supplied metadata, so it is a claim about
   * which asset is escrowed rather than evidence of it.
   */
  currency: string;
  /** The project's builder, who alone may open a window. */
  creatorAddress: string;
  onChange?: () => void;
}

type Phase = "locked" | "voting" | "passed" | "released" | "failed" | "lapsed";

function phaseOf(m: VaultMilestone, windowEndsAt: number, threshold: bigint): Phase {
  if (m.released) return "released";
  if (m.failed) return "failed";
  if (m.vote_opens_at === 0n) return "locked";
  if (m.approved_weight > threshold) return "passed";
  return Date.now() / 1000 >= windowEndsAt ? "lapsed" : "voting";
}

const PHASE_LABEL: Record<Phase, string> = {
  locked: "Not open",
  voting: "Voting open",
  passed: "Approved",
  released: "Released",
  failed: "Failed",
  lapsed: "Window closed",
};

const PHASE_VARIANT: Record<Phase, "default" | "secondary" | "destructive" | "outline"> = {
  locked: "outline",
  voting: "default",
  passed: "default",
  released: "secondary",
  failed: "destructive",
  lapsed: "destructive",
};

function timeLeft(endsAt: number): string {
  const seconds = Math.max(0, Math.floor(endsAt - Date.now() / 1000));
  if (seconds === 0) return "closed";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function MilestoneVoting({
  vaultAddress,
  currency: listedCurrency,
  creatorAddress,
  onChange,
}: Props) {
  const { toast } = useToast();
  const { freighterWalletAddress } = useFreighterWallet();
  const {
    getVaultInfo,
    getVotingWeight,
    hasVoted,
    openMilestoneVote,
    approveMilestone,
    releaseMilestone,
    settleLapsedMilestone,
  } = useStellarContract();

  const [milestones, setMilestones] = useState<VaultMilestone[]>([]);
  const [raised, setRaised] = useState(0n);
  const [windowSecs, setWindowSecs] = useState(0);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [myWeight, setMyWeight] = useState(0n);
  const [voted, setVoted] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  // Re-renders the countdown without refetching.
  const [, setTick] = useState(0);

  const isCreator =
    Boolean(freighterWalletAddress) && freighterWalletAddress === creatorAddress;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const info: any = await getVaultInfo(vaultAddress);
      if (!info) return;

      setMilestones(info.milestones ?? []);
      setRaised(BigInt(info.raised_amount ?? 0));
      setWindowSecs(Number(info.voting_window_secs ?? 0));
      setToken(info.token ? String(info.token) : undefined);

      if (freighterWalletAddress) {
        const weight = await getVotingWeight(vaultAddress, freighterWalletAddress);
        setMyWeight(BigInt((weight as bigint | null) ?? 0n));

        const results = await Promise.all(
          (info.milestones ?? []).map(async (m: VaultMilestone) => [
            m.id,
            Boolean(await hasVoted(vaultAddress, m.id, freighterWalletAddress)),
          ]),
        );
        setVoted(Object.fromEntries(results));
      } else {
        setMyWeight(0n);
        setVoted({});
      }
    } finally {
      setLoading(false);
    }
  }, [vaultAddress, freighterWalletAddress, getVaultInfo, getVotingWeight, hasVoted]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Smallest weight that clears "more than 50% of the raise". Mirrors the
  // contract so the UI never claims a vote will pass when it will not.
  const threshold = useMemo(() => (raised * 5000n) / 10000n, [raised]);
  const cap = useMemo(() => (raised * 2000n) / 10000n, [raised]);

  // Every figure below is money the vault is about to move, so name the asset
  // the vault actually holds. Fall back to the listing's label only until the
  // vault has answered, and to the token address if this deployment has no
  // name for it — showing an address is honest, showing the wrong ticker is not.
  const currency = useMemo(() => {
    if (!token) return listedCurrency;
    return currencyForToken(token) ?? `${token.slice(0, 4)}…${token.slice(-4)}`;
  }, [token, listedCurrency]);

  const run = (id: number, label: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        await action();
        toast({ title: label, description: "Confirmed on-chain." });
        await load();
        onChange?.();
      } catch (error: any) {
        toast({
          title: `${label} failed`,
          description: error?.message ?? String(error),
          variant: "destructive",
        });
      } finally {
        setBusyId(null);
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading milestones…
      </div>
    );
  }

  if (milestones.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        This project has no milestones on-chain.
      </p>
    );
  }

  const isContributor = myWeight > 0n;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Backers decide when funds move.</p>
            <p className="text-muted-foreground">
              A release needs more than half the total raise behind it, and no
              single wallet counts for more than 20% — so it always takes at
              least three backers. If a window closes short, the milestone fails
              and the builder&apos;s bond is forfeited to you.
            </p>
            {isContributor && (
              <p className="pt-1">
                Your vote is worth{" "}
                <strong>
                  {fromStroops(myWeight).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{" "}
                  {currency}
                </strong>
                {myWeight >= cap && cap > 0n && (
                  <span className="text-muted-foreground"> (capped at 20%)</span>
                )}
                .
              </p>
            )}
          </div>
        </div>
      </div>

      {milestones.map((m) => {
        const opensAt = Number(m.vote_opens_at);
        const endsAt = opensAt === 0 ? 0 : opensAt + windowSecs;
        const phase = phaseOf(m, endsAt, threshold);
        const approved = BigInt(m.approved_weight ?? 0);
        const pct =
          threshold > 0n ? Math.min(100, Number((approved * 100n) / (threshold + 1n))) : 0;
        const busy = busyId === m.id;
        const alreadyVoted = voted[m.id];

        return (
          <div key={m.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Milestone {m.id}</span>
                <Badge variant={PHASE_VARIANT[phase]}>{PHASE_LABEL[phase]}</Badge>
              </div>
              <span className="text-sm text-muted-foreground">
                {fromStroops(BigInt(m.amount)).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                {currency}
              </span>
            </div>

            {(phase === "voting" || phase === "passed" || phase === "lapsed") && (
              <div className="mt-3 space-y-1.5">
                <Progress value={pct} aria-label={`Milestone ${m.id} approval`} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {fromStroops(approved).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}{" "}
                    of{" "}
                    {fromStroops(threshold + 1n).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}{" "}
                    {currency} needed
                  </span>
                  {phase === "voting" && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {timeLeft(endsAt)}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {phase === "locked" && isCreator && (
                <Button size="sm" disabled={busy} onClick={() =>
                  run(m.id, "Voting opened", () =>
                    openMilestoneVote({ vaultAddress, milestoneId: m.id }),
                  )
                }>
                  {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Open voting
                </Button>
              )}

              {phase === "locked" && !isCreator && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  The builder has not opened this milestone for voting yet.
                </p>
              )}

              {phase === "voting" && isContributor && !alreadyVoted && (
                <Button size="sm" disabled={busy} onClick={() =>
                  run(m.id, "Vote recorded", () =>
                    approveMilestone({ vaultAddress, milestoneId: m.id }),
                  )
                }>
                  {busy ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ThumbsUp className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Approve release
                </Button>
              )}

              {phase === "voting" && alreadyVoted && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  You have voted. One vote per backer.
                </p>
              )}

              {phase === "voting" && !isContributor && (
                <p className="text-sm text-muted-foreground">
                  Only backers of this project can vote.
                </p>
              )}

              {phase === "passed" && (
                <>
                  <Button size="sm" disabled={busy} onClick={() =>
                    run(m.id, "Milestone released", () =>
                      releaseMilestone({ vaultAddress, milestoneId: m.id }),
                    )
                  }>
                    {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Release funds
                  </Button>
                  <p className="self-center text-xs text-muted-foreground">
                    Approved — anyone can execute this. Nobody can hold it up.
                  </p>
                </>
              )}

              {phase === "lapsed" && (
                <>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() =>
                    run(m.id, "Milestone settled", () =>
                      settleLapsedMilestone({ vaultAddress, milestoneId: m.id }),
                    )
                  }>
                    {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Settle as failed
                  </Button>
                  <p className="self-center text-xs text-muted-foreground">
                    Closed short of the threshold. Settling refunds backers and
                    forfeits the bond.
                  </p>
                </>
              )}

              {phase === "released" && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                  Released to the builder.
                </p>
              )}

              {phase === "failed" && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                  Failed. Backers can claim their share of the remaining funds
                  and the forfeited bond.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
