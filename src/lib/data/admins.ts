import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { ADMIN_ROLES, ROLE_LABELS, type AdminRole } from "@/lib/admin-roles";

// Re-exported so existing server-side importers of these from here keep working.
export { ADMIN_ROLES, ROLE_LABELS, type AdminRole };

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
 * requireAdmin below IS the boundary for anything written through the
 * service-role client, which bypasses RLS entirely. This comment used to claim
 * the opposite — that RLS would still refuse a caller who got past
 * requireAdmin — and that was false: a service-role write is not subject to any
 * policy. Worth stating plainly, because a wrong belief about where a boundary
 * lives is more dangerous than no belief at all.
 *
 * So the rule here is: use the service-role client only where it is genuinely
 * needed (reading auth.users to bind an invite to an existing account), and go
 * through the caller's own session for everything else. That keeps RLS as a
 * real second layer instead of a decorative one, and it is also what lets the
 * database see who is acting — guard_admin_removal reads auth.uid(), which is
 * NULL under service_role, so a delete made that way silently skips the
 * self-removal check.
 *
 * Note that both layers test *membership*, not ownership: any admin may add or
 * remove any other. The on-chain roster has an owner and this table does not,
 * so the two disagree about who may edit the list. Deliberate for now, but it
 * is a difference worth knowing about rather than discovering.
 */

const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(320);

/**
 * A Stellar address, kept exactly as the network spells it.
 *
 * Deliberately not lower-cased the way the email above is. A strkey is uppercase
 * base32 — 'G' then 55 characters from an alphabet that omits 0, 1, 8 and I — so
 * lower-casing produces a string the network will never accept, and comparing
 * case-insensitively would match addresses that are not the same address.
 *
 * Trimmed because wallet addresses are almost always pasted, and a trailing
 * space is invisible in a form field but fatal to an exact match.
 */
const WalletSchema = z
  .string()
  .trim()
  .regex(
    /^G[A-Z2-7]{55}$/,
    "Enter a valid Stellar address — 56 characters beginning with G.",
  );

const RoleSchema = z.enum(ADMIN_ROLES);

export interface PlatformAdmin {
  /** Who this is. Recorded at grant time; a profile lookup cannot name someone
   *  who has not signed in yet, which is when the roster is least legible. */
  name: string;
  email: string;
  role: AdminRole;
  grantedAt: string;
  note: string;
  /** Null until the invited address first signs in. */
  claimed: boolean;
  /**
   * The admin's Stellar address, or null if they have not recorded one.
   *
   * Console recognition only. Holding this does not let the ledger accept a
   * signature — that is the on-chain roster, which does not read this table.
   */
  walletAddress: string | null;
}

export async function listAdmins(): Promise<PlatformAdmin[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("platform_admins")
    .select("email, display_name, role, granted_at, note, user_id, wallet_address")
    .order("granted_at", { ascending: true });

  if (error) throw new Error(`Could not load administrators: ${error.message}`);

  return (data ?? []).map((r) => ({
    name: r.display_name || r.email.split("@")[0],
    email: r.email,
    role: r.role,
    grantedAt: r.granted_at,
    note: r.note,
    claimed: r.user_id !== null,
    walletAddress: r.wallet_address ?? null,
  }));
}

/**
 * Add an administrator.
 *
 * The wallet is optional because the two identifiers arrive at different times:
 * an invite is addressed to an email before its holder has signed in, let alone
 * connected Freighter. Requiring both here would mean nobody could be invited
 * until they had already done the thing the invite is for.
 */
export async function grantAdmin(
  email: string,
  walletAddress = "",
  name = "",
  role: AdminRole = "owner",
  note = "",
): Promise<PlatformAdmin[]> {
  const caller = await requireAdmin();
  const parsed = EmailSchema.parse(email);
  const wallet = walletAddress.trim() ? WalletSchema.parse(walletAddress) : null;
  const displayName = name.trim().slice(0, 120);
  const parsedRole = RoleSchema.parse(role);

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

  // The service-role client is used above only for listUsers, which genuinely
  // needs it. The row itself goes in through the caller's session so RLS still
  // applies to the write that actually grants access.
  const supabase = await createClient();
  const { error } = await supabase.from("platform_admins").insert({
    email: parsed,
    display_name: displayName,
    role: parsedRole,
    user_id: match?.id ?? null,
    wallet_address: wallet,
    granted_by: caller.userId,
    note: note.trim().slice(0, 200),
  });

  if (error) {
    // Both unique indexes surface as 23505, and "already an administrator" would
    // be actively misleading for the wallet case — that address belongs to a
    // *different* admin, which is a different problem with a different fix.
    if (error.code === "23505") {
      throw new Error(
        error.message.includes("wallet_address")
          ? "That wallet address is already assigned to another administrator."
          : `${parsed} is already an administrator.`,
      );
    }
    if (error.code === "23514") {
      throw new Error("That is not a valid Stellar address.");
    }
    // The insert goes through the caller's session, and only owners may write
    // the roster. A moderator who reaches this — the form is theirs to see only
    // if they are an owner — gets a readable reason rather than a raw RLS code.
    if (error.code === "42501") {
      throw new Error("Only an owner can add or change administrators.");
    }
    throw new Error(`Could not add administrator: ${error.message}`);
  }

  await record(
    "admin.grant",
    caller.userId,
    parsed,
    `${parsedRole}${wallet ? ` · wallet ${wallet}` : ""}`,
  );
  return listAdmins();
}

