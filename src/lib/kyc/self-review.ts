/**
 * Separation of duties for identity checks: a reviewer never decides, attests
 * or revokes their own. A KYC reviewer is also an ordinary user who can file
 * a check, and an approval is what lets an account open a vault, so without
 * this one person could clear themselves.
 *
 * Shared by the server and the tests; pure, so `npm test` runs it.
 */

export const SELF_REVIEW_MESSAGE =
  "You can't review your own identity check. Another reviewer has to decide it.";

/** The audit-log action recorded when a reviewer tries anyway. */
export const SELF_REVIEW_AUDIT_ACTION = "kyc.self_review_refused";

/**
 * Whether the reviewer is the applicant. A check with no applicant on it is
 * nobody's own, and an empty id never matches, so a missing value cannot
 * read as a match.
 */
export function isSelfReview(reviewerId: string, applicantId: string | null | undefined): boolean {
  return reviewerId !== "" && reviewerId === applicantId;
}
