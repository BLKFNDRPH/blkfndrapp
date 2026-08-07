import "server-only";

/**
 * Authorization guards for Server Actions and API routes.
 *
 * Every exported async function in a "use server" file is a public HTTP
 * endpoint, and so is every route handler. Nothing may read or write
 * user-scoped data without passing through one of these.
 *
 * Identity now comes from Supabase Auth rather than a hand-rolled JWT and a
 * Mongo lookup. Two consequences worth knowing:
 *
 *   * `requireAdmin` reads the role from `app_metadata`, which only the
 *     service-role key can write. The previous version read a `role` column
 *     from a document the application also wrote, so the check and the thing
 *     being checked shared a writer.
 *   * These guards are now the *second* line of defence. RLS confines each
 *     query to rows the caller may touch, so a forgotten guard no longer
 *     decides whether someone else's data comes back.
 */

export {
  AuthError,
  requireCaller,
  requireAdmin,
  getCaller,
  type AuthedCaller,
} from "@/lib/supabase/auth";

import { AuthError, requireCaller, requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Require that the caller owns `userId`, or is an admin acting on their behalf.
 */
export async function requireSelfOrAdmin(userId: string) {
  const caller = await requireCaller();
  if (caller.userId === userId) return caller;
  return requireAdmin();
}

/**
 * Require that the caller has proven control of `stellarPublicKey`, or is an
 * admin.
 *
 * Ownership is established at link time by the Freighter challenge flow, which
 * verifies a signature before writing the address to the profile.
 */
export async function requireWalletOwnerOrAdmin(stellarPublicKey: string) {
  const caller = await requireCaller();

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("stellar_public_key")
    .eq("id", caller.userId)
    .maybeSingle();

  if (data?.stellar_public_key && data.stellar_public_key === stellarPublicKey) {
    return caller;
  }
  return requireAdmin();
}

/**
 * Map a thrown AuthError onto a `{ success: false }` shape for Server Actions
 * that report failure by return value. Rethrows anything else so real bugs
 * stay loud.
 */
export function authFailure(error: unknown): { success: false; error: string } | null {
  if (error instanceof AuthError) {
    return { success: false, error: error.message };
  }
  return null;
}
