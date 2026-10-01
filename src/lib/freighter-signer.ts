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

/**
 * What to say when Freighter hands back no signature at all.
 *
 * Exported so the launch flow can tell this case apart from an explicit
 * decline: here a Freighter window may still be open, and the person needs to
 * know that approving it now does nothing.
 */
export const NO_SIGNATURE_MESSAGE =
  "Freighter didn't return a signature — the request was cancelled or expired (Freighter drops a request left open for about 5 minutes). " +
  "If a Freighter window is still open, close it: it is no longer connected to this page, and approving it now sends nothing. " +
  "Nothing has been sent to the network.";

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

      // Neither a signature nor an error. Left unchecked this is the undefined
      // the SDK crashes on.
      //
      // The way it happens in practice (QA Trial #3): Freighter's background
      // drops a request that is left open too long -- about five minutes -- and
      // its content script then answers the page with a plain `error` string
      // that freighter-api does not map, so the page gets nothing while the
      // Freighter window stays on screen with Confirm still enabled. That window
      // is orphaned: approving it signs into the void and sends nothing. The
      // message says so, because the window is the first thing people try next.
      if (!res?.signedTxXdr) {
        throw new FreighterDeclined(NO_SIGNATURE_MESSAGE);
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
          "Freighter didn't return a signed authorisation — the request was cancelled or expired. " +
            "If a Freighter window is still open, close it: approving it now sends nothing.",
        );
      }

      return { signedAuthEntry: res.signedAuthEntry, signerAddress: res.signerAddress };
    },
  };
}
