"use client";

import {
  signTransaction as freighterSignTransaction,
  signAuthEntry as freighterSignAuthEntry,
} from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "@/lib/stellar-clients";

/**
 * Freighter signing for the contract clients, with the wallet's answer checked.
 *
 * The SDK reads `signedTxXdr` and `error` off whatever the signer returns, hands
 * the error to a check that only throws for codes -1 to -4, and then passes the
 * signature straight to TransactionBuilder.fromXDR. That parses its argument
 * only when it is a string, so an undefined signature falls through to
 * `envelope.switch()` and the call dies as
 *
 *   TypeError: Cannot read properties of undefined (reading 'switch')
 *
 * which is what a builder saw after a Freighter popup was dismissed. Anything
 * Freighter reports outside those four codes -- and a dismissed or timed-out
 * request, which simply returns no signature at all -- arrived exactly that way:
 * an unreadable crash in place of "you cancelled".
 *
 * So the answer is checked here, before the SDK can misread it. The
 * signAuthEntry half already did this; signTransaction did not, in all four
 * places it was written out.
 */

/** Freighter's error envelope. Codes are its own, not the SDK's. */
interface FreighterError {
  code?: number;
  message?: string;
  ext?: string[];
}

/** No signature came back, and the reason was the person at the keyboard. */
export class FreighterDeclined extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreighterDeclined";
  }
}

export function describeFreighterError(error: FreighterError): string {
  const detail = [error.message, error.ext?.length ? error.ext.join(", ") : null]
    .filter(Boolean)
    .join(" — ");

  switch (error.code) {
    case -4:
      return "You declined the request in Freighter. Nothing has been sent to the network.";
    case -3:
      return `Freighter rejected the request as malformed${detail ? `: ${detail}` : "."}`;
    case -2:
      return `Freighter could not reach a service it needs${detail ? `: ${detail}` : "."}`;
    case -1:
      return `Freighter hit an internal error${detail ? `: ${detail}` : "."}`;
    default:
      return detail || "Freighter could not sign the transaction.";
  }
}

export function freighterSigner(publicKey: string) {
  return {
    signTransaction: async (xdr: string) => {
      const res = await freighterSignTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: publicKey,
      });

      const error = (res as { error?: FreighterError } | undefined)?.error;
      if (error) {
        const message = describeFreighterError(error);
        throw error.code === -4 ? new FreighterDeclined(message) : new Error(message);
      }

      // A dismissed or timed-out popup returns neither a signature nor an
      // error. Left unchecked this is the undefined the SDK crashes on.
      if (!res?.signedTxXdr) {
        throw new FreighterDeclined(
          "Freighter did not return a signed transaction — the request was dismissed or timed out. Nothing has been sent to the network.",
        );
      }

      return { signedTxXdr: res.signedTxXdr, signerAddress: res.signerAddress };
    },

    signAuthEntry: async (xdr: string) => {
      const res = await freighterSignAuthEntry(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: publicKey,
      });

      const error = (res as { error?: FreighterError } | undefined)?.error;
      if (error) {
        const message = describeFreighterError(error);
        throw error.code === -4 ? new FreighterDeclined(message) : new Error(message);
      }

      if (!res?.signedAuthEntry) {
        throw new FreighterDeclined(
          "Freighter did not return a signed authorisation — the request was dismissed or timed out.",
        );
      }

      return { signedAuthEntry: res.signedAuthEntry, signerAddress: res.signerAddress };
    },
  };
}
