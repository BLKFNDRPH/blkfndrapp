"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
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
import { useAuth } from "@/context/AuthContext";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import { MoneyActionPanel } from "@/components/money-action/MoneyActionPanel";
import {
  useStellarContract,
  type MilestoneStake,
  type MilestoneWallets,
} from "@/hooks/use-stellar-contract";
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
 * Three rules exist. Vaults deployed before the wallet floor release on more
 * than half the raw raise. Later vaults release on more than half the capped
 * total, from at least three approving wallets or every contributor when there
 * are fewer. The newest also need the approvers to have put in more than half
 * the raise between them. The panel asks the vault which one it runs rather
 * than guessing.
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
  /** Open the refund sheet, for a stakeholder of a stage that failed. */
  onCollectRefund?: () => void;
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
 * Every condition the vault runs must hold. Any one can say no, but yes needs
 * all of them, so a condition whose read failed is never taken as met: the
 * answer is null instead.
 */
function carriedOf(
  approved: bigint,
  required: bigint | null,
  walletFloor: boolean | null,
  count: MilestoneWallets | null | undefined,
  moneyMajority: boolean | null,
  stake: MilestoneStake | null | undefined,
): boolean | null {
  const weight = required === null ? null : approved >= required;
  // A vault from before the wallet floor releases on weight alone.
  if (walletFloor === false) return weight;
  const wallets = count?.supported ? count.approvals >= count.required : null;
  // One from before the money majority releases on weight and wallets.
  const money =
    moneyMajority === false ? true : stake?.supported ? stake.approved >= stake.required : null;
  const conditions = [weight, wallets, money];
  if (conditions.includes(false)) return false;
  if (conditions.includes(null)) return null;
  return true;
}

function phaseOf(m: VaultMilestone, windowEndsAt: number, carried: boolean | null): Phase {
  if (m.released) return "released";
  if (m.failed) return "failed";
  if (m.vote_opens_at === 0n) return "locked";
  if (carried === true) return "passed";
  if (Date.now() / 1000 < windowEndsAt) return "voting";
  return carried === false ? "lapsed" : "unconfirmed";
}

/** Distinct approvals against the floor, in the same shape as the weight line. */
function walletsLine({ approvals, required }: { approvals: number; required: number }) {
  return approvals <= required
    ? `${approvals} of the ${required} ${required === 1 ? "stakeholder" : "stakeholders"} needed have said yes`
    : `${approvals} stakeholders have said yes (${required} needed)`;
}

/**
 * What the yes-voters put in, against the whole raise, as formatted figures.
 * Stated as "more than half" rather than as the contract's bar, which is half
 * plus one base unit and would print as exactly half.
 */
function stakeLine(approved: string, raised: string) {
  return `Those saying yes put in ${approved} of the ${raised} staked; more than half is needed`;
}

