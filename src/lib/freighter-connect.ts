import {
  getAddress,
  isAllowed,
  isConnected,
  requestAccess,
  setAllowed,
} from "@stellar/freighter-api";

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;

const EXTERNAL_MSG_REQUEST = "FREIGHTER_EXTERNAL_MSG_REQUEST";
const EXTERNAL_MSG_RESPONSE = "FREIGHTER_EXTERNAL_MSG_RESPONSE";

export function isStellarPublicKey(
  value: string | undefined | null,
): value is string {
  return !!value && STELLAR_PUBLIC_KEY_RE.test(value);
}

type FreighterApiError = { message?: string; code?: number };

function errorMessage(
  error: FreighterApiError | undefined,
  fallback: string,
): string {
  if (error?.message?.trim()) return error.message;
  return fallback;
}

/** Check if Freighter extension is installed and available. */
export function isFreighterInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as Window & {
    freighter?: unknown;
    freighterApi?: unknown;
    stellar?: unknown;
  };
  return !!(win.freighter || win.freighterApi || win.stellar);
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
  { ok: true; address: string } | { ok: false; message: string }
> {
  if (typeof window === "undefined") {
    return { ok: false, message: "Freighter can only be used in the browser." };
  }

  const connected = await isConnected();
  if (connected.error || !connected.isConnected) {
    return {
      ok: false,
      message:
        "Could not detect Freighter in this browser. If you already installed it, make sure the extension is enabled and unlocked, then reload and try again. Otherwise install it at https://freighter.app.",
    };
  }

  const allowed = await isAllowed();
  if (allowed.error) {
    return { ok: false, message: allowed.error.message };
  }

  if (allowed.isAllowed) {
    const addressResult = await getAddress();
    if (addressResult.error) {
      return { ok: false, message: addressResult.error.message };
    }
    if (isStellarPublicKey(addressResult.address)) {
      return { ok: true, address: addressResult.address };
    }
  }

  const accessResult = await requestAccess();
  if (accessResult.error) {
    return { ok: false, message: accessResult.error.message };
  }
  if (isStellarPublicKey(accessResult.address)) {
    return { ok: true, address: accessResult.address };
  }

  return {
    ok: false,
    message:
      "Could not connect to Freighter. Open the Freighter extension, unlock it, select an account, and approve this site under Connected Apps. If you use both localhost and 127.0.0.1, stick to one.",
  };
}
