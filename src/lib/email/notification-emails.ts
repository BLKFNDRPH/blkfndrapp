import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { getSecret } from "@/lib/secrets";
import { allowedOrigins } from "@/lib/auth/app-origin";
import { projectHref } from "@/lib/project-href";
import { IS_PRACTICE_NETWORK } from "@/lib/network";
import { preferencesFor } from "@/lib/data/email-preferences";
import { renderNotificationEmail } from "@/lib/email/render";
import { isEmailSwitch, type EmailCategory } from "@/lib/email/categories";

/**
 * Sends the notifications queued for email, through Resend.
 *
 * A notification is queued by whoever creates it (email_status 'pending'), and
 * this works through the queue, oldest first, once a minute from the
 * notification-emails cron. For each one it checks the person's switch for
 * that kind of email and that their address is confirmed, then sends.
 *
 * - Each send carries the notification id as Resend's idempotency key, so a
 *   retry, or two runs overlapping, can't send the same email twice.
 * - A temporary failure stays pending and is tried again on the next run, up to
 *   MAX_ATTEMPTS; a refusal that won't change on retry fails it at once.
 * - A key Resend refuses, an unverified sending domain or a used-up quota stops
 *   the run without charging anyone's attempts, since every send would fail the
 *   same way.
 * - Nothing older than FRESH_FOR is sent. A queue that built up while email was
 *   off, or Resend was down, is marked skipped rather than sent late in a burst.
 *
 * With no Resend key set, nothing is sent and the bell is unaffected.
 */

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "BLKFNDR <notifications@blkfndr.com>";
const MAX_PER_RUN = 50;
const MAX_ATTEMPTS = 5;
const FRESH_FOR_MS = 24 * 60 * 60 * 1000;
/** Resend allows 10 requests a second per team; this stays well under. */
const GAP_MS = 150;

export interface NotificationEmailsResult {
  status: "done" | "skipped" | "stopped";
  detail: string;
  sent: number;
  /** Not emailed by choice or circumstance: switch off, no confirmed address. */
  skipped: number;
  failed: number;
  /** Left pending for the next run. */
  retrying: number;
  /** Pending for more than a day, marked skipped this run. */
  expired: number;
  /** In a dry run, what would have been sent. */
  wouldSend?: Array<{ id: string; to: string; subject: string; category: EmailCategory }>;
}

type PendingRow = {
  id: string;
  user_id: string;
  title: string;
  caption: string;
  url: string | null;
  email_category: EmailCategory;
  email_attempts: number;
  created_at: string;
  projects: { project_id: string } | null;
};

type SendOutcome =
  | { kind: "sent"; id: string }
  | { kind: "retry"; error: string }
  | { kind: "failed"; error: string }
  | { kind: "stop"; error: string };

/** Where a notification leads, as an absolute link on this site. */
function linkFor(row: PendingRow, origin: string): string {
  if (row.url) {
    // Stored links are paths on this site. Anything else is not followed.
    if (row.url.startsWith("/") && !row.url.startsWith("//")) return `${origin}${row.url}`;
    try {
      if (new URL(row.url).origin === origin) return row.url;
    } catch {
      // fall through
    }
  }
  if (row.projects?.project_id) return `${origin}${projectHref(row.projects.project_id)}`;
  if (row.email_category === "reviews") return `${origin}/admin`;
  return `${origin}/`;
}

