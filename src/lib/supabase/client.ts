"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Browser client. Carries the publishable key, which is public by design —
 * its safety rests on RLS, not on secrecy.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
