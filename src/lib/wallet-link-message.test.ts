import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import { buildWalletLinkMessage, walletLinkDigest, type WalletLinkFields } from "./wallet-link-message.ts";

const wallet = Keypair.random();
const fields: WalletLinkFields = {
  domain: "testnetv2.blkfndr.com",
  account: "person@example.test",
  address: wallet.publicKey(),
  network: "Testnet",
  nonce: "ab".repeat(32),
  issuedAt: new Date("2026-10-15T15:00:00.000Z"),
  expiresAt: new Date("2026-10-15T15:05:00.000Z"),
};

test("the message names the site, the account, the wallet, the network and the window", () => {
  const message = buildWalletLinkMessage(fields);
  assert.match(message, /^testnetv2\.blkfndr\.com wants you to link this Stellar wallet to your BLKFNDR account\./);
  assert.match(message, /\nAccount: person@example\.test\n/);
  assert.match(message, new RegExp(`\\nWallet: ${fields.address}\\n`));
  assert.match(message, /\nNetwork: Testnet\n/);
  assert.match(message, /\nNonce: (ab){32}\n/);
  assert.match(message, /\nIssued: 2026-10-15T15:00:00\.000Z\nExpires: 2026-10-15T15:05:00\.000Z$/);
});

test("a signature over the message verifies against the message, as the server checks it", () => {
  const message = buildWalletLinkMessage(fields);
  const signature = wallet.sign(walletLinkDigest(message));
  assert.equal(Keypair.fromPublicKey(fields.address).verify(walletLinkDigest(message), signature), true);
});

test("a signature over the bare nonce, or over another account's message, does not", () => {
  const message = buildWalletLinkMessage(fields);
  const overNonce = wallet.sign(walletLinkDigest(fields.nonce));
  const overOther = wallet.sign(walletLinkDigest(buildWalletLinkMessage({ ...fields, account: "attacker@example.test" })));
  const verifier = Keypair.fromPublicKey(fields.address);
  assert.equal(verifier.verify(walletLinkDigest(message), overNonce), false);
  assert.equal(verifier.verify(walletLinkDigest(message), overOther), false);
});
