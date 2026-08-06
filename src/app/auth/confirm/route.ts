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
  const next = safeInternalPath(searchParams.get("next"));

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
