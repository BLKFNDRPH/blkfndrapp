/**
 * Which Stellar network the app is talking to, for the parts of the interface
 * that must say so.
 *
 * Every network except Stellar's public network (Mainnet) is a test network:
 * its XLM and USDC are free to get and impossible to cash out. User-facing
 * copy calls it "Testnet" and this flag decides when that copy shows. Unset
 * means testnet, so a missing build arg can never make a test deployment
 * claim to hold real funds. (The identifier keeps its older "practice" name.)
 *
 * Client-safe: it reads one NEXT_PUBLIC variable and nothing else. The signing
 * clients keep their own passphrase in stellar-clients.ts.
 */
export const IS_PRACTICE_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "public";

/** Base URL of Stellar Expert, the block explorer, for the current network. */
export const EXPLORER_BASE = IS_PRACTICE_NETWORK
  ? "https://stellar.expert/explorer/testnet"
  : "https://stellar.expert/explorer/public";

/** One sentence to use wherever the app links out to the block explorer. */
export const EXPLORER_EXPLAINER =
  "Stellar Expert is an independent block explorer: it reads the same data straight from the Stellar ledger.";
