import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { randomBytes } from "node:crypto";
import { isStellarAccount } from "@/lib/stellar-address";
import { NETWORK_NAME } from "@/lib/network";
import { buildWalletLinkMessage } from "@/lib/wallet-link-message";

/**
 * Platform settings and wallet-link challenges.
 *
 * Replaces the Mongo `platformsettings` and `authchallenges` collections. Both
 * are server-side concerns with no browser-facing grants, so every function
 * here uses the service-role client behind an explicit authorization check.
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

// ── Wallet-link challenges ─────────────────────────────────────────────────
//
// One per account, kept against the account that asked for it (Gate 4 M3).
// They used to be keyed by wallet address alone, so any signed-in user could
// request, or overwrite, the challenge for anyone's wallet, and whichever
// session sent the signature back got the link. The signed text is now
// buildWalletLinkMessage's, which names the site and the account, and the
// stored copy is what the signature is checked against.
//
// Postgres has no TTL index, so expiry is enforced in the query (a challenge
// past its window simply does not match) and old rows are reclaimed on use.

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function issueWalletLinkChallenge(input: {
  userId: string;
  account: string;
  publicKey: string;
  domain: string;
}): Promise<{ nonce: string; message: string }> {
  if (!isStellarAccount(input.publicKey)) {
    throw new Error("Not a Stellar account address.");
  }

  const nonce = randomBytes(32).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = buildWalletLinkMessage({
    domain: input.domain,
    account: input.account,
    address: input.publicKey,
    network: NETWORK_NAME,
    nonce,
    issuedAt,
    expiresAt,
  });

  // Replaces this account's previous challenge, never anyone else's.
  const { error } = await createAdminClient()
    .from("wallet_link_challenges")
    .upsert(
      {
        user_id: input.userId,
        public_key: input.publicKey,
        nonce,
        message,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) throw new Error(`Could not issue challenge: ${error.message}`);
  return { nonce, message };
}

/**
 * Consume the caller's challenge. Returns the message the wallet should have
 * signed, or null if there is none for this account, wallet and nonce, or it
 * has expired; the caller cannot tell which, and does not need to.
 */
export async function consumeWalletLinkChallenge(
  userId: string,
  publicKey: string,
  nonce: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data } = await admin
    .from("wallet_link_challenges")
    .select("message")
    .eq("user_id", userId)
    .eq("public_key", publicKey)
    .eq("nonce", nonce)
    .gt("expires_at", now)
    .maybeSingle();

  if (!data) return null;

  // Single use: burn it whether or not the signature then checks out.
  await admin.from("wallet_link_challenges").delete().eq("user_id", userId);
  await admin.from("wallet_link_challenges").delete().lt("expires_at", now);

  return data.message;
}
