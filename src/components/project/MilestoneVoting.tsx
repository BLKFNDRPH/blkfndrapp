"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
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
import { ExpandableText } from "@/components/ui/expandable-text";
import { useToast } from "@/hooks/use-toast";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { useStellarContract, type MilestoneWallets } from "@/hooks/use-stellar-contract";
import { currencyForToken, fromStroops } from "@/lib/currencies";
import { describeMoney } from "@/lib/money";

/**
 * Milestone release, from the contributor's side.
 *
 * This is the mechanism the platform exists for, so the panel is explicit
 * about it rather than presenting a bare Approve button: it shows what a
 * wallet's vote is worth after the 20% cap, how far the milestone is from the
 * threshold, and how long the window has left. A backer who cannot see why
 * their large contribution counts for less than they expect will assume the
 * cap is a bug.
 *
 * Two rules are live. Vaults deployed before the wallet floor release on more
 * than half the raw raise. Current vaults release on more than half the capped
 * total, from at least three approving wallets or every contributor when there
 * are fewer. The panel asks the vault which one it runs rather than guessing.
 */

interface VaultMilestone {
  id: number;
  amount: bigint;
  released: boolean;
  failed: boolean;
  vote_opens_at: bigint;
  approved_weight: bigint;
}

/** What the listing says about a milestone. Off-chain, so readable when the vault is not. */
export interface MilestoneDetail {
  id: number;
  title?: string;
  /** What the builder said this stage delivers. */
  description?: string;
  /** Whole units, shown when the vault could not be read or has no vote yet. */
  amount: number;
  released: boolean;
}

/** The vault's side of a milestone, for the block a card renders under its heading. */
export interface MilestoneVaultState {
  id: number;
  released: boolean;
  failed: boolean;
  /** Whether the builder has opened voting; null when the vault could not be read. */
  voteOpened: boolean | null;
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
  /**
   * The platform has locked the project. Only the builder's opening of a new
   * window is paused: voting in an open one, executing a carried release and
   * settling a lapsed one stay with the stakeholders, lock or no lock.
   */
  platformLocked?: boolean;
  /**
   * Titles and deliverables from the listing, and the cards to fall back on if
   * the vault can't be read.
   */
  details?: MilestoneDetail[];
  /**
   * Rendered in each milestone's card, under its heading: the builder's proof
   * for that milestone, so it sits beside the vote it supports.
   */
  renderProof?: (milestone: MilestoneVaultState) => ReactNode;
  onChange?: () => void;
}

/** `unconfirmed`: the window has closed, but a failed read left the outcome unknown. */
type Phase =
  | "locked"
  | "voting"
  | "passed"
  | "released"
  | "failed"
  | "lapsed"
  | "unconfirmed";

/**
 * Whether a milestone's vote has carried. Mirrors the contract's `carried`.
 *
 * Null when a read it depends on failed. The weight bar alone can say no, but
 * only the wallet count can say yes on a vault with the floor, so an unknown
 * count is never read as a met one.
 */
function carriedOf(
  approved: bigint,
  required: bigint | null,
  walletFloor: boolean | null,
  count: MilestoneWallets | null | undefined,
): boolean | null {
  if (required === null) return null;
  if (approved < required) return false;
  if (walletFloor === false) return true;
  if (count?.supported) return count.approvals >= count.required;
  return null;
}

function phaseOf(m: VaultMilestone, windowEndsAt: number, carried: boolean | null): Phase {
  if (m.released) return "released";
  if (m.failed) return "failed";
  if (m.vote_opens_at === 0n) return "locked";
  if (carried === true) return "passed";
  if (Date.now() / 1000 < windowEndsAt) return "voting";
  return carried === false ? "lapsed" : "unconfirmed";
}

const fmt = (stroops: bigint) =>
  fromStroops(stroops).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Distinct approvals against the floor, in the same shape as the weight line. */
function walletsLine({ approvals, required }: { approvals: number; required: number }) {
  return approvals <= required
    ? `${approvals} of ${required} stakeholder ${required === 1 ? "approval" : "approvals"} needed`
    : `${approvals} stakeholder approvals (${required} needed)`;
}

const PHASE_LABEL: Record<Phase, string> = {
  locked: "Not open",
  voting: "Voting open",
  passed: "Approved",
  released: "Released",
  failed: "Failed",
  lapsed: "Window closed",
  unconfirmed: "Unconfirmed",
};