/**
 * Record or replace an existing admin's wallet address.
 *
 * Separate from grantAdmin because this is the common case: admins were invited
 * by email long before anyone thought to store a wallet, so most existing rows
 * need filling in rather than recreating. Passing an empty address clears it,
 * which is how a lost or rotated key is retired.
 */
export async function setAdminWallet(
  email: string,
  walletAddress: string,
): Promise<PlatformAdmin[]> {
  const caller = await requireAdmin();
  const parsed = EmailSchema.parse(email);
  const wallet = walletAddress.trim() ? WalletSchema.parse(walletAddress) : null;

  // The caller's own session rather than the service role, so RLS is a real
  // second layer here instead of being bypassed. Nothing in this function needs
  // privileges the caller lacks.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .update({ wallet_address: wallet })
    .eq("email", parsed)
    .select("email");

  if (error) {
    if (error.code === "23505") {
      throw new Error("That wallet address is already assigned to another administrator.");
    }
    if (error.code === "23514") {
      throw new Error("That is not a valid Stellar address.");
    }
    throw new Error(`Could not update the wallet address: ${error.message}`);
  }

  // An update matching no row reports success either way — whether the email
  // was mistyped or the policy declined it. Checked explicitly, so neither
  // looks like it worked.
  if (!data || data.length === 0) {
    throw new Error(`${parsed} is not an administrator.`);
  }

  await record(
    "admin.wallet",
    caller.userId,
    parsed,
    wallet ? `set to ${wallet}` : "cleared",
  );
  return listAdmins();
}

export async function revokeAdmin(email: string): Promise<PlatformAdmin[]> {
  const caller = await requireAdmin();
  const parsed = EmailSchema.parse(email);

  if (parsed === (caller.email ?? "").toLowerCase()) {
    throw new Error("You cannot remove your own administrator access.");
  }

  // Deleted through the caller's session, which is what lets
  // guard_admin_removal do its job. It compares against auth.uid() and
  // auth.jwt()->>'email', both NULL under the service role — so the self-removal
  // predicate evaluated to NULL rather than true and the trigger never raised.
  // Only its last-admin count check survived that path. The comment above used
  // to say the database enforced this "regardless"; it did not, and the check
  // above was carrying it alone.
  const supabase = await createClient();
  const { error } = await supabase
    .from("platform_admins")
    .delete()
    .eq("email", parsed);

  if (error) throw new Error(`Could not remove administrator: ${error.message}`);

  await record("admin.revoke", caller.userId, parsed, "");
  return listAdmins();
}

export interface WalletRecognition {
  /** The address belongs to some administrator. */
  onRoster: boolean;
  /** The address is the one recorded against the caller's own account. */
  isOwn: boolean;
  /** The caller has recorded an address, and this is not it. */
  mismatch: boolean;
}

/**
 * Whether the connected wallet is one the console knows.
 *
 * The distinction that matters is `mismatch`: an admin who has a wallet on file
 * and connects a different one is in a very different position from an admin who
 * has never recorded one. The first has probably selected the wrong account in
 * Freighter — an easy thing to do, and previously indistinguishable from having
 * no access at all, because the console had nothing to compare against and every
 * unfamiliar address produced the same warning.
 */
export async function recognizeWallet(address: string): Promise<WalletRecognition> {
  const caller = await requireAdmin();
  if (!address.trim()) return { onRoster: false, isOwn: false, mismatch: false };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_admin_wallet", { addr: address.trim() });
  if (error) throw new Error(`Could not check the wallet address: ${error.message}`);

  const admin = createAdminClient();
  const { data: own } = await admin
    .from("platform_admins")
    .select("wallet_address")
    .eq("email", (caller.email ?? "").toLowerCase())
    .maybeSingle();

  const recorded = own?.wallet_address ?? null;

  return {
    onRoster: Boolean(data),
    isOwn: recorded !== null && recorded === address.trim(),
    mismatch: recorded !== null && recorded !== address.trim(),
  };
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
