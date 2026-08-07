import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";

/**
 * The platform admin roster — who may use the console.
 *
 * This is not the on-chain admin roster. That one lives in the blkfndr-admin
 * contract, governs who may sign a contract change, and is enforced by the
 * ledger, which does not read this table and cannot be persuaded by anything
 * this application believes. A person can hold either, both, or neither.
 *
 * Authorization is layered rather than located here:
 *
 *   1. A verified Supabase session      — who you are
 *   2. This roster, enforced by RLS     — whether you may use the console
 *   3. A wallet signature the contract  — whether a contract will accept it
 *      accepts
 *
 * requireAdmin below is not the boundary; RLS is. The policies on
 * platform_admins already restrict every statement to admins, so a caller who
 * bypassed this function would still write nothing. It runs first so the
 * failure is a clean 403 rather than a silent zero-row update.
 */

const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(320);

export interface PlatformAdmin {
  email: string;
  grantedAt: string;
  note: string;
  /** Null until the invited address first signs in. */
  claimed: boolean;
}

export async function listAdmins(): Promise<PlatformAdmin[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("platform_admins")
    .select("email, granted_at, note, user_id")
    .order("granted_at", { ascending: true });

  if (error) throw new Error(`Could not load administrators: ${error.message}`);

  return (data ?? []).map((r) => ({
    email: r.email,
    grantedAt: r.granted_at,
    note: r.note,
    claimed: r.user_id !== null,
  }));
}

export async function grantAdmin(email: string, note = ""): Promise<PlatformAdmin[]> {
  const caller = await requireAdmin();
  const parsed = EmailSchema.parse(email);

  const admin = createAdminClient();

  // Bind an existing account immediately. The claim_admin_invite trigger only
  // fires on signup, so inviting someone who already has an account would
  // otherwise leave user_id null forever — they would still be an admin via the
  // email branch of is_admin(), but every check would fall back to the string
  // comparison rather than the indexed id.
  const { data: existing } = await admin.auth.admin.listUsers();
  const match = existing?.users?.find(
    (u) => (u.email ?? "").toLowerCase() === parsed,
  );

  const { error } = await admin.from("platform_admins").insert({
    email: parsed,
    user_id: match?.id ?? null,
    granted_by: caller.userId,
    note: note.trim().slice(0, 200),
  });

  if (error) {
    if (error.code === "23505") throw new Error(`${parsed} is already an administrator.`);
    throw new Error(`Could not add administrator: ${error.message}`);
  }

  await record("admin.grant", caller.userId, parsed, note);
  return listAdmins();
}

export async function revokeAdmin(email: string): Promise<PlatformAdmin[]> {
  const caller = await requireAdmin();
  const parsed = EmailSchema.parse(email);

  // Checked here for a readable message; the database enforces it regardless
  // via guard_admin_removal, which also blocks emptying the roster entirely.
  if (parsed === (caller.email ?? "").toLowerCase()) {
    throw new Error("You cannot remove your own administrator access.");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_admins")
    .delete()
    .eq("email", parsed);

  if (error) throw new Error(`Could not remove administrator: ${error.message}`);

  await record("admin.revoke", caller.userId, parsed, "");
  return listAdmins();
}

/** Admin-readable, service-role-written. Never writable from a browser session. */
export async function listAuditLog(limit = 100) {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("admin_audit_log")
    .select("action, target_email, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 500));

  if (error) throw new Error(`Could not load the audit log: ${error.message}`);
  return data ?? [];
}

async function record(
  action: string,
  actorId: string,
  targetEmail: string,
  detail: string,
) {
  const admin = createAdminClient();
  const { error } = await admin.from("admin_audit_log").insert({
    action,
    actor_id: actorId,
    target_email: targetEmail,
    detail: detail.slice(0, 500),
  });
  // Logged rather than thrown: the grant already happened, and failing the
  // request now would report an error for an action that succeeded.
  if (error) {
    console.error(`[admins] Could not write audit entry for ${action}:`, error.message);
  }
}
