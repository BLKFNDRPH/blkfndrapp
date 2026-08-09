import "server-only";

import { createClient } from "@/lib/supabase/server";

export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export type AdminRole = "owner" | "kyc_manager" | "project_approver" | "accountant";

export interface AuthedCaller {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  /** Their role on the roster, or null if not an admin. Read fresh, like isAdmin. */
  role: AdminRole | null;
}

/**
 * Identify the caller.
 *
 * Uses `getClaims()`, which verifies the JWT signature locally. `getSession()`
 * reads the cookie without verifying it and must never be used to authorize —
 * its contents can be forged.
 */
export async function requireCaller(): Promise<AuthedCaller> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  const claims = data?.claims;
  if (error || !claims?.sub) {
    throw new AuthError("Unauthorized", 401);
  }

  // Admin status comes from the platform_admins roster, asked fresh, not from a
  // claim baked into the token.
  //
  // It used to read app_metadata.role, which was written once when a wallet was
  // linked and never revisited. That is a cache that only ever goes stale in the
  // dangerous direction: revoking someone left their existing token asserting
  // admin until it happened to be reissued. is_admin() is SECURITY DEFINER and
  // takes no arguments — it answers only about the caller — so asking the
  // database costs one round trip and cannot be forged by editing a token.
  // One round trip answers both: the role, and — by its presence — whether they
  // are an admin at all. A null role is a non-admin; is_admin() would agree, so
  // asking it separately would be a second trip for a fact this one already
  // carries.
  const { data: role } = await supabase.rpc("my_role");

  return {
    userId: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    isAdmin: role != null,
    role: (role as AdminRole | null) ?? null,
  };
}

export async function requireAdmin(): Promise<AuthedCaller> {
  const caller = await requireCaller();
  if (!caller.isAdmin) {
    throw new AuthError("Forbidden", 403);
  }
  return caller;
}

/** Null instead of throwing, for pages that render differently when signed out. */
export async function getCaller(): Promise<AuthedCaller | null> {
  try {
    return await requireCaller();
  } catch {
    return null;
  }
}
