/**
 * Which Stellar network the app is talking to, for the parts of the interface
 * that must say so in plain words.
 *
 * Every network except Stellar's public network is "practice": the dollars on
 * it are free to add and impossible to cash out. The word "testnet" means
 * nothing to most people, so user-facing copy says "practice mode" and this
 * flag decides when that copy shows. Unset means practice, so a missing build
 * arg can never make a test deployment claim to hold real money.
 *
 * Client-safe: it reads one NEXT_PUBLIC variable and nothing else. The signing
 * clients keep their own passphrase in stellar-clients.ts.
 */
export const IS_PRACTICE_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "public";

/** Base URL of the independent ledger viewer for the current network. */
export const EXPLORER_BASE = IS_PRACTICE_NETWORK
  ? "https://stellar.expert/explorer/testnet"
  : "https://stellar.expert/explorer/public";

/** One sentence to use wherever the app links out to the ledger viewer. */
export const EXPLORER_EXPLAINER =
  "An independent website that shows the same entry straight from the Stellar network.";
