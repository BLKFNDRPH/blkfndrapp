/**
 * Every money-action failure, in words a person can act on.
 *
 * A stake, a vote, a payout or a refund can fail in the wallet, at the vault,
 * in the token contract, on the way to the network or on the ledger itself.
 * The raw messages ("HostError: Error(Contract, #24)", a JSON dump of a send
 * response, a wallet's own error envelope) used to reach the screen as they
 * were. This turns each one into an outcome that says what happened, whether
 * money moved, and the one thing to do next. The raw text is kept, labelled,
 * for "Details for support".
 *
 * Contract error numbers only mean something next to the contract that raised
 * them: #13 is MilestoneNotFound in the vault but TrustlineMissing in a token
 * contract. So a number is only read through the list of codes the given
 * action can actually hit, and token-contract failures are recognised by the
 * host's diagnostic text first.
 *
 * Pure: no React, no network. Safe to unit-test with plain strings.
 */

export type MoneyAction =
  | "stake"
  | "vote"
  | "open-vote"
  | "payout"
  | "close"
  | "close-vault"
  | "refund"
  | "enable-dollars"
  | "activate";

export type OutcomeKind =
  | "declined"
  | "expired"
  | "wrong-account"
  | "no-wallet"
  | "paused"
  | "below-minimum"
  | "over-remaining"
  | "goal-reached"
  | "deadline-passed"
  | "not-open"
  | "not-enough-money"
  | "no-trustline"
  | "no-account"
  | "not-enough-xlm"
  | "storage-renewal"
  | "network"
  | "network-busy"
  | "rejected"
  | "failed-on-ledger"
  | "sent-unconfirmed"
  | "already-voted"
  | "not-a-stakeholder"
  | "vote-not-open"
  | "vote-closed"
  | "nothing-to-refund"
  | "already-paid"
  | "not-carried"
  | "too-early"
  | "unknown";

/** What a button on an outcome card does. The sheet that shows it decides how. */
export type OutcomeIntent =
  | "retry"
  | "close"
  | "edit-amount"
  | "stake-remainder"
  | "fix-wallet"
  | "check-activity"
  | "public-record";

export interface OutcomeButton {
  label: string;
  intent: OutcomeIntent;
}

export interface Outcome {
  kind: OutcomeKind;
  /** A noun naming the outcome: "Stake not sent", never "<action> failed". */
  title: string;
  /** What happened and what to do, in one or two sentences. */
  body: string;
  /** Always says whether money moved. */
  moneyLine: string;
  /** Grey for a choice the person made, red only for a true failure. */
  tone: "neutral" | "error";
  primary: OutcomeButton;
  secondary?: OutcomeButton;
  /** The raw error, for "Details for support". Never shown in the body. */
  technical: string;
}

export interface ExplainContext {
  action: MoneyAction;
  /** "$5" or "34 XLM", for the minimum-stake sentence. */
  minimum?: string;
  /** "$12.40", what is left before the goal, for an over-the-goal stake. */
  remaining?: string;
  /** True when the remaining amount can itself be staked (it is at least the minimum). */
  remainingStakeable?: boolean;
  /** "14 Mar", the vault's deadline, for a closed vault. */
  deadline?: string;
}

// ─── Wording shared by every outcome ─────────────────────────────────────────

export const NOTHING_MOVED = "Nothing left your wallet.";
const ONLY_FEE =
  "Your funds didn't leave your wallet. Only the network fee, a few cents of XLM at most, was charged.";
const MAYBE_MOVED =
  "The transaction may have gone through. Check your activity before trying again, so nothing is sent twice.";

const NOUN: Record<MoneyAction, string> = {
  stake: "Stake",
  vote: "Vote",
  "open-vote": "Vote request",
  payout: "Payout",
  close: "Stage close",
  "close-vault": "Vault close",
  refund: "Refund",
  "enable-dollars": "Trustline",
  activate: "Wallet",
};

/** "Stake not sent", "Vote not sent", "Trustline not added", "Wallet not activated". */
function notDone(action: MoneyAction): string {
  if (action === "enable-dollars") return "Trustline not added";
  if (action === "activate") return "Wallet not activated";
  return `${NOUN[action]} not sent`;
}

