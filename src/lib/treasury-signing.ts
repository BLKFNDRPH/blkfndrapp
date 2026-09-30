"use client";

import { type Signer } from "@/lib/stellar-clients";
import { freighterSigner } from "@/lib/freighter-signer";

/**
 * Signing for the treasury, which use-stellar-contract does not cover.
 *
 * That hook builds clients for the five contracts whose addresses come from
 * configuration. The treasury's address comes from the factory instead — it is
 * wherever fees are currently sent — so its client is constructed per call and
 * needs its own signer rather than a bound one.
 *
 * Shared between the vault and governance panels so there is one definition of
 * how a treasury transaction gets signed. Two copies would be two places to get
 * the network passphrase wrong, and a transaction signed for the wrong network
 * fails in a way that looks like a rejected signature.
 */
// Signing goes through freighterSigner, which checks what the wallet actually
// returned. Passing Freighter's raw result to the SDK meant a dismissed popup
// surfaced as "Cannot read properties of undefined (reading 'switch')".
export const signerFor = (publicKey: string): Signer => freighterSigner(publicKey);

/** Submit an assembled transaction, refusing one that cannot be signed. */
export async function send(assembled: { signAndSend?: () => Promise<unknown> }) {
  if (!assembled.signAndSend) {
    throw new Error("This transaction cannot be signed and sent.");
  }
  return assembled.signAndSend();
}
