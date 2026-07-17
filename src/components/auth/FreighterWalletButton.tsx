"use client";

import { useFreighterWallet } from "@/context/FreighterWalletContext";

export function FreighterWalletButton() {
  const { freighterWalletAddress, login, disconnectWallet, error } =
    useFreighterWallet();

  const isExtensionNotInstalledError =
    error?.includes("Could not detect Freighter in this browser.") ||
    error?.includes("Freighter did not respond in this browser") ||
    error?.includes("Freighter did not respond in time");

  return (
    <div style={{ padding: "1rem", border: "1px solid #ccc" }}>
      {freighterWalletAddress ? (
        <div>
          <p>
            <strong>Connected Address:</strong> {freighterWalletAddress}
          </p>
          <button onClick={disconnectWallet}>Disconnect</button>
        </div>
      ) : (
        <div>
          <button onClick={login}>Login with Freighter</button>
          {error && (
            <div style={{ marginTop: "0.5rem" }}>
              <p style={{ color: "red", margin: "0.5rem 0" }}>{error}</p>
              {isExtensionNotInstalledError && (
                <a
                  href="https://freighter.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    marginTop: "0.5rem",
                    padding: "0.5rem 1rem",
                    backgroundColor: "#8b0000",
                    color: "white",
                    borderRadius: "4px",
                    textDecoration: "none",
                  }}
                >
                  Install Freighter
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