async function send(
  apiKey: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  fetchImpl: typeof fetch,
): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "blkfndr-notifications/1.0",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { kind: "retry", error: `Network: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) };
  }

  let payload: { id?: string; name?: string; message?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // An empty or non-JSON body; the status says enough.
  }
  const said = `${res.status} ${payload.name ?? ""} ${payload.message ?? ""}`.trim().slice(0, 300);

  if (res.ok) return { kind: "sent", id: String(payload.id ?? "") };
  // The key, the sending domain or the account: every send would fail alike.
  if (res.status === 401 || res.status === 403) return { kind: "stop", error: said };
  // Rate limit or quota: try again on a later run.
  if (res.status === 429) return { kind: "stop", error: said };
  // Another request with this key is still in flight.
  if (res.status === 409 && payload.name === "concurrent_idempotent_requests") return { kind: "retry", error: said };
  if (res.status >= 500) return { kind: "retry", error: said };
  return { kind: "failed", error: said };
}

export async function sendNotificationEmails(
  options: { dryRun?: boolean; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<NotificationEmailsResult> {
  const dryRun = Boolean(options.dryRun);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const admin = createAdminClient();
  const result: NotificationEmailsResult = {
    status: "done",
    detail: "",
    sent: 0,
    skipped: 0,
    failed: 0,
    retrying: 0,
    expired: 0,
    ...(dryRun ? { wouldSend: [] } : {}),
  };

  // Too old to be worth sending now.
  const freshSince = new Date(now - FRESH_FOR_MS).toISOString();
  if (dryRun) {
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("email_status", "pending")
      .lt("created_at", freshSince);
    result.expired = count ?? 0;
  } else {
    const { data: expired, error } = await admin
      .from("notifications")
      .update({ email_status: "skipped", email_error: "Not sent within a day of the notification." })
      .eq("email_status", "pending")
      .lt("created_at", freshSince)
      .select("id");
    if (error) throw new Error(`Could not expire old emails: ${error.message}`);
    result.expired = (expired ?? []).length;
  }

  const apiKey = await getSecret("resend_api_key");
  if (!apiKey) {
    return { ...result, status: "skipped", detail: "No Resend API key is set, so nothing was sent." };
  }
  const origin = allowedOrigins()[0];
  if (!origin) {
    return { ...result, status: "skipped", detail: "NEXT_PUBLIC_APP_URL is not set, so emails would have no links." };
  }
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;

  const { data, error } = await admin
    .from("notifications")
    .select("id, user_id, title, caption, url, email_category, email_attempts, created_at, projects(project_id)")
    .eq("email_status", "pending")
    .gte("created_at", freshSince)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) throw new Error(`Could not read the email queue: ${error.message}`);
  const rows = (data ?? []) as unknown as PendingRow[];
  if (rows.length === 0) {
    return { ...result, status: result.expired > 0 ? "done" : "skipped", detail: "No emails were waiting." };
  }

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const prefs = await preferencesFor(admin, userIds, { create: !dryRun });

  // Addresses come from the auth record: the one they signed in with, and only
  // once it is confirmed, so a typo'd sign-up never receives anything.
  const addresses = new Map<string, string | null>();
  for (const id of userIds) {
    const { data: found } = await admin.auth.admin.getUserById(id);
    const user = found?.user;
    addresses.set(id, user?.email && user.email_confirmed_at ? user.email : null);
  }

  const mark = async (id: string, patch: TablesUpdate<"notifications">) => {
    if (dryRun) return;
    const { error: updateError } = await admin.from("notifications").update(patch).eq("id", id);
    if (updateError) console.error(`[notification-emails] Could not record the outcome for ${id}:`, updateError.message);
  };

  let stopped: string | null = null;
  let sentAny = false;
  for (const row of rows) {
    const category = row.email_category;
    const pref = prefs.get(row.user_id);
    const to = addresses.get(row.user_id);

    if (isEmailSwitch(category) && pref && !pref[category]) {
      result.skipped++;
      await mark(row.id, { email_status: "skipped", email_error: `Turned off (${category}).` });
      continue;
    }
    if (!to) {
      result.skipped++;
      await mark(row.id, { email_status: "skipped", email_error: "No confirmed email address on the account." });
      continue;
    }

    const unsubscribeUrl =
      isEmailSwitch(category) && pref?.token
        ? `${origin}/email/unsubscribe?t=${encodeURIComponent(pref.token)}&c=${category}`
        : null;
    const oneClickUrl =
      isEmailSwitch(category) && pref?.token
        ? `${origin}/api/email/unsubscribe?t=${encodeURIComponent(pref.token)}&c=${category}`
        : null;
    const email = renderNotificationEmail({
      title: row.title,
      caption: row.caption,
      href: linkFor(row, origin),
      category,
      settingsUrl: `${origin}/settings#email`,
      unsubscribeUrl,
      practice: IS_PRACTICE_NETWORK,
    });

    if (dryRun) {
      result.wouldSend!.push({ id: row.id, to, subject: email.subject, category });
      continue;
    }

    if (sentAny) await new Promise((r) => setTimeout(r, GAP_MS));
    sentAny = true;
    const outcome = await send(
      apiKey,
      {
        from,
        to: [to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        // One-click unsubscribe (RFC 8058), which Gmail and Yahoo expect from
        // anyone sending regularly.
        ...(oneClickUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${oneClickUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
        tags: [{ name: "category", value: category }],
      },
      `notification-${row.id}`,
      fetchImpl,
    );

    if (outcome.kind === "sent") {
      result.sent++;
      await mark(row.id, { email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null });
    } else if (outcome.kind === "failed") {
      result.failed++;
      await mark(row.id, { email_status: "failed", email_attempts: row.email_attempts + 1, email_error: outcome.error });
    } else if (outcome.kind === "retry") {
      const attempts = row.email_attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        result.failed++;
        await mark(row.id, { email_status: "failed", email_attempts: attempts, email_error: outcome.error });
      } else {
        result.retrying++;
        await mark(row.id, { email_attempts: attempts, email_error: outcome.error });
      }
    } else {
      // Left pending, attempts untouched; the error says why, for the operator.
      result.retrying++;
      await mark(row.id, { email_error: outcome.error });
      stopped = outcome.error;
      break;
    }
  }

  const summary = dryRun
    ? `Would send ${result.wouldSend!.length}, skip ${result.skipped}.`
    : `Sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}, retrying ${result.retrying}.`;
  if (stopped) {
    return { ...result, status: "stopped", detail: `Resend refused a send, so the run stopped: ${stopped}. ${summary}` };
  }
  return { ...result, detail: summary };
}