const PHASE_LABEL: Record<Phase, string> = {
  locked: "Not yet up for a vote",
  voting: "Vote open",
  passed: "Approved · payout ready",
  released: "Paid to the builder",
  failed: "Stage failed · refunds open",
  lapsed: "Vote ended short",
  unconfirmed: "Result not confirmed",
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

/** Which money action a stage card has open, if any. */
type StageAction = { id: number; kind: "approve" | "open" | "payout" | "close" };

export function MilestoneVoting({
  vaultAddress,
  currency: listedCurrency,
  creatorAddress,
  platformLocked = false,
  details,
  renderProof,
  onChange,
  onCollectRefund,
}: Props) {
  const { user } = useAuth();
  const { freighterWalletAddress } = useFreighterWallet();
  const {
    getVaultInfo,
    getVotingWeight,
    hasVoted,
    getMilestoneVote,
    getMilestoneWallets,
    getMilestoneStake,
    prepareOpenMilestoneVote,
    prepareApproveMilestone,
    prepareReleaseMilestone,
    prepareSettleLapsedMilestone,
  } = useStellarContract();

  const [milestones, setMilestones] = useState<VaultMilestone[]>([]);
  const [raised, setRaised] = useState(0n);
  const [windowSecs, setWindowSecs] = useState(0);
  const [token, setToken] = useState<string | undefined>(undefined);
  // The vault's own bar, not one computed here: it differs between the rules.
  const [requiredWeight, setRequiredWeight] = useState<bigint | null>(null);
  const [wallets, setWallets] = useState<Record<number, MilestoneWallets | null>>({});
  const [stakes, setStakes] = useState<Record<number, MilestoneStake | null>>({});
  const [myWeight, setMyWeight] = useState(0n);
  const [voted, setVoted] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [active, setActive] = useState<StageAction | null>(null);
  // Re-renders the countdown without refetching.
  const [, setTick] = useState(0);

  // Whose stake and vote to read: the account's linked wallet, so a
  // stakeholder is recognised as one whether or not the wallet happens to be
  // connected in this browser right now. Acting still needs that wallet
  // connected; the action panel asks for it.
  const myAddress = user?.stellarPublicKey || freighterWalletAddress || "";
  const isBuilder =
    !!creatorAddress &&
    (myAddress === creatorAddress || freighterWalletAddress === creatorAddress);

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

      const [vote, counts, staked] = await Promise.all([
        // The bar is the same for every milestone of a vault; one read serves all.
        list.length > 0 ? getMilestoneVote(vaultAddress, list[0].id) : null,
        Promise.all(
          counted.map(async (m) => [m.id, await getMilestoneWallets(vaultAddress, m.id)] as const),
        ),
        Promise.all(
          counted.map(async (m) => [m.id, await getMilestoneStake(vaultAddress, m.id)] as const),
        ),
      ]);
      setRequiredWeight(vote ? vote[1] : null);
      setWallets(Object.fromEntries(counts));
      setStakes(Object.fromEntries(staked));

      if (myAddress) {
        const weight = await getVotingWeight(vaultAddress, myAddress);
        setMyWeight(BigInt((weight as bigint | null) ?? 0n));

        const results = await Promise.all(
          list.map(async (m: VaultMilestone) => [
            m.id,
            Boolean(await hasVoted(vaultAddress, m.id, myAddress)),
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
    myAddress,
    getVaultInfo,
    getVotingWeight,
    hasVoted,
    getMilestoneVote,
    getMilestoneWallets,
    getMilestoneStake,
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

  // Whether this vault also needs a majority of the money, settled the same way.
  const moneyMajority = useMemo(() => {
    const answers = Object.values(stakes);
    if (answers.some((a) => a?.supported === false)) return false;
    if (answers.some((a) => a?.supported === true)) return true;
    return null;
  }, [stakes]);

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

  /** "$1,500" for a dollar vault, "≈ $320" for XLM with a rate, else "1,500 XLM". */
  const money = (stroops: bigint) => describeMoney(fromStroops(stroops), currency).primary;
  /** The exact figure the wallet window shows. */
  const exact = (stroops: bigint) =>
    `${fromStroops(stroops).toLocaleString("en-US", { maximumFractionDigits: 7 })} ${currency}`;

  const windowDays = Math.max(1, Math.round(windowSecs / 86_400));
  const afterAction = () => {
    load();
    onChange?.();
  };

  if (loading) {
    return (
      <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading stages…
      </div>
    );
  }

  // The vault couldn't be read, so nothing about the vote is known. The
  // listing's copy of each stage still carries the builder's proof, which
  // whoever is deciding needs to see whether or not the network answers.
  if (readFailed) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span>We couldn&apos;t read the vote right now.</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => load()}>
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
    return <p className="py-6 text-sm text-muted-foreground">This project has no stages yet.</p>;
  }

  const isStakeholder = myWeight > 0n;
  // Someone with a reason to press a permissionless button: never a visitor,
  // who would pay a network fee to move someone else's money.
  const canTrigger = !!user && (isStakeholder || isBuilder);

  const rule =
    walletFloor === true && moneyMajority === true
      ? `A payout needs more than half of all stakes behind it, from at least three stakeholders, or every stakeholder when there are fewer, and those saying yes must have put in more than half the money between them. No one person counts for more than 20%. Each vote stays open for ${windowDays} days. If it ends short, the stage fails and refunds open, with a share of the builder's deposit.`
      : walletFloor === true
      ? `A payout needs more than half of all stakes behind it, from at least three stakeholders, or every stakeholder when there are fewer. No one person counts for more than 20%. Each vote stays open for ${windowDays} days. If it ends short, the stage fails and refunds open, with a share of the builder's deposit.`
      : walletFloor === false
        ? `A payout needs more than half of all stakes behind it. No one person counts for more than 20%, so it always takes at least three stakeholders. Each vote stays open for ${windowDays} days. If it ends short, the stage fails and refunds open, with a share of the builder's deposit.`
        : `Each payout goes to a vote of the stakeholders, and no one person counts for more than 20%. Each vote stays open for ${windowDays} days. If it ends short, the stage fails and refunds open, with a share of the builder's deposit.`;

  const retry = (
    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => load()}>
      Try again
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-muted-foreground">{rule}</p>
            {isStakeholder ? (
              <p className="pt-1 text-foreground">
                Your say: <strong>{money(myWeight)}</strong>
                {requiredWeight !== null && <> of the {money(requiredWeight)} needed</>}
                {myWeight >= cap && cap > 0n && (
                  <span className="text-muted-foreground"> (capped at 20% of all stakes)</span>
                )}
                .
              </p>
            ) : user ? (
              <p className="pt-1 text-muted-foreground">
                Only stakeholders vote. Staking closed when the goal was reached.
              </p>
            ) : (
              <p className="pt-1 text-muted-foreground">Sign in to see if you can vote.</p>
            )}
          </div>
        </div>
      </div>

      {milestones.map((m) => {
        const opensAt = Number(m.vote_opens_at);
        const endsAt = opensAt === 0 ? 0 : opensAt + windowSecs;
        const approved = BigInt(m.approved_weight ?? 0);
        const count = wallets[m.id];
        const stake = stakes[m.id];
        const carried = carriedOf(approved, requiredWeight, walletFloor, count, moneyMajority, stake);
        const phase = phaseOf(m, endsAt, carried);
        const pct =
          requiredWeight && requiredWeight > 0n
            ? Math.min(100, Number((approved * 100n) / requiredWeight))
            : 0;
        // The vault has the floor, or may have, and this stage's count did
        // not come back. Say so rather than show a tally missing its other half.
        const countUnread = walletFloor !== false && !count;
        // Likewise for the money majority, which only a vault with the floor can have.
        const stakeUnread = walletFloor !== false && moneyMajority !== false && !stake;
        const alreadyVoted = voted[m.id];
        const stageName = `Stage ${m.id}`;
        const amount = BigInt(m.amount);
        const open = active?.id === m.id ? active.kind : null;
        const close = () => setActive(null);
        const endsText = new Date(endsAt * 1000).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <div key={m.id} className="rounded-lg border p-4">
            <MilestoneHeading
              id={m.id}
              title={listed.get(m.id)?.title}
              badge={
                <Badge variant={PHASE_VARIANT[phase]}>
                  {phase === "voting" ? `${PHASE_LABEL.voting} · ${timeLeft(endsAt)}` : PHASE_LABEL[phase]}
                </Badge>
              }
              amount={money(amount)}
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
                <Progress value={pct} aria-label={`${stageName} approval`} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {requiredWeight !== null
                      ? `${money(approved)} of ${money(requiredWeight)} yes so far`
                      : `${money(approved)} yes so far`}
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
                {stake?.supported && (
                  <p className="text-xs text-muted-foreground">
                    {stakeLine(money(stake.approved), money(raised))}
                  </p>
                )}
                {phase === "voting" && (
                  <p className="text-xs text-muted-foreground">
                    If it isn&apos;t approved by {endsText}, the stage fails and refunds open.
                  </p>
                )}
                {(requiredWeight === null || countUnread || stakeUnread) && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Part of this vote couldn&apos;t be read right now.
                    {retry}
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 space-y-2">
              {/* ── Not yet up for a vote ── */}
              {phase === "locked" && isBuilder && platformLocked && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  BLKFNDR has paused this listing, so opening a new vote is paused.
                </p>
              )}
              {phase === "locked" && isBuilder && !platformLocked && open !== "open" && (
                <div className="space-y-1.5">
                  <Button size="sm" onClick={() => setActive({ id: m.id, kind: "open" })}>
                    Ask stakeholders for this payout
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Stakeholders get {windowDays} days to vote. Add your proof first so they can see
                    what they&apos;re approving.
                  </p>
                </div>
              )}
              {phase === "locked" && !isBuilder && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  The builder opens the vote when this stage is done and proof is posted.
                </p>
              )}
              {open === "open" && (
                <MoneyActionPanel
                  context={{ action: "open-vote" }}
                  title={`Open the ${stageName} vote`}
                  sentence={`Stakeholders get ${windowDays} days to approve the ${money(amount)} payout for ${stageName}. Nothing moves until they do.`}
                  rows={[{ label: "Payout if approved", value: money(amount) }]}
                  walletShows="a transaction to open the vote, with no money moving"
                  prepare={() => prepareOpenMilestoneVote({ vaultAddress, milestoneId: m.id })}
                  successTitle={`The ${stageName} vote is open.`}
                  successBody={`Stakeholders have ${windowDays} days to vote.`}
                  onSuccess={afterAction}
                  onClose={close}
                />
              )}

              {/* ── Vote open ── */}
              {phase === "voting" && isStakeholder && !alreadyVoted && open !== "approve" && (
                <Button size="sm" onClick={() => setActive({ id: m.id, kind: "approve" })}>
                  <ThumbsUp className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  Approve this payout
                </Button>
              )}
              {open === "approve" && (
                <MoneyActionPanel
                  context={{ action: "vote" }}
                  title="Approve this payout"
                  sentence={`Approve the ${money(amount)} payout for ${stageName}? This is final; one vote per stakeholder. Not voting counts as no.`}
                  rows={[
                    { label: "Payout to the builder", value: money(amount) },
                    { label: "Your vote counts", value: money(myWeight) },
                    { label: "Leaves your wallet", value: "Nothing but the network fee" },
                  ]}
                  walletShows="your vote, with no money leaving your wallet"
                  prepare={() => prepareApproveMilestone({ vaultAddress, milestoneId: m.id })}
                  successTitle="Recorded on-chain. Your approval counts."
                  onSuccess={afterAction}
                  onClose={close}
                />
              )}
              {phase === "voting" && alreadyVoted && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  You voted yes. One vote per stakeholder; it can&apos;t be changed.
                </p>
              )}
              {phase === "voting" && !isStakeholder && (
                <p className="text-sm text-muted-foreground">
                  {user ? "Only stakeholders can vote." : "Sign in to see if you can vote."}
                </p>
              )}

              {/* ── Approved, not yet sent ── */}
              {phase === "passed" && (
                <p className="text-sm text-muted-foreground">
                  Stakeholders approved this payout. BLKFNDR sends it automatically, usually within
                  the hour, and nobody can hold it back. Anyone can also send it now.
                </p>
              )}
              {phase === "passed" && canTrigger && open !== "payout" && (
                <Button size="sm" onClick={() => setActive({ id: m.id, kind: "payout" })}>
                  Send the payout now
                </Button>
              )}
              {open === "payout" && (
                <MoneyActionPanel
                  context={{ action: "payout" }}
                  title="Send the approved payout"
                  sentence={`This sends ${money(amount)} from the vault to the builder, as the vote decided. Nothing leaves your wallet except a small network fee.`}
                  rows={[{ label: "From the vault to the builder", value: money(amount) }]}
                  walletShows={`a payout of ${exact(amount)} from the vault to the builder`}
                  prepare={() => prepareReleaseMilestone({ vaultAddress, milestoneId: m.id })}
                  successTitle={`${money(amount)} paid to the builder for ${stageName}.`}
                  onSuccess={afterAction}
                  onClose={close}
                />
              )}

              {/* ── Vote ended short, not yet recorded ── */}
              {phase === "lapsed" && (
                <p className="text-sm text-muted-foreground">
                  The vote closed without enough yes votes. Closing the stage opens refunds, with a
                  share of the builder&apos;s deposit. BLKFNDR does it automatically, usually within
                  the hour; anyone can also do it now, for a small network fee.
                </p>
              )}
              {phase === "lapsed" && canTrigger && open !== "close" && (
                <Button size="sm" variant="outline" onClick={() => setActive({ id: m.id, kind: "close" })}>
                  Close the stage and open refunds
                </Button>
              )}
              {open === "close" && (
                <MoneyActionPanel
                  context={{ action: "close" }}
                  title="Close the stage"
                  sentence={`This records on-chain that ${stageName} failed its vote. Refunds open for every stakeholder, with a share of the builder's deposit. Nothing leaves your wallet except a small network fee.`}
                  rows={[{ label: "Stage", value: stageName }]}
                  walletShows="a transaction to close the stage, with no money leaving your wallet"
                  prepare={() => prepareSettleLapsedMilestone({ vaultAddress, milestoneId: m.id })}
                  successTitle={`${stageName} is closed. Refunds are open.`}
                  onSuccess={afterAction}
                  onClose={close}
                />
              )}

              {phase === "unconfirmed" && (
                <p className="text-sm text-muted-foreground">
                  The vote has closed, but we couldn&apos;t confirm the result right now. {retry}
                </p>
              )}

              {phase === "released" && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                  Paid to the builder, as stakeholders voted.
                </p>
              )}

              {phase === "failed" && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                    This stage failed its vote. Stakeholders collect what&apos;s left in the vault,
                    plus a share of the builder&apos;s deposit.
                  </p>
                  {isStakeholder && onCollectRefund && (
                    <Button size="sm" onClick={onCollectRefund}>
                      Collect your refund
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
