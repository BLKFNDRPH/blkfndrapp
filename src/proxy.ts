import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { buildCsp, createNonce } from "@/lib/csp";
import { legacyHostRedirect } from "@/lib/legacy-hosts";
import { FRIENDBOT_URL, HORIZON_URL, SOROBAN_RPC_URL } from "@/lib/network";

/**
 * Refreshes the Supabase session on navigation so an expired access token does
 * not surface as a spurious sign-out.
 *
 * This is a convenience, NOT a security boundary. It runs before any route and
 * can be bypassed; every page, route handler and server action re-verifies the
 * caller itself via `requireCaller()`. Treating middleware as the gate is a
 * well-worn way to ship an app that is authenticated only by accident.
 *
 * It also sets the Content-Security-Policy (src/lib/csp.ts) with a fresh
 * nonce. The policy goes on the request too: Next.js reads the nonce from the
 * request's CSP header and stamps it on its inline scripts, and the root layout
 * reads x-nonce for the theme script. CSP_REPORT_ONLY=1 at runtime sends it as
 * Content-Security-Policy-Report-Only instead, to back it out without a build.
 *
 * Before any of that, a request that arrived on a retired hostname
 * (LEGACY_HOSTS, runtime) is sent to the same path on NEXT_PUBLIC_APP_URL with
 * a permanent redirect (src/lib/legacy-hosts.ts). Nothing else runs for it.
 */
export async function proxy(request: NextRequest) {
  const moved = legacyHostRedirect(
    {
      forwardedHost: request.headers.get("x-forwarded-host"),
      host: request.headers.get("host"),
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
    },
    { legacyHosts: process.env.LEGACY_HOSTS, appUrl: process.env.NEXT_PUBLIC_APP_URL },
  );
  if (moved) return NextResponse.redirect(moved, 308);

  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    sorobanRpcUrl: SOROBAN_RPC_URL,
    horizonUrl: HORIZON_URL,
    friendbotUrl: FRIENDBOT_URL,
    mapsEmbed: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
    dev: process.env.NODE_ENV === "development",
  });
  const cspHeader =
    process.env.CSP_REPORT_ONLY === "1"
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy";
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);
  const withCsp = (res: NextResponse) => {
    res.headers.set(cspHeader, csp);
    return res;
  };

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // During the migration the app still runs without Supabase configured.
  if (!url || !anonKey) return withCsp(response);

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touching the user is what triggers the refresh. Do not remove.
  await supabase.auth.getUser();

  return withCsp(response);
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
