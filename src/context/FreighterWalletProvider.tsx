"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { signMessage } from "@stellar/freighter-api";
import {
  connectFreighterWallet,
  getFreighterAddressIfAvailable,
  isStellarPublicKey,
} from "@/lib/freighter-connect";
import { FreighterWalletContext } from "./FreighterWalletContext";

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

export const FreighterWalletProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [freighterWalletAddress, setFreighterWalletAddress] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const syncAddress = useCallback((address: string | null) => {
    if (address && isStellarPublicKey(address)) {
      setFreighterWalletAddress(address);
    } else if (address === null) {
      setFreighterWalletAddress(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initWallet() {
      const sessionAddress = await restoreAddressFromSession();
      if (cancelled) return;

      if (sessionAddress) {
        localStorage.removeItem("freighterDisconnected");
        setFreighterWalletAddress(sessionAddress);
        return;
      }

      if (localStorage.getItem("freighterDisconnected") === "true") return;

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

  const connectWallet = async () => {
    setError(null);
    const result = await connectFreighterWallet();
    if (!result.ok) {
      setError(result.message);
      throw new Error(result.message);
    }
    localStorage.removeItem("freighterDisconnected");
    setFreighterWalletAddress(result.address);
  };

  const disconnectWallet = async () => {
    localStorage.setItem("freighterDisconnected", "true");
    setFreighterWalletAddress(null);
    try {
      await fetch("/api/auth/freighter/disconnect", { method: "POST" });
    } catch (err) {
      console.error("Failed to disconnect freighter wallet on backend:", err);
    }
  };

  const login = async () => {
    setError(null);
    try {
      const sessionRes = await fetch("/api/auth/session");
      const sessionData = await sessionRes.json();
      if (!sessionData?.user) {
        throw new Error("Must be logged in with Google to connect a wallet.");
      }

      const result = await connectFreighterWallet();
      if (!result.ok) {
        setError(result.message);
        throw new Error(result.message);
      }
      const publicKey = result.address;

      const nonceRes = await fetch("/api/auth/freighter/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey }),
      });
      const { nonce, error: nonceError } = await nonceRes.json();
      if (nonceError || !nonce) {
        throw new Error(nonceError || "Failed to fetch nonce");
      }

      let signaturePayload: string | number[] = "";
      try {
        const signResult = await signMessage(nonce, {
          networkPassphrase: "Test SDF Network ; September 2015",
          address: publicKey,
        });

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
          throw new Error("Unknown signature format returned by Freighter.");
        }
      } catch (signErr) {
        console.error("Sign Error:", signErr);
        throw new Error(
          "Failed to sign the authentication message. Did you reject the request in Freighter?",
        );
      }

      const verifyRes = await fetch("/api/auth/freighter/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, signature: signaturePayload, nonce }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.success) {
        throw new Error(verifyData.error || "Failed to verify signature");
      }

      localStorage.removeItem("freighterDisconnected");
      setFreighterWalletAddress(publicKey);
      return publicKey;
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "An unknown error occurred during login.";
      setError(errorMessage);
      throw err;
    }
  };

  return (
    <FreighterWalletContext.Provider
      value={{
        freighterWalletAddress,
        error,
        connectWallet,
        disconnectWallet,
        login,
        syncAddress,
      }}
    >
      {children}
    </FreighterWalletContext.Provider>
  );
};
