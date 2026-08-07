import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCaller, requireAdmin } from "@/lib/supabase/auth";
import { isStellarAccount } from "@/lib/stellar-address";

/**
 * Platform settings, claim requests, and wallet-link challenges.
 *
 * Replaces the Mongo `platformsettings`, `claimrequests` and `authchallenges`
 * collections. All three are server-side concerns with no browser-facing
 * grants, so every function here uses the service-role client behind an
 * explicit authorization check.
 */

// ── Platform settings ──────────────────────────────────────────────────────

export async function getFeeWalletEmail(): Promise<string> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_settings")
    .select("fee_wallet_email")
    .eq("id", true)
    .maybeSingle();
  return data?.fee_wallet_email ?? "";
}

export async function setFeeWalletEmail(email: string) {
  await requireAdmin();
  const parsed = z.string().trim().email().max(320).parse(email);

  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_settings")
    .update({ fee_wallet_email: parsed })
    .eq("id", true);

  if (error) throw new Error(`Could not save platform settings: ${error.message}`);
}

// ── Claim requests ─────────────────────────────────────────────────────────

export async function createClaimRequest(projectId: string, vaultAddress: string) {
  const caller = await requireCaller();
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("vault_address", vaultAddress)
    .maybeSingle();

  if (!project) throw new Error("Project not found.");

  const { error } = await admin
    .from("claim_requests")
    .upsert(
      { project_id: project.id, requested_by: caller.userId },
      { onConflict: "project_id" },
    );

  if (error) throw new Error(`Could not raise claim request: ${error.message}`);
}

export async function listClaimRequests() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("claim_requests")
    .select("id, project_id, requested_by, created_at")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not list claim requests: ${error.message}`);
  return data ?? [];
}

export async function countClaimRequests(): Promise<number> {
  await requireAdmin();
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("claim_requests")
    .select("id", { count: "exact", head: true });

  if (error) return 0;
  return count ?? 0;
}

export async function deleteClaimRequest(projectId: string) {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("claim_requests").delete().eq("project_id", projectId);
  if (error) throw new Error(`Could not clear claim request: ${error.message}`);
}

// ── Wallet-link challenges ─────────────────────────────────────────────────
//
// Mongo expired these with a TTL index. Postgres has none, so expiry is
// enforced in the query — a nonce past its window simply does not match — and
// the rows are reclaimed opportunistically.

export async function issueChallenge(publicKey: string, nonce: string) {
  if (!isStellarAccount(publicKey)) {
    throw new Error("Not a Stellar account address.");
  }

  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await admin
    .from("auth_challenges")
    .upsert(
      { public_key: publicKey, nonce, expires_at: expiresAt },
      { onConflict: "public_key" },
    );

  if (error) throw new Error(`Could not issue challenge: ${error.message}`);
}

/**
 * Consume a challenge. Returns false if it never existed, does not match, or
 * has expired — the caller cannot tell which, and does not need to.
 */
export async function consumeChallenge(publicKey: string, nonce: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("auth_challenges")
    .select("public_key")
    .eq("public_key", publicKey)
    .eq("nonce", nonce)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!data) return false;

  // Single use: burn it whether or not signature verification later succeeds.
  await admin.from("auth_challenges").delete().eq("public_key", publicKey);
  await admin.rpc("purge_expired_auth_challenges").throwOnError().then(
    () => undefined,
    () => undefined,
  );

  return true;
}
