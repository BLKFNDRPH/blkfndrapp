/**
 * Plain words for where a project stands.
 *
 * The vault contract has six states and the listing table a few more; none of
 * their names tell a person what they can do. "Failed" reads as a site error,
 * "Pending Approval" implies a platform gate that does not exist, "Refunding"
 * is a verb nobody uses. Every surface that shows a status pill, a legend or a
 * disabled-button reason reads it from here, so the words are the same on the
 * card, the project page and the profile.
 *
 * The vault's two refund states mean different things: `failed` is a vault
 * whose deadline passed short of its goal (every stake comes back whole), and
 * `refunding` is one whose stage failed its vote or whose builder went quiet
 * (stakeholders share what is left plus the builder's deposit).
 *
 * Pure functions, no React, safe on the server.
 */

import type { Project } from "./types";

export type StatusTone =
  | "open" // you can stake now
  | "waiting" // nothing to do yet
  | "progress" // the builder is at work
  | "done"
  | "returning" // money is coming back
  | "closed"
  | "muted" // unlisted, not listed
  | "paused"; // paused by the platform

export type StatusView = {
  /** Stable key for tests and class names. */
  key: string;
  /** The pill text: "Open for stakes". */
  label: string;
  /** One sentence for the tooltip: what this means and what you can do. */
  tooltip: string;
  tone: StatusTone;
};

export type SecondaryBadge = {
  key: "featured" | "reviewed";
  label: string;
  tooltip: string;
};

type StatusInput = Pick<
  Project,
  "status" | "restriction" | "fundingDeadline" | "currentFunding" | "fundingGoal"
>;

const OPEN: StatusView = {
  key: "open",
  label: "Open for stakes",
  tooltip: "You can stake now.",
  tone: "open",
};

const AWAITING_DEPOSIT: StatusView = {
  key: "awaiting-deposit",
  label: "Awaiting builder's deposit",
  tooltip:
    "The builder hasn't yet locked the deposit that opens the vault. You can read, not stake.",
  tone: "waiting",
};

const GOAL_REACHED: StatusView = {
  key: "goal-reached",
  label: "Goal reached",
  tooltip: "No more stakes are needed. The builder is starting.",
  tone: "progress",
};

const BUILDING: StatusView = {
  key: "building",
  label: "Building",
  tooltip: "The builder is working. Each payout happens by a stakeholder vote.",
  tone: "progress",
};

const COMPLETED: StatusView = {
  key: "completed",
  label: "Completed",
  tooltip: "Every stage was approved and paid to the builder.",
  tone: "done",
};

const RETURNING_MONEY: StatusView = {
  key: "returning-money",
  label: "Returning money",
  tooltip:
    "A stage failed its vote. Stakeholders are getting their money and a share of the builder's deposit back.",
  tone: "returning",
};

const GOAL_NOT_REACHED: StatusView = {
  key: "goal-not-reached",
  label: "Closed, goal not reached",
  tooltip: "The deadline passed before the goal. Every stake can be collected back in full.",
  tone: "closed",
};

const DEADLINE_PASSED: StatusView = {
  key: "deadline-passed",
  label: "Deadline passed",
  tooltip:
    "The vault is closing to new stakes. If the goal wasn't reached, every stake can be collected back.",
  tone: "closed",
};

const UNLISTED: StatusView = {
  key: "unlisted",
  label: "Unlisted",
  tooltip: "Only its builder, its stakeholders and BLKFNDR staff can open it.",
  tone: "muted",
};

const NOT_LISTED: StatusView = {
  key: "not-listed",
  label: "Not listed",
  tooltip: "This listing isn't shown on BLKFNDR. The vault's rules still apply to it.",
  tone: "muted",
};

const PAUSED: StatusView = {
  key: "paused",
  label: "Paused by BLKFNDR",
  tooltip:
    "New stakes are paused while BLKFNDR reviews the listing. Refunds and votes still work.",
  tone: "paused",
};

