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

export interface PlatformAdmin {
  email: string;
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
    .select("email, granted_at, note, user_id, wallet_address")
    .order("granted_at", { ascending: true });

  if (error) throw new Error(`Could not load administrators: ${error.message}`);

  return (data ?? []).map((r) => ({
    email: r.email,
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
  note = "",
): Promise<PlatformAdmin[]> {
  const caller = await requireAdmin();
  const parsed = EmailSchema.parse(email);
  const wallet = walletAddress.trim() ? WalletSchema.parse(walletAddress) : null;

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
    throw new Error(`Could not add administrator: ${error.message}`);
  }

  await record("admin.grant", caller.userId, parsed, wallet ? `wallet ${wallet}` : note);
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

  const admin = createAdminClient();
  const { data, error } = await admin
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

  // The service-role client bypasses RLS, so a missing row updates nothing and
  // reports success. Checked explicitly, otherwise a typo in the email looks
  // like it worked.
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
