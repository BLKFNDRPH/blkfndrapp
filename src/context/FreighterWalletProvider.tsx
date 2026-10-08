"use client";

import { useState, useEffect, type ReactNode } from "react";
import { signMessage } from "@stellar/freighter-api";
import {
  connectFreighterWallet,
  getFreighterAddressIfAvailable,
  isStellarPublicKey,
  WalletConnectError,
  walletNetworkMatches,
  OUR_SIDE_MESSAGE,
  SIGN_IN_EXPIRED_MESSAGE,
  ANOTHER_ACCOUNT_MESSAGE,
  CODE_DECLINED_MESSAGE,
} from "@/lib/freighter-connect";
import { FreighterWalletContext } from "./FreighterWalletContext";

/**
 * "Disconnect for now" is remembered here, per browser. The wallet stays
 * linked to the account on the server; this only stops the app from using it
 * until the person reconnects. Signing out neither sets nor clears it.
 */
const DISCONNECTED_FOR_NOW_KEY = "freighterDisconnected";

async function restoreAddressFromSession(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    if (
      data?.user?.stellarPublicKey &&
      isStellarPublicKey(data.user.stellarPublicKey)
    ) {
      return data.user.stellarPublicKey;
    }
  } catch {
    // Session not available — fall through to extension connect
  }
  return null;
}

function disconnectedForNow(): boolean {
  try {
    return localStorage.getItem(DISCONNECTED_FOR_NOW_KEY) === "true";
  } catch {
    return false;
  }
}

