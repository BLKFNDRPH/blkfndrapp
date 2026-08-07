import "server-only";

import { z } from "zod";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller, requireAdmin, AuthError } from "@/lib/supabase/auth";
import { isStellarAccount } from "@/lib/stellar-address";
import { checkIsAdminOnChain } from "@/lib/stellar";

/**
 * Profile data access. Replaces the Mongo `users` collection.
 *
 * Note what is not here: no `role` column. Roles live in `app_metadata`, which
 * only the service-role key can write, because a column a user can reach is a
 * column a user can eventually set.
 */

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  stellar_public_key: string | null;
  wallet_status: "connected" | "disconnected";
  last_login_at: string | null;
}

const PUBLIC_COLUMNS = "id, display_name, avatar_url, stellar_public_key, wallet_status";

export async function getOwnProfile(): Promise<Profile | null> {
  const caller = await requireCaller();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", caller.userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read profile: ${error.message}`);
  return (data as Profile | null) ?? null;
}

export async function updateOwnProfile(input: unknown) {
  const caller = await requireCaller();
  const parsed = z
    .object({
      displayName: z.string().trim().min(1).max(80).optional(),
      avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
    })
    .parse(input);

  const patch: TablesUpdate<"profiles"> = {};
  if (parsed.displayName !== undefined) patch.display_name = parsed.displayName;
  if (parsed.avatarUrl !== undefined) patch.avatar_url = parsed.avatarUrl;
  if (Object.keys(patch).length === 0) return;

  // Through the caller's own client, so the RLS policy — not this function —
  // is what confines the write to their row.
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(patch).eq("id", caller.userId);
  if (error) throw new Error(`Could not update profile: ${error.message}`);
}

/**
 * Resolve addresses to display identities. Signed-in callers only: anonymous
 * access turns this into a deanonymisation oracle, since contributor addresses
 * are public on the ledger.
 */
export async function resolveAddresses(addresses: string[]) {
  await requireCaller();

  const wanted = addresses.filter(isStellarAccount).slice(0, 200);
  if (wanted.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(PUBLIC_COLUMNS)
    .in("stellar_public_key", wanted);

  if (error) throw new Error(`Could not resolve addresses: ${error.message}`);

  const out: Record<string, Profile> = {};
  for (const row of (data ?? []) as Profile[]) {
    if (row.stellar_public_key) out[row.stellar_public_key] = row;
  }
  return out;
}

export async function getProfileByAddress(address: string): Promise<Profile | null> {
  await requireCaller();
  if (!isStellarAccount(address)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(PUBLIC_COLUMNS)
    .eq("stellar_public_key", address)
    .maybeSingle();

  if (error) throw new Error(`Could not look up profile: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/**
 * Link a Stellar address to the caller's account after they have proven control
 * of it by signing a challenge.
 *
 * The unique constraint on stellar_public_key does the work that a
 * read-then-write check used to attempt and could lose to a race.
 */
export async function linkWallet(stellarPublicKey: string) {
  const caller = await requireCaller();
  if (!isStellarAccount(stellarPublicKey)) {
    throw new Error("Not a Stellar account address.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      stellar_public_key: stellarPublicKey,
      wallet_status: "connected",
      last_login_at: new Date().toISOString(),
    })
    .eq("id", caller.userId);

  if (error) {
    if (error.code === "23505") {
      throw new AuthError("That wallet is already linked to another account.", 403);
    }
    throw new Error(`Could not link wallet: ${error.message}`);
  }

  // On-chain admin status is mirrored into app_metadata, which is the only
  // place a role can live that a user cannot edit.
  await syncAdminClaim(caller.userId, stellarPublicKey);
}

export async function unlinkWallet() {
  const caller = await requireCaller();
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ stellar_public_key: null, wallet_status: "disconnected" })
    .eq("id", caller.userId);

  if (error) throw new Error(`Could not unlink wallet: ${error.message}`);

  // A disconnected wallet cannot be an admin.
  await setAdminClaim(caller.userId, false);
}

/**
 * Mirror on-chain admin status into the caller's JWT claims.
 *
 * The chain is the source of truth; this is a cache so that RLS policies can
 * act on it without a cross-contract call per query.
 */
export async function syncAdminClaim(userId: string, stellarPublicKey: string | null) {
  const isAdmin = stellarPublicKey ? await checkIsAdminOnChain(stellarPublicKey) : false;
  await setAdminClaim(userId, isAdmin);
  return isAdmin;
}

async function setAdminClaim(userId: string, isAdmin: boolean) {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role: isAdmin ? "admin" : "user" },
  });
  if (error) {
    console.error(`[profiles] Could not set admin claim for ${userId}:`, error.message);
  }
}

/** Admin-only: every profile, for the console. */
export async function listProfiles(limit = 200) {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not list profiles: ${error.message}`);
  return data ?? [];
}
