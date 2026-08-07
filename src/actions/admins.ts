"use server";

import { listAdmins, grantAdmin, revokeAdmin, listAuditLog } from "@/lib/data/admins";
import { authFailure } from "@/lib/auth/guards";

/**
 * Every exported async function in a "use server" file is a public HTTP
 * endpoint reachable by action id whether or not a component calls it. These
 * wrappers add no authorization of their own — requireAdmin and RLS both run
 * underneath — they only turn a thrown AuthError into something renderable.
 */

function fail(error: unknown, fallback: string) {
  return (
    authFailure(error) ?? {
      success: false as const,
      error: error instanceof Error ? error.message : fallback,
    }
  );
}

export async function getAdminsAction() {
  try {
    return { success: true as const, admins: await listAdmins() };
  } catch (error) {
    return fail(error, "Could not load administrators.");
  }
}

export async function grantAdminAction(email: string, note?: string) {
  try {
    return { success: true as const, admins: await grantAdmin(email, note ?? "") };
  } catch (error) {
    return fail(error, "Could not add administrator.");
  }
}

export async function revokeAdminAction(email: string) {
  try {
    return { success: true as const, admins: await revokeAdmin(email) };
  } catch (error) {
    return fail(error, "Could not remove administrator.");
  }
}

export async function getAdminAuditLogAction() {
  try {
    return { success: true as const, entries: await listAuditLog() };
  } catch (error) {
    return fail(error, "Could not load the audit log.");
  }
}