export const FreighterWalletProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  // The address every transaction is built for and signed as. Only this
  // provider sets it. On load it comes from the account's linked wallet, or
  // Freighter's active account when none is linked. After that it changes only
  // when the person connects, links or disconnects.
  const [freighterWalletAddress, setFreighterWalletAddress] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initWallet() {
      // "Disconnect for now" means exactly that: the linked wallet is not
      // picked up again until the person reconnects it. Before, a linked
      // wallet was always restored and the flag was cleared, so a disconnect
      // lasted only until the next page load.
      if (disconnectedForNow()) return;

      const sessionAddress = await restoreAddressFromSession();
      if (cancelled) return;

      if (sessionAddress) {
        setFreighterWalletAddress(sessionAddress);
        return;
      }

      const address = await getFreighterAddressIfAvailable();
      if (!cancelled && address) {
        setFreighterWalletAddress(address);
      }
    }

    initWallet();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop using the wallet in this browser. The link to the account is kept:
  // the person's stakes and votes still belong to that wallet, and the next
  // "Reconnect" picks it straight up. Removing a wallet from an account is a
  // separate action that does not exist in the interface yet; the server route
  // for it stays in place for when it does. Nothing here can fail.
  const disconnectWallet = async () => {
    try {
      localStorage.setItem(DISCONNECTED_FOR_NOW_KEY, "true");
    } catch {
      // Without storage the disconnect lasts for this page only.
    }
    setFreighterWalletAddress(null);
  };

  const login = async () => {
    setError(null);
    try {
      const sessionRes = await fetch("/api/auth/session");
      const sessionData = await sessionRes.json();
      if (!sessionData?.user) {
        throw new Error("Sign in first, then set up your wallet.");
      }

      const result = await connectFreighterWallet();
      if (!result.ok) {
        if (result.detail) {
          console.warn("[Wallet] connect:", result.code, result.detail);
        }
        const connectError = new WalletConnectError(result.code, result.detail);
        setError(connectError.message);
        throw connectError;
      }
      const publicKey = result.address;

      // A wallet left on another network would sign the link code for the
      // wrong one, and every later transaction would fail without saying why.
      // Checked before anything else is asked of the person. A wallet that
      // won't say is let through; the signature step catches it.
      if ((await walletNetworkMatches()) === "mismatch") {
        const networkError = new WalletConnectError("wrong-network");
        setError(networkError.message);
        throw networkError;
      }

      const nonceRes = await fetch("/api/auth/freighter/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey }),
      });
      const { nonce, error: nonceError } = await nonceRes.json();
      if (nonceError || !nonce) {
        console.error("[Wallet] nonce:", nonceError);
        throw new Error(OUR_SIDE_MESSAGE);
      }

      let signaturePayload: string | number[] = "";
      try {
        const signResult = await signMessage(nonce, {
          networkPassphrase: "Test SDF Network ; September 2015",
          address: publicKey,
        });

        const signError = (
          signResult as { error?: { code?: number; message?: string } } | undefined
        )?.error;
        if (signError) {
          throw new WalletConnectError(
            signError.code === -4 ? "declined" : "unavailable",
            signError.message,
          );
        }

        let sigBytes: unknown = signResult;
        if (signResult && typeof signResult === "object") {
          if ("signedMessage" in signResult) {
            sigBytes = signResult.signedMessage;
          } else if ("signature" in signResult) {
            sigBytes = (signResult as { signature: unknown }).signature;
          }
        }

        if (typeof sigBytes === "string") {
          signaturePayload = sigBytes;
        } else if (
          sigBytes instanceof Uint8Array ||
          ArrayBuffer.isView(sigBytes)
        ) {
          signaturePayload = Array.from(
            new Uint8Array(
              sigBytes.buffer,
              sigBytes.byteOffset,
              sigBytes.byteLength,
            ),
          );
        } else if (Array.isArray(sigBytes)) {
          signaturePayload = sigBytes;
        } else if (
          sigBytes &&
          typeof sigBytes === "object" &&
          "data" in sigBytes &&
          Array.isArray((sigBytes as { data: number[] }).data)
        ) {
          signaturePayload = (sigBytes as { data: number[] }).data;
        } else {
          console.error("Unknown signature payload structure:", sigBytes);
          throw new Error("Unknown signature format returned by the wallet.");
        }

        const signerAddress = (signResult as { signerAddress?: string })
          ?.signerAddress;
        if (signerAddress && signerAddress !== publicKey) {
          throw new Error(
            "Your wallet is using a different account than the one linked here. Switch accounts in Freighter and try again.",
          );
        }
      } catch (signErr) {
        console.error("Sign Error:", signErr);
        if (signErr instanceof WalletConnectError && signErr.code === "declined") {
          throw new Error(
            CODE_DECLINED_MESSAGE,
          );
        }
        if (
          signErr instanceof Error &&
          signErr.message.startsWith("Your wallet is using a different account")
        ) {
          throw signErr;
        }
        throw new Error(
          "Your wallet couldn't sign the code. Make sure Freighter is unlocked and on Testnet, then try again. Nothing was moved or charged.",
        );
      }

      const verifyRes = await fetch("/api/auth/freighter/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, signature: signaturePayload, nonce }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.success) {
        console.error("[Wallet] verify:", verifyRes.status, verifyData?.error);
        // The route answers "Unauthorized" when the sign-in is gone, names a
        // wallet already linked to someone else (linkWallet's unique key), and
        // explains a bad challenge or signature in its own words otherwise.
        throw new Error(
          verifyData?.error === "Unauthorized"
            ? SIGN_IN_EXPIRED_MESSAGE
            : /already linked to another account/i.test(String(verifyData?.error ?? ""))
              ? ANOTHER_ACCOUNT_MESSAGE
              : OUR_SIDE_MESSAGE,
        );
      }

      try {
        localStorage.removeItem(DISCONNECTED_FOR_NOW_KEY);
      } catch {
        // Nothing to clear.
      }
      setFreighterWalletAddress(publicKey);
      return publicKey;
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Something went wrong setting up your wallet. Nothing was moved. Try again.";
      setError(errorMessage);
      throw err;
    }
  };

  return (
    <FreighterWalletContext.Provider
      value={{
        freighterWalletAddress,
        error,
        disconnectWallet,
        login,
      }}
    >
      {children}
    </FreighterWalletContext.Provider>
  );
};
