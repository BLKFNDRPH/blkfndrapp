import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * A Supabase client with no session: it reads exactly what a signed-out
 * visitor may read, under RLS, and never touches the request's cookies.
 *
 * For reads shared between signed-out visitors (see public-reads.ts), which
 * may also be refreshed after the request that started them has ended, when
 * next/headers' cookies() is no longer available.
 */
export function createAnonClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // No session, so nothing to set.
        },
      },
    },
  );
}
