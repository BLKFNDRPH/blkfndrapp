import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeNextPath } from "@/lib/auth/next-cookie";
import { publicOrigin } from "@/lib/auth/app-origin";

export const dynamic = "force-dynamic";

/**
 * OAuth and magic-link landing point.
 *
 * Supabase runs PKCE, so the code returned here is only redeemable by the
 * browser holding the verifier it was issued against. That removes the whole
 * class of problem the hand-rolled flow had — there is no nonce for us to
 * forget to check, and an attacker's code cannot be replayed into a victim's
 * session.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Not request.nextUrl.origin: behind a proxy that rewrites Host it resolves
  // to the container address, and every redirect below would send the browser
  // somewhere it cannot reach.
  const origin = await publicOrigin();
  const code = searchParams.get("code");
  // From the cookie set before the round trip. The `next` query parameter is
  // still honoured as a fallback so links issued before this change keep
  // working, and it is re-validated rather than trusted.
  const next = await consumeNextPath(searchParams.get("next"));

  // The provider reports failures here too; surface them rather than
  // redirecting to a page that silently looks signed-out.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    console.error("[auth] Provider returned an error:", providerError);
    return NextResponse.redirect(new URL("/login?error=Provider", origin));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=NoCode", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] Code exchange failed:", error.message);
    return NextResponse.redirect(new URL("/login?error=Exchange", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
