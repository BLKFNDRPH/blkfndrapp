/**
 * Referral codes and the rule for when a sign-up counts as referred.
 *
 * A code is eight characters from an alphabet without the look-alikes (0/O,
 * 1/I/L), so one read aloud or copied by hand still works. It names an
 * account, nothing more: it carries no reward and moves no money. The campaign
 * counts referred sign-ups (docs/sprint-2/progress.md, "Referred sign-ups").
 *
 * The code travels from the campaign link (`/campaign?ref=CODE`) to sign-up in
 * a first-party cookie, stamped with when it was set. A sign-up is attributed
 * only when the account was created after the link was followed and recently,
 * so following someone's link and then signing in to an account you already
 * had never counts as a referral.
 *
 * Pure, so `npm test` runs it.
 */

/** Crockford-style: no 0, 1, I, L, O. 31 symbols; 8 of them is about 2^39. */
export const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 8;

const CODE_PATTERN = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

/** The cookie that carries a referral code through sign-up. */
export const REF_COOKIE = "blkfndr-ref";
/** Thirty days. */
export const REF_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * How long after an account is created its first sign-in may still attribute
 * it. Email confirmation links last a day; two leaves room for a slow inbox.
 */
export const ATTRIBUTION_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Clock skew allowed between the browser that stamped the cookie and the auth server. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/**
 * A code as someone may have typed or pasted it: trimmed and upper-cased.
 * Null for anything that is not a well-formed code.
 */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return isReferralCode(code) ? code : null;
}

/**
 * A new code from `randomBytes` (crypto.randomBytes on the server). Rejection
 * sampling keeps every symbol equally likely: 31 does not divide 256, so bytes
 * of 248 and above are thrown away rather than folded in.
 */
export function generateReferralCode(randomBytes: (n: number) => Uint8Array): string {
  const limit = 256 - (256 % REFERRAL_ALPHABET.length);
  let out = "";
  while (out.length < REFERRAL_CODE_LENGTH) {
    for (const byte of randomBytes(REFERRAL_CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      out += REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length];
      if (out.length === REFERRAL_CODE_LENGTH) break;
    }
  }
  return out;
}

/** The cookie's value: the code and when it was set, as `CODE.epochMillis`. */
export function encodeRefCookie(code: string, setAt: Date): string {
  return `${code}.${setAt.getTime()}`;
}

export interface RefCookie {
  code: string;
  /** When the link was followed. Null for a cookie with no stamp. */
  setAt: Date | null;
}

export function decodeRefCookie(value: string | null | undefined): RefCookie | null {
  if (!value) return null;
  const [rawCode, rawAt] = value.split(".", 2);
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  const ms = rawAt !== undefined && /^\d{1,15}$/.test(rawAt) ? Number(rawAt) : NaN;
  return { code, setAt: Number.isFinite(ms) ? new Date(ms) : null };
}

export type AttributionDecision =
  | { attribute: true }
  | { attribute: false; reason: "no-code" | "self" | "existing-account" | "before-link" };

/**
 * Whether a sign-in completes a referred sign-up.
 *
 * - The account must be new: created within ATTRIBUTION_WINDOW_MS of now.
 * - When the cookie says when the link was followed, the account must have been
 *   created after that, so an account that predates the link never counts.
 * - Nobody refers themselves.
 *
 * "Once per referred account" is the database's job (unique referred_user_id).
 */
export function decideAttribution(input: {
  code: string | null;
  linkFollowedAt: Date | null;
  accountCreatedAt: Date;
  now: Date;
  referrerId: string | null;
  userId: string;
}): AttributionDecision {
  if (!input.code || !input.referrerId) return { attribute: false, reason: "no-code" };
  if (input.referrerId === input.userId) return { attribute: false, reason: "self" };
  const age = input.now.getTime() - input.accountCreatedAt.getTime();
  if (!Number.isFinite(age) || age > ATTRIBUTION_WINDOW_MS) {
    return { attribute: false, reason: "existing-account" };
  }
  if (
    input.linkFollowedAt &&
    input.accountCreatedAt.getTime() + CLOCK_SKEW_MS < input.linkFollowedAt.getTime()
  ) {
    return { attribute: false, reason: "before-link" };
  }
  return { attribute: true };
}

/** The link a person shares: the campaign page carrying their code. */
export function referralLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/campaign?ref=${encodeURIComponent(code)}`;
}