const PHASE_VARIANT: Record<Phase, "default" | "secondary" | "destructive" | "outline"> = {
  locked: "outline",
  voting: "default",
  passed: "default",
  released: "secondary",
  failed: "destructive",
  lapsed: "destructive",
  unconfirmed: "outline",
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

/** A milestone card's top row: its number and title, its state, its amount. */
function MilestoneHeading({
  id,
  title,
  badge,
  amount,
}: {
  id: number;
  title?: string;
  badge?: ReactNode;
  amount: string;
}) {
  const name = title?.trim();
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h5 className="min-w-0 break-words font-semibold">
          Stage {id}
          {name && `: ${name}`}
        </h5>
        {badge}
      </div>
      <span className="text-sm text-muted-foreground">{amount}</span>
    </div>
  );
}

/**
 * What the builder promised a stage delivers, from the listing. It is what a
 * stakeholder judges the proof against, so it sits right under the heading.
 */
function Deliverable({ text }: { text?: string }) {
  const body = text?.trim();
  if (!body) return null;
  return <ExpandableText text={body} lines={3} className="mt-2 text-sm text-muted-foreground" />;
}

/**
 * Each stage's whole-number share of the goal. When the stages add up to the
 * goal, so do the shares: rounding each one alone showed three equal stages as
 * 33% apiece, which reads as a percent gone missing.
 */
function sharesOfGoal(amounts: number[], goal: number): (number | null)[] {
  if (!(goal > 0)) return amounts.map(() => null);
  const exact = amounts.map((a) => (a / goal) * 100);
  const total = amounts.reduce((sum, a) => sum + a, 0);
  if (Math.abs(total - goal) > goal * 1e-9) return exact.map((x) => Math.round(x));

  // Largest remainder: floor every share, then hand the missing points to the
  // shares that lost the most to the floor.
  const shares = exact.map((x) => Math.floor(x));
  let missing = 100 - shares.reduce((sum, x) => sum + x, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { i } of byRemainder) {
    if (missing <= 0) break;
    shares[i] += 1;
    missing -= 1;
  }
  return shares;
}

/**
 * The stages as the listing sets them out, before any vote can open: what each
 * one pays, its share of the goal and what it delivers. It needs nothing from
 * the network, so a visitor deciding whether to stake sees how the money will
 * be released while the vault is still raising.
 */
export function MilestonePlan({
  details,
  currency,
  goal,
  note,
}: {
  details: MilestoneDetail[];
  currency: string;
  /** The goal in whole units, for each stage's share of it. */
  goal: number;
  /** One sentence above the stages on where the vault is. */
  note: string;
}) {
  const shares = sharesOfGoal(
    details.map((d) => d.amount),
    goal,
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{note}</p>
      {details.map((d, index) => {
        const share = shares[index];
        return (
          <div key={d.id} className="rounded-lg border p-4">
            <MilestoneHeading
              id={d.id}
              title={d.title}
              badge={
                d.released ? (
                  <Badge variant={PHASE_VARIANT.released}>{PHASE_LABEL.released}</Badge>
                ) : (
                  <Badge variant="outline">Not started</Badge>
                )
              }
              amount={`${describeMoney(d.amount, currency).primary}${share !== null ? ` · ${share}% of the goal` : ""}`}
            />
            <Deliverable text={d.description} />
          </div>
        );
      })}
    </div>
  );
}

