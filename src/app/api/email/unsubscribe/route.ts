import { NextRequest, NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/data/email-preferences";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe (RFC 8058): the target of every email's
 * List-Unsubscribe header. A mail app POSTs here with no session when someone
 * presses its own "Unsubscribe" button; the token in the link says who, and the
 * category which kind of email.
 *
 * POST only. A GET would let a link scanner that opens every URL in an email
 * turn someone's emails off; the link in the email body goes to a page with a
 * button instead (/email/unsubscribe).
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const category = req.nextUrl.searchParams.get("c") ?? "";
  try {
    const done = await unsubscribeByToken(token, category);
    if (!done) return NextResponse.json({ success: false, error: "That link isn't valid." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[email-unsubscribe] Could not unsubscribe:", error);
    return NextResponse.json({ success: false, error: "Try again in a moment." }, { status: 500 });
  }
}
