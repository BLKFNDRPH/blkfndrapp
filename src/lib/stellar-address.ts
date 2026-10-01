/**
 * Stellar account addresses: base32, 56 chars, starting with G.
 * Base32 alphabet excludes 0, 1, 8, and 9.
 */
const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/;

export function isStellarAccount(value: unknown): value is string {
  return typeof value === "string" && STELLAR_ACCOUNT.test(value);
}
