import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";
// The same constant stellar-clients uses, taken from the SDK directly so this
// module, which AuthContext loads on every page, doesn't pull in every
// contract binding with it.
import { Networks } from "@stellar/stellar-sdk";

const NETWORK_PASSPHRASE = Networks.TESTNET;

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;

export function isStellarPublicKey(
  value: string | undefined | null,
): value is string {
  return !!value && STELLAR_PUBLIC_KEY_RE.test(value);
}

/**
 * Why a connect attempt failed, for the interface to pick a fix from.
 *
 * - `not-detected`: no wallet extension answered. On a computer that means
 *   "install it"; on a phone no extension can exist at all.
 * - `declined`: the person said no in the wallet's own window.
 * - `locked`: the wallet is there but gave no account (locked, or none chosen).
 * - `wrong-network`: the wallet is set to a different network from this app's.
 * - `unavailable`: the wallet errored for a reason of its own.
 */
export type WalletConnectFailure =
  | "not-detected"
  | "declined"
  | "locked"
  | "wrong-network"
  | "unavailable";

/** The plain-language sentence for each failure, one fix each. */
export const WALLET_CONNECT_MESSAGES: Record<WalletConnectFailure, string> = {
  "not-detected":
    "We can't see your wallet yet. Make sure it's installed and unlocked, then try again.",
  declined:
    "You didn't allow this site in your wallet. Nothing happened. Allow it to continue.",
  locked:
    "Your wallet is locked or has no account chosen. Unlock it, pick an account, then try again.",
  "wrong-network":
    "Your wallet is on the main network. Switch it to the test network in its settings, then try again.",
  unavailable:
    "Your wallet didn't respond. Make sure it's unlocked, then try again.",
};

/**
 * Whether the wallet is set to this app's network: "match", "mismatch", or
 * null when the wallet won't say (not installed, or not allowed yet).
 *
 * A wallet left on the main network signs the link code for the wrong network
 * and every later transaction fails; QA met it as an unexplained error. The
 * setup flow checks before asking for anything.
 */
export async function walletNetworkMatches(): Promise<"match" | "mismatch" | null> {
  if (typeof window === "undefined") return null;
  try {
    const result = await getNetwork();
    if (result.error || !result.networkPassphrase) return null;
    return result.networkPassphrase === NETWORK_PASSPHRASE ? "match" : "mismatch";
  } catch {
    return null;
  }
}

/** Whether a wallet extension answers at all, for the setup flow's "Looking for it…". */
export async function walletInstalled(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const result = await isConnected();
    return !result.error && Boolean(result.isConnected);
  } catch {
    return false;
  }
}

/** Our side failed, not the person's. One sentence, the same everywhere. */
export const OUR_SIDE_MESSAGE =
  "We couldn't finish setting up (our side, not yours). Nothing was moved. Try again in a moment.";

/** The sign-in went away between starting and finishing the link. */
export const SIGN_IN_EXPIRED_MESSAGE = "Your sign-in expired. Sign in again and we'll pick up here.";

/** The wallet is already linked to a different BLKFNDR account. */
export const ANOTHER_ACCOUNT_MESSAGE =
  "This wallet is already set up on another BLKFNDR account (signed in with a different email). Sign in to that account, or create a new wallet for this one.";

/** The person turned down the one-time code in their wallet. */
export const CODE_DECLINED_MESSAGE =
  "You didn't approve the code, so the wallet isn't set up yet. Nothing was moved or charged.";

/** A connect failure with its code attached, so screens can branch on it. */
export class WalletConnectError extends Error {
  code: WalletConnectFailure;
  /** The wallet's own words, for Technical details and the console only. */
  detail?: string;

  constructor(code: WalletConnectFailure, detail?: string) {
    super(WALLET_CONNECT_MESSAGES[code]);
    this.name = "WalletConnectError";
    this.code = code;
    this.detail = detail;
  }
}

/** True when an error thrown by a connect attempt says no wallet was found. */
export function isWalletNotDetected(err: unknown): boolean {
  return err instanceof WalletConnectError && err.code === "not-detected";
}

/** Freighter's error envelope; -4 is the person declining. */
interface FreighterApiError {
  code?: number;
  message?: string;
}

function classify(error: FreighterApiError): WalletConnectFailure {
  if (error.code === -4) return "declined";
  const text = (error.message ?? "").toLowerCase();
  if (text.includes("declin") || text.includes("reject") || text.includes("denied")) {
    return "declined";
  }
  if (text.includes("lock")) return "locked";
  return "unavailable";
}

export async function getFreighterAddressIfAvailable(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const connected = await isConnected();
  if (connected.error || !connected.isConnected) {
    return null;
  }

  const allowed = await isAllowed();
  if (allowed.error || !allowed.isAllowed) {
    return null;
  }

  const addressResult = await getAddress();
  if (!addressResult.error && isStellarPublicKey(addressResult.address)) {
    return addressResult.address;
  }

  return null;
}

/**
 * Connect to Freighter and return the active public key.
 * Never uses isConnected() as a hard gate — it often false-negatives when the
 * extension is installed but still initializing.
 */
export async function connectFreighterWallet(): Promise<
  | { ok: true; address: string }
  | { ok: false; code: WalletConnectFailure; message: string; detail?: string }
> {
  if (typeof window === "undefined") {
    return {
      ok: false,
      code: "unavailable",
      message: "Your wallet can only be set up from a web browser.",
    };
  }

  const connected = await isConnected();
  if (connected.error || !connected.isConnected) {
    return {
      ok: false,
      code: "not-detected",
      message: WALLET_CONNECT_MESSAGES["not-detected"],
      detail: connected.error?.message,
    };
  }

  const allowed = await isAllowed();
  if (allowed.error) {
    const code = classify(allowed.error);
    return {
      ok: false,
      code,
      message: WALLET_CONNECT_MESSAGES[code],
      detail: allowed.error.message,
    };
  }

  if (allowed.isAllowed) {
    const addressResult = await getAddress();
    if (addressResult.error) {
      const code = classify(addressResult.error);
      return {
        ok: false,
        code,
        message: WALLET_CONNECT_MESSAGES[code],
        detail: addressResult.error.message,
      };
    }
    if (isStellarPublicKey(addressResult.address)) {
      return { ok: true, address: addressResult.address };
    }
  }

  const accessResult = await requestAccess();
  if (accessResult.error) {
    const code = classify(accessResult.error);
    return {
      ok: false,
      code,
      message: WALLET_CONNECT_MESSAGES[code],
      detail: accessResult.error.message,
    };
  }
  if (isStellarPublicKey(accessResult.address)) {
    return { ok: true, address: accessResult.address };
  }

  return {
    ok: false,
    code: "locked",
    message: WALLET_CONNECT_MESSAGES.locked,
  };
}
