/**
 * Which Stellar network the app is talking to: the one place that decides it.
 *
 * Every network except Stellar's public network (Mainnet) is a test network:
 * its XLM and USDC are free to get and impossible to cash out. User-facing
 * copy calls it "Testnet" and this flag decides when that copy shows. Unset
 * means testnet, so a missing build arg can never make a test deployment
 * claim to hold real funds. (The identifier keeps its older "practice" name.)
 *
 * The passphrase, the endpoints and the wallet checks all follow the same
 * flag, so connecting, linking and signing can never disagree about the
 * network. Nothing else in src should spell out a passphrase or a network URL.
 *
 * Client-safe: it reads NEXT_PUBLIC variables and nothing else, and imports
 * nothing, so it costs a page nothing to load. next.config.js refuses to build
 * a Mainnet bundle without an RPC endpoint, or one whose endpoints name the
 * other network.
 */
export const IS_PRACTICE_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "public";

/** The network's name in copy: "Your wallet is on Mainnet. Switch it to Testnet". */
export const NETWORK_NAME = IS_PRACTICE_NETWORK ? "Testnet" : "Mainnet";

/** The network a wrongly set wallet is most likely on instead. */
export const OTHER_NETWORK_NAME = IS_PRACTICE_NETWORK ? "Mainnet" : "Testnet";

/**
 * The passphrase every transaction and signed message names its network by,
 * and the one Freighter reports for its own. These are the SDK's
 * Networks.TESTNET and Networks.PUBLIC, written out because the SDK's browser
 * build is one bundle with nothing to tree-shake.
 */
export const NETWORK_PASSPHRASE = IS_PRACTICE_NETWORK
  ? "Test SDF Network ; September 2015"
  : "Public Global Stellar Network ; September 2015";

/**
 * Soroban RPC. Testnet falls back to SDF's public endpoint. Mainnet has no
 * SDF endpoint to fall back to, so it must be set (the build fails without it).
 */
export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  (IS_PRACTICE_NETWORK ? "https://soroban-testnet.stellar.org" : "");

/** Horizon, which SDF runs for both networks. */
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  (IS_PRACTICE_NETWORK ? "https://horizon-testnet.stellar.org" : "https://horizon.stellar.org");

/** Friendbot, Testnet's faucet. Mainnet has none, so it is null there. */
export const FRIENDBOT_URL = IS_PRACTICE_NETWORK ? "https://friendbot.stellar.org" : null;

/** Base URL of Stellar Expert, the block explorer, for the current network. */
export const EXPLORER_BASE = IS_PRACTICE_NETWORK
  ? "https://stellar.expert/explorer/testnet"
  : "https://stellar.expert/explorer/public";

/** One sentence to use wherever the app links out to the block explorer. */
export const EXPLORER_EXPLAINER =
  "Stellar Expert is an independent block explorer: it reads the same data straight from the Stellar ledger.";
