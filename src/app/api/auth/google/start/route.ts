import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { safeInternalPath } from "@/lib/auth/safe-redirect";
import {
  LOGIN_STATE_COOKIE,
  LOGIN_STATE_MAX_AGE_SECONDS,
  type LoginState,
} from "@/lib/auth/login-state";

export const dynamic = "force-dynamic";

/**
 * Begin Google sign-in.
 *
 * The nonce and state are minted here and stashed in an httpOnly cookie so the
 * callback can verify them. Generating them in the browser — as this flow used
 * to — means nothing on the server ever checks them, which leaves the callback
 * willing to accept any validly-signed Google token from anywhere, including
 * one an attacker obtained for their own account and replayed into a victim's
 * browser.
 *
 * SameSite=None is required, not sloppiness: Google returns the token via
 * response_mode=form_post, a cross-site POST, and a Lax cookie would not be
 * sent with it.
 */
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.error("[Auth] NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set");
    return NextResponse.redirect(new URL("/login?error=NotConfigured", appUrl), { status: 303 });
  }

  const returnTo = safeInternalPath(req.nextUrl.searchParams.get("returnTo"));
  const nonce = crypto.randomBytes(32).toString("hex");
  const state = crypto.randomBytes(32).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/callback/google`,
    response_type: "id_token",
    response_mode: "form_post",
    scope: "openid email profile",
    prompt: "consent",
    state,
    nonce,
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    { status: 303 },
  );

  const loginState: LoginState = { nonce, state, returnTo };
  response.cookies.set(LOGIN_STATE_COOKIE, JSON.stringify(loginState), {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
    maxAge: LOGIN_STATE_MAX_AGE_SECONDS,
  });

  return response;
}