const RETRY: OutcomeButton = { label: "Try again", intent: "retry" };
const CLOSE: OutcomeButton = { label: "Close", intent: "close" };
const FIX_WALLET: OutcomeButton = { label: "Get your wallet ready", intent: "fix-wallet" };
const EDIT: OutcomeButton = { label: "Change the amount", intent: "edit-amount" };

// ─── Recognising the raw error ───────────────────────────────────────────────

function textOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

/** The number in "Error(Contract, #24)", or null. */
export function contractErrorCode(text: string): number | null {
  const match = /Error\(Contract, #(\d+)\)/.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * Vault error codes, from contracts/blkfndr-vault/src/lib.rs, and the token
 * contract (Stellar Asset Contract) codes a stake's transfer can raise. Which
 * table a number is read from depends on the action.
 */
const VAULT = {
  NotAuthorized: 1,
  InvalidStatus: 2,
  GoalAlreadyReached: 5,
  FundingDeadlinePassed: 7,
  NoFundsToRefund: 9,
  MilestoneNotFound: 13,
  MilestoneAlreadyReleased: 14,
  VotingNotOpen: 15,
  VotingAlreadyOpen: 16,
  VotingClosed: 17,
  AlreadyVoted: 18,
  NotAContributor: 19,
  ThresholdNotMet: 20,
  ThresholdMet: 21,
  VotingWindowNotElapsed: 22,
  MilestoneFailed: 23,
  BelowMinimumContribution: 24,
  NotStalled: 25,
} as const;

const TOKEN = {
  AccountMissing: 6,
  Balance: 10,
  BalanceDeauthorized: 11,
  TrustlineMissing: 13,
} as const;

/** Codes each action can meet, by the contract that raises them. */
const VAULT_CODES: Record<MoneyAction, number[]> = {
  stake: [
    VAULT.InvalidStatus,
    VAULT.GoalAlreadyReached,
    VAULT.FundingDeadlinePassed,
    VAULT.BelowMinimumContribution,
  ],
  vote: [
    VAULT.InvalidStatus,
    VAULT.MilestoneNotFound,
    VAULT.MilestoneAlreadyReleased,
    VAULT.VotingNotOpen,
    VAULT.VotingClosed,
    VAULT.AlreadyVoted,
    VAULT.NotAContributor,
    VAULT.MilestoneFailed,
  ],
  "open-vote": [
    VAULT.InvalidStatus,
    VAULT.MilestoneNotFound,
    VAULT.MilestoneAlreadyReleased,
    VAULT.MilestoneFailed,
    VAULT.VotingAlreadyOpen,
  ],
  payout: [
    VAULT.InvalidStatus,
    VAULT.MilestoneNotFound,
    VAULT.MilestoneAlreadyReleased,
    VAULT.VotingNotOpen,
    VAULT.ThresholdNotMet,
    VAULT.MilestoneFailed,
  ],
  "close-vault": [VAULT.InvalidStatus],
  close: [
    VAULT.InvalidStatus,
    VAULT.MilestoneNotFound,
    VAULT.MilestoneAlreadyReleased,
    VAULT.ThresholdMet,
    VAULT.VotingWindowNotElapsed,
    VAULT.MilestoneFailed,
    VAULT.NotStalled,
  ],
  refund: [VAULT.InvalidStatus, VAULT.NoFundsToRefund, VAULT.NotAContributor],
  "enable-dollars": [],
  activate: [],
};

/** Only a stake moves a token from the person's wallet inside the call. */
const TOKEN_CODES: Record<MoneyAction, number[]> = {
  stake: [TOKEN.AccountMissing, TOKEN.Balance, TOKEN.BalanceDeauthorized, TOKEN.TrustlineMissing],
  vote: [],
  "open-vote": [],
  payout: [],
  close: [],
  "close-vault": [],
  // A refund pays the stakeholder's own wallet, which must be able to hold it.
  refund: [TOKEN.TrustlineMissing],
  "enable-dollars": [],
  activate: [],
};

// ─── The table ───────────────────────────────────────────────────────────────

function outcome(
  kind: OutcomeKind,
  ctx: ExplainContext,
  technical: string,
  fields: Partial<Omit<Outcome, "kind" | "technical">> & { body: string },
): Outcome {
  return {
    kind,
    title: fields.title ?? notDone(ctx.action),
    body: fields.body,
    moneyLine: fields.moneyLine ?? NOTHING_MOVED,
    tone: fields.tone ?? "error",
    primary: fields.primary ?? RETRY,
    secondary: fields.secondary ?? CLOSE,
    technical,
  };
}

function fromVaultCode(code: number, ctx: ExplainContext, technical: string): Outcome | null {
  if (!VAULT_CODES[ctx.action].includes(code)) return null;
  const minimum = ctx.minimum ?? "the minimum";

  switch (code) {
    case VAULT.BelowMinimumContribution:
      return outcome("below-minimum", ctx, technical, {
        body: `The minimum stake is ${minimum}.`,
        primary: EDIT,
        tone: "neutral",
      });
    case VAULT.GoalAlreadyReached:
      return ctx.remaining && ctx.remainingStakeable
        ? outcome("over-remaining", ctx, technical, {
            body: `The goal is almost reached. Only ${ctx.remaining} is still open.`,
            primary: { label: `Stake ${ctx.remaining}`, intent: "stake-remainder" },
            secondary: EDIT,
            tone: "neutral",
          })
        : outcome("goal-reached", ctx, technical, {
            body: "The goal was reached a moment ago, so no more stakes are needed.",
            primary: CLOSE,
            secondary: undefined,
            tone: "neutral",
          });
    case VAULT.FundingDeadlinePassed:
      return outcome("deadline-passed", ctx, technical, {
        body: ctx.deadline
          ? `This vault closed to new stakes on ${ctx.deadline}.`
          : "This vault's deadline has passed, so it no longer takes stakes.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.InvalidStatus:
      return outcome("not-open", ctx, technical, {
        body:
          ctx.action === "stake"
            ? "This vault isn't open for stakes right now."
            : ctx.action === "refund"
              ? "This vault isn't returning money right now."
              : "The vault isn't at the point where this can happen yet.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.NoFundsToRefund:
      return outcome("nothing-to-refund", ctx, technical, {
        title: "Nothing to collect",
        body: "This money already came back to you.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.NotAContributor:
      return outcome("not-a-stakeholder", ctx, technical, {
        body: "This wallet doesn't hold a stake in this vault. If you staked from another wallet, switch to it and try again.",
        primary: { label: "Check your wallet", intent: "fix-wallet" },
        tone: "neutral",
      });
    case VAULT.AlreadyVoted:
      return outcome("already-voted", ctx, technical, {
        title: "Vote already counted",
        body: "You've already voted on this stage. One vote per stakeholder.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.VotingAlreadyOpen:
      return outcome("vote-not-open", ctx, technical, {
        body: "This stage's vote is already open.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.VotingNotOpen:
      return outcome("vote-not-open", ctx, technical, {
        body: "This stage isn't open for a vote yet.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.VotingClosed:
      return outcome("vote-closed", ctx, technical, {
        body: "The 7-day vote on this stage has closed.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.MilestoneAlreadyReleased:
      return outcome("already-paid", ctx, technical, {
        title: "Already paid",
        body: "This stage was already paid to the builder.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.MilestoneFailed:
      return outcome("vote-closed", ctx, technical, {
        body: "This stage failed its vote, so refunds are open instead.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.ThresholdNotMet:
      return outcome("not-carried", ctx, technical, {
        body: "This stage doesn't have enough yes votes yet to be paid out.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.ThresholdMet:
      return outcome("not-carried", ctx, technical, {
        body: "This stage was approved, so it can't be closed as failed.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.VotingWindowNotElapsed:
    case VAULT.NotStalled:
      return outcome("too-early", ctx, technical, {
        body: "It's too early for this. The vault's waiting period hasn't ended yet.",
        primary: CLOSE,
        secondary: undefined,
        tone: "neutral",
      });
    case VAULT.MilestoneNotFound:
      return outcome("unknown", ctx, technical, {
        body: "We couldn't find that stage in the vault. Reload the page and try again.",
      });
    default:
      return null;
  }
}

function fromTokenCode(code: number, ctx: ExplainContext, technical: string): Outcome | null {
  if (!TOKEN_CODES[ctx.action].includes(code)) return null;
  switch (code) {
    case TOKEN.TrustlineMissing:
      return outcome("no-trustline", ctx, technical, {
        body: "Your wallet has no USDC trustline yet. Add the trustline, then try again.",
        primary: FIX_WALLET,
        tone: "neutral",
      });
    case TOKEN.AccountMissing:
      return outcome("no-account", ctx, technical, {
        body: "Your wallet's Stellar account isn't activated yet: it needs its first XLM to exist on the ledger. Activate it, then try again.",
        primary: FIX_WALLET,
        tone: "neutral",
      });
    case TOKEN.Balance:
      return outcome("not-enough-money", ctx, technical, {
        body: "Your wallet doesn't hold enough for this stake.",
        primary: FIX_WALLET,
        secondary: EDIT,
        tone: "neutral",
      });
    case TOKEN.BalanceDeauthorized:
      return outcome("not-enough-money", ctx, technical, {
        body: "The USDC issuer has frozen this asset in your wallet (trustline deauthorized), so it can't be staked.",
        primary: CLOSE,
        secondary: undefined,
      });
    default:
      return null;
  }
}

/**
 * Turn any failure from a money action into an outcome card.
 *
 * Order matters: the person's own decisions first (declined, timed out, wrong
 * account), then what the network said about the transaction as a whole, then
 * the token contract's diagnostic text, then contract error numbers read
 * through the action's own list.
 */
export function explainError(error: unknown, ctx: ExplainContext): Outcome {
  const technical = textOf(error);
  const name = nameOf(error);
  const text = technical;

  // The platform declined to build it: a listing pause, not the vault.
  if (name === "PlatformLockError") {
    return outcome("paused", ctx, technical, {
      title: `${NOUN[ctx.action]} paused`,
      body: "BLKFNDR paused new stakes in this listing. Votes already open and refunds still work; the vault contract itself has no pause.",
      primary: CLOSE,
      secondary: undefined,
      tone: "neutral",
    });
  }

  // The wallet answered without a signature.
  if (name === "FreighterDeclined") {
    if (/timed out|didn't (confirm|sign)/i.test(text)) {
      return outcome("expired", ctx, technical, {
        title: "Request timed out",
        body: "The signature request timed out after 5 minutes. If a Freighter window is still open, close it; signing it now does nothing.",
        tone: "neutral",
      });
    }
    return outcome("declined", ctx, technical, {
      title: "Not signed",
      body: "You rejected the signature request in your wallet.",
      moneyLine: "Nothing was moved or charged.",
      tone: "neutral",
    });
  }

  if (/different account than the one linked/i.test(text)) {
    return outcome("wrong-account", ctx, technical, {
      title: "Different account",
      body: "Your wallet signed with a different address than the one linked here. Switch accounts in Freighter and try again.",
      primary: RETRY,
      secondary: { label: "Manage wallet", intent: "fix-wallet" },
      tone: "neutral",
    });
  }

  if (/Connect your (Freighter )?wallet first|No wallet connected/i.test(text)) {
    return outcome("no-wallet", ctx, technical, {
      title: "Wallet needed",
      body: "Set up your wallet to continue.",
      primary: { label: "Set up your wallet", intent: "fix-wallet" },
      tone: "neutral",
    });
  }

  // The wallet's account has never received anything, so the network has no
  // record of it and nothing can be sent from it.
  if (/Account not found/i.test(text)) {
    return outcome("no-account", ctx, technical, {
      body: "Your wallet's Stellar account isn't activated yet: it needs its first XLM to exist on the ledger. Activate it, then try again.",
      primary: FIX_WALLET,
      tone: "neutral",
    });
  }

  // Archived contract storage: the SDK refuses to build until it is renewed.
  if (name === "ExpiredStateError" || /restore some contract state/i.test(text)) {
    return outcome("storage-renewal", ctx, technical, {
      body: "The vault contract's storage TTL expired and needs restoring, which BLKFNDR does automatically every day. Try again in a few minutes.",
    });
  }

  // Sent, and the network has not said yet.
  if (name === "TransactionStillPending" || /for transaction to complete, but it did not/i.test(text)) {
    return outcome("sent-unconfirmed", ctx, technical, {
      title: `${NOUN[ctx.action]} sent, not yet confirmed`,
      body: "The transaction was submitted, but the ledger hasn't confirmed it yet. Don't try again right away.",
      moneyLine: MAYBE_MOVED,
      primary: { label: "Check my activity", intent: "check-activity" },
      secondary: { label: "Look it up on Stellar Expert", intent: "public-record" },
      tone: "neutral",
    });
  }

  // Included in a ledger and failed there: the fee was charged.
  if (name === "LedgerFailedError") {
    return outcome("failed-on-ledger", ctx, technical, {
      body: "The transaction failed on the ledger.",
      moneyLine: ONLY_FEE,
      primary: RETRY,
      secondary: { label: "Look it up on Stellar Expert", intent: "public-record" },
    });
  }

  // Signed, but held back past the transaction's own five-minute validity.
  if (/txTooLate|tx_too_late/i.test(text)) {
    return outcome("expired", ctx, technical, {
      title: "Request expired",
      body: "The signed transaction expired before it reached the network (it's valid for 5 minutes), so the network rejected it. Try again.",
      tone: "neutral",
    });
  }

  // The fee itself: not enough XLM in the wallet to pay it or keep the
  // network's minimum balance.
  if (/txInsufficientBalance|tx_insufficient_balance|op_low_reserve|txInsufficientFee/i.test(text)) {
    return outcome("not-enough-xlm", ctx, technical, {
      body: "Your wallet needs a little more XLM, Stellar's native asset, to pay the network fee and keep its minimum balance.",
      primary: FIX_WALLET,
      tone: "neutral",
    });
  }

  if (/TRY_AGAIN_LATER/i.test(text)) {
    return outcome("network-busy", ctx, technical, {
      body: "The network is busy. Try again in a minute.",
      tone: "neutral",
    });
  }

  // Token contract failures, recognised by the host's own words.
  if (TOKEN_CODES[ctx.action].length > 0) {
    if (/trustline entry is missing/i.test(text)) {
      return fromTokenCode(TOKEN.TrustlineMissing, ctx, technical)!;
    }
    if (/account entry is missing/i.test(text)) {
      return fromTokenCode(TOKEN.AccountMissing, ctx, technical)!;
    }
    if (/balance is not sufficient|resulting balance is not within the allowed range/i.test(text)) {
      return fromTokenCode(TOKEN.Balance, ctx, technical)!;
    }
  }

  const code = contractErrorCode(text);
  if (code !== null) {
    const fromVault = fromVaultCode(code, ctx, technical);
    if (fromVault) return fromVault;
    const fromToken = fromTokenCode(code, ctx, technical);
    if (fromToken) return fromToken;
  }

  // The network refused the transaction without running it.
  if (name === "SendFailedError" || /Sending the transaction to the network failed/i.test(text)) {
    return outcome("rejected", ctx, technical, {
      body: "The network rejected the transaction without running it. Try again in a moment.",
    });
  }

  if (/Failed to fetch|NetworkError|network error|ECONNREFUSED|ETIMEDOUT|socket hang up|status code 50[234]/i.test(text)) {
    return outcome("network", ctx, technical, {
      body: "We couldn't reach the Stellar network. Check your connection and try again.",
      tone: "neutral",
    });
  }

  // The wallet's own errors arrive already worded by freighter-signer.
  if (/^Error: Your wallet /.test(text)) {
    const body = text
      .replace(/^Error: /, "")
      .replace(/\s*Nothing was moved or charged\.?/i, "")
      .replace(/\s*\(Technical details:.*\)\s*$/s, "")
      .trim();
    return outcome("unknown", ctx, technical, { body, tone: "neutral" });
  }

  return outcome("unknown", ctx, technical, {
    body: "Something went wrong on our side. Try again in a moment.",
  });
}

/** Thrown when a transaction was included in a ledger and failed there. */
export class LedgerFailedError extends Error {
  hash: string | null;
  constructor(hash: string | null, status: string | undefined) {
    super(`The transaction ${hash ?? "(no hash)"} finished with status ${status ?? "unknown"}.`);
    this.name = "LedgerFailedError";
    this.hash = hash;
  }
}
