import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  ATTRIBUTION_WINDOW_MS,
  REFERRAL_ALPHABET,
  decideAttribution,
  decodeRefCookie,
  encodeRefCookie,
  generateReferralCode,
  isReferralCode,
  normalizeReferralCode,
  referralLink,
} from "./referral-code.ts";

test("generated codes are eight symbols from the alphabet, with no look-alikes", () => {
  for (let i = 0; i < 500; i++) {
    const code = generateReferralCode((n) => randomBytes(n));
    assert.equal(code.length, 8);
    assert.ok(isReferralCode(code), code);
    assert.doesNotMatch(code, /[01ILO]/);
  }
});

test("bytes past the last full cycle of the alphabet are skipped, not folded in", () => {
  // 248..255 would bias the first symbols; they must be thrown away.
  let call = 0;
  const code = generateReferralCode((n) => {
    call++;
    return call === 1 ? new Uint8Array(n).fill(255) : new Uint8Array(n).fill(0);
  });
  assert.equal(code, REFERRAL_ALPHABET[0].repeat(8));
  assert.equal(call, 2);
});

test("validation accepts only well-formed codes", () => {
  assert.ok(isReferralCode("ABCD2345"));
  for (const bad of ["abcd2345", "ABCD234", "ABCD23456", "ABCD234O", "ABCD2341", "ABCD 345", "", null, 12345678]) {
    assert.equal(isReferralCode(bad), false, String(bad));
  }
});

test("normalization trims and upper-cases what someone pasted", () => {
  assert.equal(normalizeReferralCode("  abcd2345 "), "ABCD2345");
  assert.equal(normalizeReferralCode("abcd-2345"), null);
  assert.equal(normalizeReferralCode("<script>"), null);
  assert.equal(normalizeReferralCode(undefined), null);
});

test("the cookie round-trips the code and when the link was followed", () => {
  const at = new Date("2026-11-27T10:00:00Z");
  const decoded = decodeRefCookie(encodeRefCookie("ABCD2345", at));
  assert.deepEqual(decoded, { code: "ABCD2345", setAt: at });
  assert.deepEqual(decodeRefCookie("ABCD2345"), { code: "ABCD2345", setAt: null });
  assert.equal(decodeRefCookie("nonsense.123"), null);
  assert.equal(decodeRefCookie(undefined), null);
  assert.deepEqual(decodeRefCookie("ABCD2345.notanumber"), { code: "ABCD2345", setAt: null });
});

const now = new Date("2026-11-27T12:00:00Z");
const base = {
  code: "ABCD2345",
  linkFollowedAt: new Date("2026-11-27T11:00:00Z"),
  accountCreatedAt: new Date("2026-11-27T11:30:00Z"),
  now,
  referrerId: "referrer",
  userId: "newcomer",
};

test("a new account created after following the link is attributed", () => {
  assert.deepEqual(decideAttribution(base), { attribute: true });
});

test("self-referral is refused", () => {
  assert.deepEqual(decideAttribution({ ...base, referrerId: "newcomer" }), { attribute: false, reason: "self" });
});

test("an unknown code attributes nothing", () => {
  assert.deepEqual(decideAttribution({ ...base, referrerId: null }), { attribute: false, reason: "no-code" });
  assert.deepEqual(decideAttribution({ ...base, code: null }), { attribute: false, reason: "no-code" });
});

test("an account that predates the link is not a referred sign-up", () => {
  const d = decideAttribution({ ...base, accountCreatedAt: new Date("2026-11-27T10:00:00Z") });
  assert.deepEqual(d, { attribute: false, reason: "before-link" });
});

test("an old account signing in with a link cookie is not a referred sign-up", () => {
  const d = decideAttribution({
    ...base,
    linkFollowedAt: null,
    accountCreatedAt: new Date(now.getTime() - ATTRIBUTION_WINDOW_MS - 1),
  });
  assert.deepEqual(d, { attribute: false, reason: "existing-account" });
});

test("a confirmation opened on another device (no link time) still counts when the account is new", () => {
  assert.deepEqual(decideAttribution({ ...base, linkFollowedAt: null }), { attribute: true });
});

test("the referral link carries the code on the campaign page", () => {
  assert.equal(referralLink("https://blkfndr.example/", "ABCD2345"), "https://blkfndr.example/campaign?ref=ABCD2345");
});