export function MilestoneVoting({
  vaultAddress,
  currency: listedCurrency,
  creatorAddress,
  platformLocked = false,
  details,
  renderProof,
  onChange,
}: Props) {
  const { toast } = useToast();
  const { freighterWalletAddress } = useFreighterWallet();
  const {
    getVaultInfo,
    getVotingWeight,
    hasVoted,
    getMilestoneVote,
    getMilestoneWallets,
    openMilestoneVote,
    approveMilestone,
    releaseMilestone,
    settleLapsedMilestone,
  } = useStellarContract();

  const [milestones, setMilestones] = useState<VaultMilestone[]>([]);
  const [raised, setRaised] = useState(0n);
  const [windowSecs, setWindowSecs] = useState(0);
  const [token, setToken] = useState<string | undefined>(undefined);
  // The vault's own bar, not one computed here: it differs between the rules.
  const [requiredWeight, setRequiredWeight] = useState<bigint | null>(null);
  const [wallets, setWallets] = useState<Record<number, MilestoneWallets | null>>({});
  const [myWeight, setMyWeight] = useState(0n);
  const [voted, setVoted] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
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
      // A failed read is not an empty vault, and the last answer's buttons
      // must not outlive it.
      if (!info) {
        setReadFailed(true);
        setMilestones([]);
        return;
      }
      setReadFailed(false);

      const list: VaultMilestone[] = info.milestones ?? [];
      setMilestones(list);
      setRaised(BigInt(info.raised_amount ?? 0));
      setWindowSecs(Number(info.voting_window_secs ?? 0));
      setToken(info.token ? String(info.token) : undefined);

      // Only a vote that has opened and not settled can still carry, so only
      // those need counting. With none, ask once anyway: the answer also says
      // which rule this vault runs, and the header explains it.
      const live = list.filter((m) => !m.released && !m.failed && m.vote_opens_at !== 0n);
      const counted = live.length > 0 ? live : list.slice(0, 1);

      const [vote, counts] = await Promise.all([
        // The bar is the same for every milestone of a vault; one read serves all.
        list.length > 0 ? getMilestoneVote(vaultAddress, list[0].id) : null,
        Promise.all(
          counted.map(async (m) => [m.id, await getMilestoneWallets(vaultAddress, m.id)] as const),
        ),
      ]);
      setRequiredWeight(vote ? vote[1] : null);
      setWallets(Object.fromEntries(counts));

      if (freighterWalletAddress) {
        const weight = await getVotingWeight(vaultAddress, freighterWalletAddress);
        setMyWeight(BigInt((weight as bigint | null) ?? 0n));

        const results = await Promise.all(
          list.map(async (m: VaultMilestone) => [
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
  }, [
    vaultAddress,
    freighterWalletAddress,
    getVaultInfo,
    getVotingWeight,
    hasVoted,
    getMilestoneVote,
    getMilestoneWallets,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const cap = useMemo(() => (raised * 2000n) / 10000n, [raised]);

  // Whether this vault enforces the wallet floor: false for one deployed
  // before it, null while no read has answered either way. A vault's code
  // never changes, so one definite answer settles it for every milestone.
  const walletFloor = useMemo(() => {
    const answers = Object.values(wallets);
    if (answers.some((a) => a?.supported === false)) return false;
    if (answers.some((a) => a?.supported === true)) return true;
    return null;
  }, [wallets]);

  // Every figure below is money the vault is about to move, so name the asset
  // the vault actually holds. Fall back to the listing's label only until the
  // vault has answered, and to the token address if this deployment has no
  // name for it — showing an address is honest, showing the wrong ticker is not.
  const currency = useMemo(() => {
    if (!token) return listedCurrency;
    return currencyForToken(token) ?? `${token.slice(0, 4)}…${token.slice(-4)}`;
  }, [token, listedCurrency]);

  const listed = useMemo(
    () => new Map((details ?? []).map((d) => [d.id, d])),
    [details],
  );

  const run = (id: number, label: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        await action();
        toast({ title: label, description: "Confirmed." });
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

  // The vault couldn't be read, so nothing about the vote is known. The
  // listing's copy of each milestone still carries the builder's proof, which
  // whoever is deciding needs to see whether or not the network answers.
  if (readFailed) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span>We couldn&apos;t read the vote right now, so voting is unavailable.</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => {
              load();
            }}
          >
            Try again
          </Button>
        </div>
        {(details ?? []).map((d) => (
          <div key={d.id} className="rounded-lg border p-4">
            <MilestoneHeading
              id={d.id}
              title={d.title}
              badge={
                d.released ? (
                  <Badge variant={PHASE_VARIANT.released}>{PHASE_LABEL.released}</Badge>
                ) : undefined
              }
              amount={describeMoney(d.amount, currency).primary}
            />
            <Deliverable text={d.description} />
            {renderProof?.({ id: d.id, released: d.released, failed: false, voteOpened: null })}
          </div>
        ))}
      </div>
    );
  }

  if (milestones.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        This project has no milestones.
      </p>
    );
  }

  const isContributor = myWeight > 0n;

  const retry = (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0 text-xs"
      onClick={() => {
        load();
      }}
    >
      Retry
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Stakeholders decide when money moves.</p>
            {walletFloor === true && (
              <p className="text-muted-foreground">
                A payout needs more than half of the stakeholders&apos; combined vote,
                with no single wallet counting for more than 20% of all stakes,
                and it needs at least three stakeholders to approve — or every
                stakeholder, when there are fewer than three. If a window closes
                short, the stage fails and the builder&apos;s deposit is
                forfeited to you.
              </p>
            )}
            {walletFloor === false && (
              <p className="text-muted-foreground">
                A payout needs more than half of all stakes behind it, and no
                single wallet counts for more than 20% — so it always takes at
                least three stakeholders. If a window closes short, the stage fails
                and the builder&apos;s deposit is forfeited to you.
              </p>
            )}
            {walletFloor === null && (
              <p className="text-muted-foreground">
                Each payout goes to a vote of the stakeholders, and no single wallet
                counts for more than 20% of all stakes. If a window closes short,
                the stage fails and the builder&apos;s deposit is forfeited to
                you.
              </p>
            )}
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
        const approved = BigInt(m.approved_weight ?? 0);
        const count = wallets[m.id];
        const carried = carriedOf(approved, requiredWeight, walletFloor, count);
        const phase = phaseOf(m, endsAt, carried);
        const pct =
          requiredWeight && requiredWeight > 0n
            ? Math.min(100, Number((approved * 100n) / requiredWeight))
            : 0;
        // The vault has the floor, or may have, and this milestone's count did
        // not come back. Say so rather than show a tally missing its other half.
        const countUnread = walletFloor !== false && !count;
        const busy = busyId === m.id;
        const alreadyVoted = voted[m.id];

        return (
          <div key={m.id} className="rounded-lg border p-4">
            <MilestoneHeading
              id={m.id}
              title={listed.get(m.id)?.title}
              badge={<Badge variant={PHASE_VARIANT[phase]}>{PHASE_LABEL[phase]}</Badge>}
              amount={`${fromStroops(BigInt(m.amount)).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })} ${currency}`}
            />
            <Deliverable text={listed.get(m.id)?.description} />

            {renderProof?.({
              id: m.id,
              released: m.released,
              failed: m.failed,
              voteOpened: opensAt !== 0,
            })}

            {(phase === "voting" ||
              phase === "passed" ||
              phase === "lapsed" ||
              phase === "unconfirmed") && (
              <div className="mt-3 space-y-1.5">
                <Progress value={pct} aria-label={`Milestone ${m.id} approval`} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {requiredWeight !== null
                      ? `${fmt(approved)} of ${fmt(requiredWeight)} ${currency} needed`
                      : `${fmt(approved)} ${currency} approved`}
                  </span>
                  {phase === "voting" && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {timeLeft(endsAt)}
                    </span>
                  )}
                </div>
                {count?.supported && (
                  <p className="text-xs text-muted-foreground">{walletsLine(count)}</p>
                )}
                {(requiredWeight === null || countUnread) && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Part of this vote could not be read from the network.
                    {retry}
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {phase === "locked" && isCreator && platformLocked && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  The platform has locked this project, so opening a vote is
                  paused until it is unlocked.
                </p>
              )}

              {phase === "locked" && isCreator && !platformLocked && (
                <Button size="sm" disabled={busy} onClick={() =>
                  run(m.id, "Voting opened", () =>
                    openMilestoneVote({ vaultAddress, milestoneId: m.id }),
                  )
                }>
                  {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Open voting
                  <span className="sr-only"> on milestone {m.id}</span>
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
                  <span className="sr-only"> of milestone {m.id}</span>
                </Button>
              )}

              {phase === "voting" && alreadyVoted && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  You have voted. One vote per stakeholder.
                </p>
              )}

              {phase === "voting" && !isContributor && (
                <p className="text-sm text-muted-foreground">
                  Only this project&apos;s stakeholders can vote.
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
                    Pay out this stage
                    <span className="sr-only"> (stage {m.id})</span>
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
                    <span className="sr-only">: milestone {m.id}</span>
                  </Button>
                  <p className="self-center text-xs text-muted-foreground">
                    Closed without carrying. Settling returns money to stakeholders
                    and forfeits the builder&apos;s deposit.
                  </p>
                </>
              )}

              {phase === "unconfirmed" && (
                <p className="text-sm text-muted-foreground">
                  The window has closed, but whether the vote carried could not
                  be confirmed. Retry before releasing or settling.
                </p>
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
                  Failed. Stakeholders can collect their share of the remaining money
                  and the builder&apos;s deposit.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
