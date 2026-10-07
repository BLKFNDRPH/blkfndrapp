/**
 * Which emails a notification belongs to. Shared by the server, which tags
 * each notification, and the settings card, which shows a switch for each one
 * a person can turn off.
 *
 * "account" has no switch: those are about the person's own account, and they
 * started each one (an identity check, a link they asked to be sent).
 */
export const EMAIL_SWITCHES = ["votes", "refunds", "updates", "reviews"] as const;

export type EmailSwitch = (typeof EMAIL_SWITCHES)[number];
export type EmailCategory = EmailSwitch | "account";

export type EmailPreferences = Record<EmailSwitch, boolean>;

export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  votes: true,
  refunds: true,
  updates: true,
  reviews: true,
};

export function isEmailSwitch(value: unknown): value is EmailSwitch {
  return typeof value === "string" && (EMAIL_SWITCHES as readonly string[]).includes(value);
}

/** What each switch covers, worded for the person turning it off. */
export const EMAIL_SWITCH_COPY: Record<
  EmailSwitch,
  { label: string; detail: string; stopTitle: string; unsubscribed: string }
> = {
  votes: {
    label: "Email me when a vote needs me",
    detail: "When a vote opens in a vault you hold a stake in, and a day before it closes if you haven't voted.",
    stopTitle: "Stop emails about votes?",
    unsubscribed: "You won't get emails about votes any more.",
  },
  refunds: {
    label: "Email me when a refund is ready",
    detail: "When a vault you staked in closes and your money can come back to you.",
    stopTitle: "Stop emails about refunds?",
    unsubscribed: "You won't get emails about refunds any more.",
  },
  updates: {
    label: "Email me receipts",
    detail: "When a vault you're part of reaches its goal or pays a stage, and, if you run one, each new stake and payment.",
    stopTitle: "Stop receipts by email?",
    unsubscribed: "You won't get receipts by email any more.",
  },
  reviews: {
    label: "Email me when something is waiting for review",
    detail: "When a new identity check or other work for your admin role comes in.",
    stopTitle: "Stop emails about reviews?",
    unsubscribed: "You won't get emails about reviews any more.",
  },
};
