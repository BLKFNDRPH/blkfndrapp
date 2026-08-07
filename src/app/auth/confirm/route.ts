import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

export const dynamic = "force-dynamic";

/**
 * Email confirmation and recovery links.
 *
 * Uses the `token_hash` form rather than the older `?token=` links: the hash is
 * single-use and verified server-side, so a link sitting in an inbox — or in a
 * mail scanner's crawl log — cannot be replayed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Derived from Supabase's own `type` rather than from a `next` we appended.
  // Both destinations are fixed by the flow — a recovery link goes to settings
  // to set a new password, everything else to the profile — so there was no
  // reason to put them on the URL and force a wildcard into the allow-list.
  // The query parameter is still honoured for links already in inboxes.
  const next = safeInternalPath(
    searchParams.get("next") ?? (type === "recovery" ? "/settings" : "/profile"),
  );

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=InvalidLink", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    console.error("[auth] OTP verification failed:", error.message);
    return NextResponse.redirect(new URL("/login?error=LinkExpired", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
