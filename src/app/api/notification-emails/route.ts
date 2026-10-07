import { NextRequest, NextResponse } from "next/server";
import { queueVoteReminders } from "@/lib/data/vote-reminders";
import { sendNotificationEmails } from "@/lib/email/notification-emails";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Called every minute by the notification-emails cron. Two jobs:
 *
 * 1. Queue "one day left to vote" reminders for stakeholders who haven't voted
 *    on a stage closing within the day. These go to the bell whether or not
 *    email is set up.
 * 2. Email the notifications queued for email, through Resend. Without a
 *    Resend key this sends nothing.
 *
 * Same bearer-secret gate as the other cron endpoints. `{"dryRun": true}`
 * reports what is due and what would be sent, and writes and sends nothing.
 */
function isAuthenticated(req: NextRequest): boolean {
  const secret = process.env.INDEXER_SECRET;
  if (!secret) {
    console.error("INDEXER_SECRET is not set — rejecting request.");
    return false;
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice("Bearer ".length);
  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // No body: a normal scheduled run.
  }

  try {
    // A reminder problem must not hold up the emails already queued.
    const reminders = await queueVoteReminders({ dryRun }).catch((error: unknown) => {
      console.error("[notification-emails] Vote reminders failed:", error);
      return { error: String(error) };
    });
    const emails = await sendNotificationEmails({ dryRun });
    return NextResponse.json({ success: true, reminders, emails });
  } catch (error) {
    console.error("Error in notification-emails route:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
