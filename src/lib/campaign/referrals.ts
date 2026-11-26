import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  REF_COOKIE,
  decideAttribution,
  decodeRefCookie,
  generateReferralCode,
  normalizeReferralCode,
} from "@/lib/campaign/referral-code";

/**
 * Referral codes and referred sign-ups, on the server.
 *
 * Both tables are server-only (20261127100000_campaign_referrals.sql): the
 * service role writes them, and only after the caller has been identified, by
 * requireCaller() in the route or by Supabase's own session exchange in the
 * auth routes. Nothing here takes a user id from a request body.
 */

/** The account's referral code, made the first time it is asked for. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from("referral_codes")
    .select("code")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(`Could not read referral code: ${readError.message}`);
  if (existing?.code) return existing.code;

  // A collision on code (about 1 in 2^39 per pair) or a concurrent first
  // request for the same account (unique user_id) both land here; re-reading
  // settles the second, a new code the first.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode((n) => randomBytes(n));
    const { error } = await admin.from("referral_codes").insert({ user_id: userId, code });
    if (!error) return code;
    if (error.code !== "23505") throw new Error(`Could not create referral code: ${error.message}`);

    const { data: raced } = await admin
      .from("referral_codes")
      .select("code")
      .eq("user_id", userId)
      .maybeSingle();
    if (raced?.code) return raced.code;
  }
  throw new Error("Could not create a unique referral code.");
}

/** How many sign-ups this account has referred. */
export async function referredCount(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("campaign_referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", userId);
  if (error) throw new Error(`Could not count referrals: ${error.message}`);
  return count ?? 0;
}

/**
 * Read the referral code to carry into sign-up: the cookie set by the campaign
 * page, if any. Used by signUpWithPassword to put it in the new account's
 * metadata, so a confirmation link opened on another device still counts.
 */
export async function pendingReferralCode(): Promise<string | null> {
  const store = await cookies();
  return decodeRefCookie(store.get(REF_COOKIE)?.value)?.code ?? null;
}

/**
 * Attribute a just-completed sign-up to whoever referred it, if anyone.
 *
 * Called by /auth/callback and /auth/confirm once Supabase has issued the
 * session, with the user it issued it for. The code comes from the cookie, or,
 * for an email confirmation (`fromSignupMetadata`), from the metadata the
 * sign-up stored. decideAttribution refuses accounts that predate the link,
 * old accounts and self-referral; the unique referred_user_id refuses a second
 * attribution. The cookie is cleared either way, so it is used once.
 *
 * Never throws: a referral that cannot be recorded must not fail a sign-in.
 */
export async function attributeReferral(
  user: Pick<User, "id" | "created_at" | "user_metadata">,
  opts: { fromSignupMetadata?: boolean } = {},
): Promise<void> {
  try {
    const store = await cookies();
    const cookie = decodeRefCookie(store.get(REF_COOKIE)?.value);
    if (cookie) store.delete(REF_COOKIE);

    const metadataCode = opts.fromSignupMetadata
      ? normalizeReferralCode(user.user_metadata?.referral_code)
      : null;
    const code = cookie?.code ?? metadataCode;
    if (!code) return;

    const admin = createAdminClient();
    const { data: owner } = await admin
      .from("referral_codes")
      .select("user_id")
      .eq("code", code)
      .maybeSingle();

    const decision = decideAttribution({
      code,
      linkFollowedAt: cookie?.code === code ? cookie.setAt : null,
      accountCreatedAt: new Date(user.created_at),
      now: new Date(),
      referrerId: owner?.user_id ?? null,
      userId: user.id,
    });
    if (!decision.attribute || !owner) return;

    const { error } = await admin
      .from("campaign_referrals")
      .insert({ referrer_id: owner.user_id, referred_user_id: user.id, code });
    // 23505: this account was already attributed. That is the rule, not a fault.
    if (error && error.code !== "23505") {
      console.error("[campaign] Could not record referral:", error.message);
    }
  } catch (error) {
    console.error("[campaign] Referral attribution failed:", error);
  }
}
