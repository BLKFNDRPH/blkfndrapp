import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CLAIM_AMOUNT,
  DEFAULT_DAILY_CAP,
  amountToStroops,
  claimConfig,
  claimEligibility,
  claimGate,
  hasTrustline,
} from "./claim-rules.ts";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_ISSUER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
const DISTRIBUTOR = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";
const USDC = { code: "USDC", issuer: ISSUER };
const open = claimConfig({ CAMPAIGN_USDC_CLAIM_ENABLED: "1" });

test("the claim is closed unless the kill switch is explicitly on", () => {
  assert.equal(claimConfig({}).enabled, false);
  assert.equal(claimConfig({ CAMPAIGN_USDC_CLAIM_ENABLED: "true" }).enabled, false);
  assert.equal(claimConfig({ CAMPAIGN_USDC_CLAIM_ENABLED: "0" }).enabled, false);
  assert.equal(open.enabled, true);
  assert.equal(claimGate({ isTestnet: true, config: claimConfig({}) }), "campaign-closed");
});

test("mainnet is refused before anything else, even with the switch on", () => {
  assert.equal(claimGate({ isTestnet: false, config: open }), "mainnet");
  assert.equal(claimGate({ isTestnet: true, config: open }), null);
});

test("a zero daily cap closes the claim", () => {
  const config = claimConfig({ CAMPAIGN_USDC_CLAIM_ENABLED: "1", CAMPAIGN_USDC_DAILY_CAP: "0" });
  assert.equal(claimGate({ isTestnet: true, config }), "campaign-closed");
});

test("amount and cap fall back to safe defaults on bad input", () => {
  assert.equal(open.amount, DEFAULT_CLAIM_AMOUNT);
  assert.equal(open.dailyCap, DEFAULT_DAILY_CAP);
  for (const bad of ["-5", "0", "abc", "1e6", "5000", "1.12345678"]) {
    assert.equal(claimConfig({ CAMPAIGN_USDC_CLAIM_AMOUNT: bad }).amount, DEFAULT_CLAIM_AMOUNT, bad);
  }
  assert.equal(claimConfig({ CAMPAIGN_USDC_CLAIM_AMOUNT: "25.5" }).amount, "25.5");
  assert.equal(claimConfig({ CAMPAIGN_USDC_DAILY_CAP: "-1" }).dailyCap, DEFAULT_DAILY_CAP);
  assert.equal(claimConfig({ CAMPAIGN_USDC_DAILY_CAP: "200" }).dailyCap, 200);
});

test("amounts convert to stroops exactly", () => {
  assert.equal(amountToStroops("100"), 1_000_000_000n);
  assert.equal(amountToStroops("25.5"), 255_000_000n);
  assert.equal(amountToStroops("0.0000001"), 1n);
});

test("the trustline must be for exactly this asset, issuer included", () => {
  const line = { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER, balance: "0" };
  assert.ok(hasTrustline([{ asset_type: "native" }, line], USDC));
  assert.equal(hasTrustline([{ ...line, asset_issuer: OTHER_ISSUER }], USDC), false);
  assert.equal(hasTrustline([{ asset_type: "native" }], USDC), false);
  assert.equal(hasTrustline([{ ...line, is_authorized: false }], USDC), false);
});

const eligible = {
  linkedWallet: WALLET,
  alreadyClaimed: false,
  balances: [{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER }],
  asset: USDC,
  distributor: DISTRIBUTOR,
};

test("an account with a linked, active wallet holding the trustline is eligible", () => {
  assert.equal(claimEligibility(eligible), null);
});

test("no linked wallet, no claim: there is no other address to pay", () => {
  assert.equal(claimEligibility({ ...eligible, linkedWallet: null }), "no-wallet");
});

test("the distributor never pays itself", () => {
  assert.equal(claimEligibility({ ...eligible, linkedWallet: DISTRIBUTOR }), "no-wallet");
});

test("one claim per account and wallet", () => {
  assert.equal(claimEligibility({ ...eligible, alreadyClaimed: true }), "already-claimed");
});

test("a wallet not on the ledger yet needs Friendbot first", () => {
  assert.equal(claimEligibility({ ...eligible, balances: null }), "no-account");
});

test("a wallet without the USDC trustline gets a clear code", () => {
  assert.equal(claimEligibility({ ...eligible, balances: [{ asset_type: "native" }] }), "no-trustline");
});

test("an unreadable asset refuses rather than guessing", () => {
  assert.equal(claimEligibility({ ...eligible, asset: null }), "unavailable");
});
