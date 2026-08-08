"use client";

import {
  signAuthEntry as signAuthEntryWithFreighter,
  signTransaction as signWithFreighter,
} from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE, type Signer } from "@/lib/stellar-clients";

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
export const signerFor = (publicKey: string): Signer => ({
  publicKey,
  signTransaction: (xdr: string) =>
    signWithFreighter(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    }),
  signAuthEntry: async (xdr: string) => {
    const res = await signAuthEntryWithFreighter(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    });
    if (!res.signedAuthEntry) {
      throw new Error("Freighter returned no signed auth entry.");
    }
    return {
      signedAuthEntry: res.signedAuthEntry,
      signerAddress: res.signerAddress,
    };
  },
});

/** Submit an assembled transaction, refusing one that cannot be signed. */
export async function send(assembled: { signAndSend?: () => Promise<unknown> }) {
  if (!assembled.signAndSend) {
    throw new Error("This transaction cannot be signed and sent.");
  }
  return assembled.signAndSend();
}
