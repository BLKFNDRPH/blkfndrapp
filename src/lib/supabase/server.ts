import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Request-scoped Supabase client carrying the caller's session.
 *
 * Every query made through this client is subject to RLS, which is the point:
 * a missed check in application code no longer decides whether someone else's
 * data comes back.
 *
 * Use in Server Components, Server Actions, and Route Handlers.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component render: cookies are read-only here. Safe to
            // ignore — the proxy refreshes the session.
          }
        },
      },
    },
  );
}
