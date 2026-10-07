import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { KYC_REVIEWER_ROLES } from "@/lib/supabase/auth";
import { emailColumns } from "@/lib/data/notifications";
import { formatDay, renewalState, renewalWindowEnd } from "@/lib/kyc/renewal";

/**
 * Identity verifications coming up for renewal, and ones that have lapsed.
 *
 * A verification holds until the expiry of the document it was approved on
 * (kyc_requests.verified_until, 20261007150000). Like the vote reminders, these
 * are found by a scan run every minute by the notification emails cron. Each
 * is claimed in notification_once before it is created, so it is produced once
 * per verification and date, even if the person dismisses it:
 *
 * - the applicant, once inside the renewal window: renew before the date;
 * - the applicant, once it has lapsed: verify again to open vaults;
 * - the KYC reviewers, once it has lapsed: revoke it, which takes it off the
 *   record and clears verified_until, so it is not found again.
 *
 * None while a renewal is under review. The reviewers already have it in
 * their queue, and the applicant has done what they can.
 */

const IDENTITY_PAGE = "/profile/kyc-attestation";
const IDENTITY_PANEL = "/admin?view=identity";

export interface KycRemindersResult {
  /** Reminders due this run, before the once-only check. */
  due: number;
  /** Notifications created this run. */
  created: number;
}

type Due = {
  key: string;
  to: "applicant" | "reviewers";
  userId: string;
  title: string;
  caption: string;
};

export async function queueKycExpiryReminders(
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<KycRemindersResult> {
  const now = options.now ?? new Date();
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("kyc_requests")
    .select("id, user_id, status, verified_until")
    .not("verified_until", "is", null)
    .lte("verified_until", renewalWindowEnd(now))
    .neq("status", "pending");
  if (error) throw new Error(`Could not list verifications due for renewal: ${error.message}`);

  const due: Due[] = [];
  for (const row of rows ?? []) {
    const until = row.verified_until as string;
    const state = renewalState(until, now);
    if (state === "due") {
      due.push({
        key: `kyc-renewal-due:${row.id}:${until}`,
        to: "applicant",
        userId: row.user_id,
        title: `Your ID expires on ${formatDay(until)}`,
        caption:
          "Your identity verification holds until then. Verify again with your current document before it runs out, so you can keep opening vaults.",
      });
    } else if (state === "lapsed") {
      due.push({
        key: `kyc-lapsed:${row.id}:${until}`,
        to: "applicant",
        userId: row.user_id,
        title: "Your identity verification has lapsed",
        caption: `Your ID expired on ${formatDay(until)}. Verify again with a current document to open vaults.`,
      });
      due.push({
        key: `kyc-lapsed-reviewers:${row.id}:${until}`,
        to: "reviewers",
        userId: row.user_id,
        title: "An identity verification has lapsed",
        caption: `The ID behind a verified wallet expired on ${formatDay(until)} and wasn't renewed. Revoke it from Approved Creators in Identity Verification.`,
      });
    }
  }
  if (options.dryRun || due.length === 0) return { due: due.length, created: 0 };

  // Claim each reminder. Only keys this run inserted come back, so one already
  // produced -- by an earlier run, or one running alongside -- is not produced
  // again.
  const { data: claimed, error: claimError } = await admin
    .from("notification_once")
    .upsert(
      due.map((d) => ({ key: d.key })),
      { onConflict: "key", ignoreDuplicates: true },
    )
    .select("key");
  if (claimError) throw new Error(`Could not claim identity reminders: ${claimError.message}`);
  const fresh = new Set((claimed ?? []).map((c) => String(c.key)));
  const toSend = due.filter((d) => fresh.has(d.key));
  if (toSend.length === 0) return { due: due.length, created: 0 };

  let reviewers: string[] = [];
  if (toSend.some((d) => d.to === "reviewers")) {
    const { data: admins, error: adminsError } = await admin
      .from("platform_admins")
      .select("user_id")
      .in("role", KYC_REVIEWER_ROLES)
      .not("user_id", "is", null);
    if (adminsError) console.error("[kyc-reminders] Could not list reviewers:", adminsError.message);
    reviewers = [...new Set((admins ?? []).flatMap((a) => (a.user_id ? [a.user_id] : [])))];
  }

  const notifications = toSend.flatMap((d) =>
    d.to === "applicant"
      ? [{ user_id: d.userId, title: d.title, caption: d.caption, url: IDENTITY_PAGE, ...emailColumns("account") }]
      : reviewers.map((id) => ({ user_id: id, title: d.title, caption: d.caption, url: IDENTITY_PANEL, ...emailColumns("reviews") })),
  );
  if (notifications.length === 0) return { due: due.length, created: 0 };

  const { error: insertError } = await admin.from("notifications").insert(notifications);
  if (insertError) {
    // The claims stand, so these reminders are lost rather than sent twice.
    console.error("[kyc-reminders] Could not create reminders:", insertError.message);
    return { due: due.length, created: 0 };
  }
  return { due: due.length, created: notifications.length };
}
