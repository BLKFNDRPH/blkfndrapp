/**
 * Stellar account addresses: base32, 56 chars, starting with G.
 * Base32 alphabet excludes 0, 1, 8, and 9.
 */
const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/;

export function isStellarAccount(value: unknown): value is string {
  return typeof value === "string" && STELLAR_ACCOUNT.test(value);
}

/**
 * Escape a string for safe use inside a RegExp.
 *
 * Event payloads are stored as JSON text and searched with $regex, so an
 * unescaped caller-supplied value is both a correctness bug (".*" matches every
 * row) and a denial-of-service vector (a catastrophic-backtracking pattern run
 * against every document in the collection).
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a safe, anchored regex for finding an address inside a JSON blob.
 * Returns null if the value is not a well-formed Stellar account.
 */
export function addressMatcher(address: string): RegExp | null {
  if (!isStellarAccount(address)) return null;
  return new RegExp(escapeRegExp(address));
}
