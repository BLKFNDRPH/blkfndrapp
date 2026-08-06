import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Reserve this for the two things it is genuinely needed for:
 *
 *   1. Reading the identity columns on kyc_requests, which are not granted to
 *      any browser-facing role, after an explicit admin check.
 *   2. Writing app_metadata.role, which is the only trustworthy place a role
 *      can live because a user cannot edit it.
 *
 * Every call site must authorize first. A guard reached only through this
 * module's callers is a guard that will eventually be forgotten, so
 * `requireAdmin()` lives in the data-access layer beside each query rather than
 * being assumed upstream.
 *
 * The `server-only` import above makes importing this from a Client Component a
 * build error rather than a leaked key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Refusing to fall back to a lesser-privileged client, " +
        "which would fail confusingly at the query rather than here.",
    );
  }

  return createSupabaseClient<Database>(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
