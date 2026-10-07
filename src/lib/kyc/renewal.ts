/**
 * When an identity verification runs out, and when it can be renewed.
 *
 * A verification holds until the expiry of the document it was approved on
 * (kyc_requests.verified_until). From RENEWAL_WINDOW_DAYS before that date the
 * applicant may verify again with a current document, and is reminded to.
 * After it, the verification has lapsed.
 *
 * Shared by the browser and the server. Dates are compared as YYYY-MM-DD
 * strings in UTC, the database's current_date, so the app and the
 * kyc_requests update policy (20261007150000) agree on the day.
 */

/** Mirrors `current_date + 30` in the kyc_requests update policy. */
export const RENEWAL_WINDOW_DAYS = 30;

/**
 * current: nothing to do yet. due: within the window, renew before the date.
 * lapsed: the date has passed.
 */
export type RenewalState = "current" | "due" | "lapsed";

/** Today as YYYY-MM-DD in UTC. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last end date that is due for renewal today. */
export function renewalWindowEnd(now: Date = new Date()): string {
  return addDays(utcToday(now), RENEWAL_WINDOW_DAYS);
}

/** Where a verification stands, or null when it has no end date. */
export function renewalState(verifiedUntil: string | null | undefined, now: Date = new Date()): RenewalState | null {
  if (!verifiedUntil) return null;
  if (verifiedUntil < utcToday(now)) return "lapsed";
  return verifiedUntil <= renewalWindowEnd(now) ? "due" : "current";
}

/** "12 Mar 2027", for a YYYY-MM-DD date, without shifting it a day by time zone. */
export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
