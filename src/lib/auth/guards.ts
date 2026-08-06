// Authorization guards for Server Actions and API routes.
//
// Every exported async function in a "use server" file is a public HTTP
// endpoint — Next.js gives it a callable action id and anyone can POST to it.
// The same is true of every route handler. Nothing in this app may read or
// write user-scoped data without passing through one of these.

import { connectToDatabase } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { getSession, type SessionUser } from "@/lib/auth/session";
import { checkIsAdminOnChain } from "@/lib/stellar";

export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * Require a signed-in caller. Throws 401 otherwise.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session?.user?.uid) {
    throw new AuthError("Unauthorized", 401);
  }
  return session.user;
}

/**
 * Require a signed-in caller and return their database record.
 * Throws 401 if the session is missing or the user no longer exists.
 */
export async function requireUser() {
  const sessionUser = await requireSession();
  await connectToDatabase();
  const record = await User.findOne({ uid: sessionUser.uid }).lean();
  if (!record) {
    throw new AuthError("Unauthorized", 401);
  }
  return { sessionUser, record };
}

/**
 * Require an admin caller.
 *
 * On-chain state is the source of truth, not the cached `role` column — the DB
 * value is a mirror that this function re-syncs on every check, so revoking an
 * admin on-chain takes effect immediately instead of waiting for a stale row to
 * be noticed. Callers with no linked wallet can never be admins.
 */
export async function requireAdmin() {
  const { sessionUser, record } = await requireUser();

  if (!record.stellarPublicKey) {
    throw new AuthError("Forbidden", 403);
  }

  const isOnChainAdmin = await checkIsAdminOnChain(record.stellarPublicKey);
  const expectedRole = isOnChainAdmin ? "admin" : "user";

  if (record.role !== expectedRole) {
    await User.updateOne({ uid: sessionUser.uid }, { $set: { role: expectedRole } });
    record.role = expectedRole;
  }

  if (!isOnChainAdmin) {
    throw new AuthError("Forbidden", 403);
  }

  return { sessionUser, record };
}

/**
 * Require that the caller owns `uid`, or is an admin acting on someone else's
 * behalf. Use for any action that takes a target user id as a parameter.
 */
export async function requireSelfOrAdmin(uid: string) {
  const { sessionUser, record } = await requireUser();
  if (sessionUser.uid === uid) {
    return { sessionUser, record, isAdmin: record.role === "admin" };
  }
  const admin = await requireAdmin();
  return { ...admin, isAdmin: true };
}

/**
 * Require that the caller owns `stellarPublicKey`, or is an admin.
 * Wallet ownership is established at link time by
 * POST /api/auth/freighter/verify, which checks a signed challenge.
 */
export async function requireWalletOwnerOrAdmin(stellarPublicKey: string) {
  const { sessionUser, record } = await requireUser();
  if (record.stellarPublicKey && record.stellarPublicKey === stellarPublicKey) {
    return { sessionUser, record, isAdmin: record.role === "admin" };
  }
  const admin = await requireAdmin();
  return { ...admin, isAdmin: true };
}

/**
 * Map a thrown AuthError onto a `{ success: false }` shape for Server Actions
 * that report failure by return value rather than by throwing. Rethrows
 * anything that is not an AuthError so real bugs stay loud.
 */
export function authFailure(error: unknown): { success: false; error: string } | null {
  if (error instanceof AuthError) {
    return { success: false, error: error.message };
  }
  return null;
}
