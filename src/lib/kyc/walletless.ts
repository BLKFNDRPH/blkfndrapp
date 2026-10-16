/**
 * How long an approval given before the applicant had a wallet may wait for one.
 *
 * Such an approval keeps the ID number, date of birth, address and email,
 * because attaching the wallet recomputes the details hash from them together
 * with the wallet's address (20261007134943). Attaching clears them. Without a
 * limit, an applicant who never set up a wallet left them on file until their
 * ID expired, years later. So the applicant is reminded twice, and after
 * WALLETLESS_APPROVAL_DAYS the approval ends: the check is turned down with
 * WALLETLESS_EXPIRED_REASON, which deletes the details, and they submit again.
 *
 * The clock starts at the approval. Nothing else updates an approved check
 * that has no wallet (a renewal needs one on file), so its updated_at is the
 * moment it was approved.
 *
 * Shared by the browser and the server; pure, so `npm test` runs it.
 */

export const WALLETLESS_APPROVAL_DAYS = 30;

/** Days after the approval when the applicant is reminded, earliest first. */
export const WALLETLESS_REMINDER_DAYS = [7, 25] as const;

/** The rejection reason an expired walletless approval carries, so pages can tell it from a refused document. */
export const WALLETLESS_EXPIRED_REASON = `No wallet was attached within ${WALLETLESS_APPROVAL_DAYS} days of the approval, so your details were deleted`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the wallet must be attached by. */
export function walletDeadline(approvedAt: string | Date): Date {
  return new Date(new Date(approvedAt).getTime() + WALLETLESS_APPROVAL_DAYS * DAY_MS);
}

export type WalletlessStage =
  | { stage: "waiting" }
  /** The latest reminder now due, and the whole days left. */
  | { stage: "remind"; day: (typeof WALLETLESS_REMINDER_DAYS)[number]; daysLeft: number }
  | { stage: "expired" };

/** Where a walletless approval stands, `now` after it was given. */
export function walletlessStage(approvedAt: string | Date, now: Date = new Date()): WalletlessStage {
  const age = now.getTime() - new Date(approvedAt).getTime();
  if (age >= WALLETLESS_APPROVAL_DAYS * DAY_MS) return { stage: "expired" };
  const due = [...WALLETLESS_REMINDER_DAYS].reverse().find((d) => age >= d * DAY_MS);
  if (due === undefined) return { stage: "waiting" };
  return { stage: "remind", day: due, daysLeft: Math.ceil((walletDeadline(approvedAt).getTime() - now.getTime()) / DAY_MS) };
}
