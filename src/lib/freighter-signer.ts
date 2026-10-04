"use client";

import {
  signTransaction as freighterSignTransaction,
  signAuthEntry as freighterSignAuthEntry,
} from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "@/lib/stellar-clients";
import { shortenAddress } from "@/lib/utils";

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
  "Your wallet didn't confirm, so the request was cancelled or timed out (a request left open for about five minutes is dropped). " +
  "If a wallet window is still open, close it; approving it now does nothing. " +
  "Nothing was moved or charged.";

/** No signature came back, and the reason was the person at the keyboard. */
export class FreighterDeclined extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreighterDeclined";
  }
}

export function describeFreighterError(error: FreighterError): string {
  // The wallet's own words stay available, but labelled and last: they are for
  // whoever reads a bug report, not for the person deciding what to do next.
  const detail = [error.message, error.ext?.length ? error.ext.join(", ") : null]
    .filter(Boolean)
    .join(" — ");
  const technical = detail ? ` (Technical details: ${detail})` : "";

  switch (error.code) {
    case -4:
      return "You didn't approve it. Nothing was moved or charged.";
    case -3:
      return `Your wallet couldn't read this request. Reload the page and try again. Nothing was moved or charged.${technical}`;
    case -2:
      return `Your wallet couldn't reach the network. Check your connection and try again. Nothing was moved or charged.${technical}`;
    case -1:
      return `Your wallet hit a problem on its side. Unlock it and try again. Nothing was moved or charged.${technical}`;
    default:
      return `Your wallet couldn't confirm this. Try again. Nothing was moved or charged.${technical}`;
  }
}

/**
 * Refuse a signature made by an account other than the one asked for.
 *
 * Every request names its account (`address`). Freighter signs as that account
 * when it holds it, switching to it if another is selected. When it does not
 * hold it, or the switch fails, it signs as whichever account is selected and
 * reports that one as `signerAddress`. The SDK never reads `signerAddress`, so
 * a transaction signed by the wrong account went to the network and was
 * rejected for bad auth after the person had approved it. An auth entry failed
 * inside the SDK as "signature doesn't match payload".
 *
 * Freighter builds that do not report a signer are let through, since there
 * is nothing to compare.
 */
function requireSignedBy(
  publicKey: string,
  signerAddress: string | undefined,
  what: "transaction" | "authorisation",
) {
  if (!signerAddress || signerAddress === publicKey) return;
  throw new Error(
    "Your wallet is using a different account than the one linked here. Switch accounts in your wallet and try again. " +
      "Nothing was moved or charged. " +
      `(Technical details: this ${what} is for ${shortenAddress(publicKey)}; your wallet confirmed as ${shortenAddress(signerAddress)}.)`,
  );
}

export function freighterSigner(publicKey: string) {
  return {
    // The account the transaction is built from, not only the one it is signed
    // with. The contract clients take their source account from this field;
    // without it they simulate from the SDK's placeholder account and
    // signAndSend refuses with "constructed using a default account". When this
    // replaced the hand-written signers it dropped the field, and every
    // contribution, vote, release and treasury action failed before Freighter
    // was ever asked.
    publicKey,
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
      requireSignedBy(publicKey, res.signerAddress, "transaction");

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
          "Your wallet didn't confirm, so the request was cancelled or timed out. " +
            "If a wallet window is still open, close it; approving it now does nothing. Nothing was moved or charged.",
        );
      }
      requireSignedBy(publicKey, res.signerAddress, "authorisation");

      return { signedAuthEntry: res.signedAuthEntry, signerAddress: res.signerAddress };
    },
  };
}
