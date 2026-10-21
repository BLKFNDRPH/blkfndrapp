import { createHash } from "node:crypto";

/**
 * What a wallet signs to be linked to a BLKFNDR account (Gate 4 finding M3).
 *
 * It used to sign a bare 64-character hex nonce. Nothing in it said what it
 * was for, so a phishing page could show someone a nonce issued to an
 * attacker's session, call it "verify your wallet", and the signature would
 * link that person's wallet to the attacker's account. Now the text says, in
 * words the wallet shows before signing, which site is asking, which BLKFNDR
 * account the wallet is being linked to, which wallet, which network and until
 * when. The server also keeps the challenge against the account that asked for
 * it (wallet_link_challenges), so only that session can redeem the signature.
 *
 * The signature is SEP-53, as Freighter's signMessage makes it: ed25519 over
 * sha256("Stellar Signed Message:\n" + message).
 *
 * Pure, so `npm test` runs it.
 */

export interface WalletLinkFields {
  /** The site's host, from configuration, e.g. blkfndr.com. */
  domain: string;
  /** The account the wallet is being linked to, as its owner knows it: their email. */
  account: string;
  address: string;
  /** Testnet or Mainnet. */
  network: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

export function buildWalletLinkMessage(f: WalletLinkFields): string {
  return [
    `${f.domain} wants you to link this Stellar wallet to your BLKFNDR account.`,
    "",
    "Only sign if you started this on that site and the account below is yours.",
    "Signing moves no money and costs nothing.",
    "",
    `Account: ${f.account}`,
    `Wallet: ${f.address}`,
    `Network: ${f.network}`,
    `Nonce: ${f.nonce}`,
    `Issued: ${f.issuedAt.toISOString()}`,
    `Expires: ${f.expiresAt.toISOString()}`,
  ].join("\n");
}

/** The SEP-53 digest a wallet signs for `message`. */
export function walletLinkDigest(message: string): Buffer {
  return createHash("sha256").update("Stellar Signed Message:\n" + message, "utf8").digest();
}
