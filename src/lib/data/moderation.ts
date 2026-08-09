import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller } from "@/lib/supabase/auth";

/**
 * The platform administrator's tools: banning users, and reading the platform's
 * health. Neither touches money — an operational hand, not a financial one.
 *
 * A ban does two things. It records the user in platform_bans, which hides their
 * listings from the public through RLS, and it sets Supabase's own ban on the
 * account so they cannot sign in. The table is the part that reaches content;
 * the auth ban is the part that reaches the door. Both, because one without the
 * other is a half-ban: a signed-out user whose projects are still up, or a
 * silenced account whose listings still sell.
 */

async function requirePlatformAdmin() {
  const caller = await requireCaller();
  const supabase = await createClient();
  // has_admin_role is true for the role or for an owner. The write itself is
  // RLS-gated on the same predicate, so this only turns a refusal into a clean
  // message instead of a zero-row surprise.
  const { data } = await supabase.rpc("has_admin_role", { wanted: "platform_admin" });
  if (data !== true) {
    throw new Error("Only a platform administrator can do that.");
  }
  return caller;
}

export interface PlatformUser {
  id: string;
  name: string;
  wallet: string | null;
  lastLogin: string | null;
  banned: boolean;
  banReason: string;
}

/** Everyone with a profile, and whether they are banned. Admins only. */
export async function listUsers(): Promise<PlatformUser[]> {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: profiles, error }, { data: bans }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, stellar_public_key, last_login_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("platform_bans").select("user_id, reason"),
  ]);

  if (error) throw new Error(`Could not load users: ${error.message}`);

  const banMap = new Map((bans ?? []).map((b) => [b.user_id, b.reason]));
  return (profiles ?? []).map((p) => ({
    id: p.id,
    name: p.display_name || "Unnamed",
    wallet: p.stellar_public_key ?? null,
    lastLogin: p.last_login_at ?? null,
    banned: banMap.has(p.id),
    banReason: banMap.get(p.id) ?? "",
  }));
}

export async function banUser(userId: string, reason: string) {
  const caller = await requirePlatformAdmin();

  // The ban row goes through the caller's session so RLS enforces the role.
  const supabase = await createClient();
  const { error } = await supabase.from("platform_bans").insert({
    user_id: userId,
    banned_by: caller.userId,
    reason: reason.trim().slice(0, 500),
  });
  if (error) {
    if (error.code === "23505") throw new Error("That user is already banned.");
    if (error.code === "42501") throw new Error("Only a platform administrator can ban a user.");
    throw new Error(`Could not ban the user: ${error.message}`);
  }

  // And the auth-level ban, so they cannot sign in. Service role — only the
  // server can touch auth. Best-effort: if it fails the content ban still
  // stands, and the failure is logged rather than thrown, because a half-applied
  // ban that reports failure would tempt a retry that hits the 23505 above.
  try {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  } catch (err) {
    console.error("[moderation] auth ban failed for", userId, err);
  }
}

export async function unbanUser(userId: string) {
  await requirePlatformAdmin();

  const supabase = await createClient();
  const { error } = await supabase.from("platform_bans").delete().eq("user_id", userId);
  if (error) throw new Error(`Could not lift the ban: ${error.message}`);

  try {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  } catch (err) {
    console.error("[moderation] auth unban failed for", userId, err);
  }
}

export interface PlatformHealth {
  users: number;
  projects: number;
  pendingKyc: number;
  bannedUsers: number;
  unprocessedEvents: number;
  totalEvents: number;
  lastProcessedLedger: number | null;
  indexerUpdatedAt: string | null;
}

/**
 * A read of the platform's state. The indexer figures here because it is the
 * one moving part between the chain and everything the app shows: if it stalls,
 * balances and statuses quietly go stale while looking fine, and the age of its
 * last run is the cheapest way to catch that.
 */
export async function getHealth(): Promise<PlatformHealth> {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [users, projects, kyc, bans, events, indexer] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("projects").select("project_id", { count: "exact", head: true }),
    supabase.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("platform_bans").select("user_id", { count: "exact", head: true }),
    supabase.from("contract_events").select("event_id, processed_at"),
    supabase.from("indexer_state").select("value, updated_at").eq("key", "last_processed_ledger").maybeSingle(),
  ]);

  const eventRows = events.data ?? [];
  return {
    users: users.count ?? 0,
    projects: projects.count ?? 0,
    pendingKyc: kyc.count ?? 0,
    bannedUsers: bans.count ?? 0,
    unprocessedEvents: eventRows.filter((e) => e.processed_at === null).length,
    totalEvents: eventRows.length,
    lastProcessedLedger: indexer.data?.value ?? null,
    indexerUpdatedAt: indexer.data?.updated_at ?? null,
  };
}
