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

export interface AuthedCaller {
  userId: string;
  email: string | null;
  isAdmin: boolean;
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

  // Roles come from app_metadata, which only the service-role key can write.
  // user_metadata is self-service and worthless for authorization.
  const appMetadata = (claims.app_metadata ?? {}) as { role?: string };

  return {
    userId: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    isAdmin: appMetadata.role === "admin",
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