/** The one status pill a project shows. */
export function describeStatus(project: StatusInput, now: number = Date.now()): StatusView {
  if (project.restriction?.locked) return PAUSED;
  if (project.restriction?.hidden) return UNLISTED;

  const goalReached =
    Number.isFinite(project.fundingGoal) &&
    project.fundingGoal > 0 &&
    project.currentFunding >= project.fundingGoal;
  const deadlinePassed =
    typeof project.fundingDeadline === "number" &&
    project.fundingDeadline > 0 &&
    project.fundingDeadline <= now;

  switch (project.status) {
    case "raising":
    case "approved":
    case "featured":
      if (deadlinePassed) return goalReached ? GOAL_REACHED : DEADLINE_PASSED;
      return OPEN;
    case "pending":
      return AWAITING_DEPOSIT;
    case "funded":
      return GOAL_REACHED;
    case "active":
      return BUILDING;
    case "completed":
      return COMPLETED;
    case "failed":
    case "expired":
      return GOAL_NOT_REACHED;
    case "refunding":
      return RETURNING_MONEY;
    case "hidden":
      return UNLISTED;
    case "rejected":
      return NOT_LISTED;
    default:
      return OPEN;
  }
}

/** Badges that sit beside the status pill, never instead of it. */
export function secondaryBadges(
  project: Pick<Project, "status" | "featured">,
): SecondaryBadge[] {
  const badges: SecondaryBadge[] = [];
  if (project.featured || project.status === "featured") {
    badges.push({
      key: "featured",
      label: "Featured",
      tooltip:
        "Picked by BLKFNDR to show on the home page. Not a judgement on the project's chances.",
    });
  }
  if (project.status === "approved") {
    badges.push({
      key: "reviewed",
      label: "Reviewed",
      tooltip:
        "A BLKFNDR reviewer checked that the listing is complete and the builder's identity is verified. The vault rules apply either way.",
    });
  }
  return badges;
}

/** Every pill a visitor can meet, for the "What do the labels mean?" legend. */
export const STATUS_LEGEND: StatusView[] = [
  OPEN,
  AWAITING_DEPOSIT,
  GOAL_REACHED,
  BUILDING,
  COMPLETED,
  RETURNING_MONEY,
  GOAL_NOT_REACHED,
  UNLISTED,
  PAUSED,
];

export const LEGEND_CLOSING_LINE =
  "Whatever the label, money only ever leaves a vault by a stakeholder vote or a refund.";

/** True while a visitor could still stake, from the listing's point of view. */
export function isOpenForStakes(project: StatusInput, now: number = Date.now()): boolean {
  return describeStatus(project, now).key === "open";
}

/** "12 days left", "Ends today", or "Deadline passed". */
export function describeDeadline(
  deadlineMs: number | undefined | null,
  now: number = Date.now(),
): { label: string; passed: boolean } | null {
  if (!deadlineMs || !Number.isFinite(deadlineMs)) return null;
  const remaining = deadlineMs - now;
  if (remaining <= 0) return { label: "Deadline passed", passed: true };
  const days = Math.floor(remaining / 86_400_000);
  // A deadline decades away is a placeholder or a unit mistake in the listing,
  // not something to count down to; "2,912,107 days left" helps nobody.
  if (days > 3650) return null;
  if (days >= 1) return { label: `${days} ${days === 1 ? "day" : "days"} left`, passed: false };
  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 1) return { label: `${hours} ${hours === 1 ? "hour" : "hours"} left`, passed: false };
  return { label: "Ends today", passed: false };
}

/** Tailwind classes per tone, so every pill looks the same everywhere. */
export const TONE_CLASSES: Record<StatusTone, string> = {
  open: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  waiting: "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300",
  progress: "bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300",
  done: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  returning: "bg-amber-500/15 text-amber-800 border-amber-500/30 dark:text-amber-300",
  closed: "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300",
  muted: "bg-neutral-500/15 text-neutral-700 border-neutral-500/30 dark:text-neutral-300",
  paused: "bg-amber-500/15 text-amber-800 border-amber-500/30 dark:text-amber-300",
};
