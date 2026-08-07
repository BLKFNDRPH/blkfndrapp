import "server-only";

import { cookies } from "next/headers";
import { safeInternalPath } from "./safe-redirect";

/**
 * Carries the post-sign-in destination across an auth round trip.
 *
 * It used to travel as `?next=` on the URL handed to Supabase. That worked, but
 * it forced the Supabase redirect allow-list to carry a wildcard: the list is
 * matched as a glob against the whole URL, `/` is a separator, and
 * `?next=/profile` therefore needs `**` rather than an exact entry. Supabase
 * recommends exact paths in production, and — more to the point — an allow-list
 * that does not match is not rejected. Supabase silently substitutes the Site
 * URL, so a wildcard people forget to add sends every user to whatever the Site
 * URL happens to be.
 *
 * Keeping the destination out of the URL means the redirect target is a bare
 * path that an exact entry matches.
 */
const COOKIE = "blkfndr-auth-next";

/**
 * Ten minutes. Long enough to sign in with a provider, short enough that a
 * stale destination from an abandoned attempt does not resurface later.
 */
const MAX_AGE_SECONDS = 600;

export async function rememberNextPath(candidate: string | null | undefined) {
  const next = safeInternalPath(candidate);
  const store = await cookies();

  store.set(COOKIE, next, {
    httpOnly: true,
    // Lax, not None. The return leg is a top-level GET navigation from the
    // provider, which Lax permits; None would additionally expose it to
    // cross-site subrequests for no benefit here.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Read the destination and clear it, so a single sign-in consumes it once.
 *
 * `fallbackParam` keeps links already in flight working — anything issued
 * before this change still carries `?next=` — and it is re-validated here
 * rather than trusted, because it arrives on the URL.
 */
export async function consumeNextPath(fallbackParam?: string | null): Promise<string> {
  const store = await cookies();
  const stored = store.get(COOKIE)?.value;

  if (stored) {
    store.delete(COOKIE);
    // Re-validated on the way out as well as in. The cookie is httpOnly, but a
    // value that was written before a rule changed should not be exempt from
    // the current one.
    return safeInternalPath(stored);
  }

  return safeInternalPath(fallbackParam);
}
