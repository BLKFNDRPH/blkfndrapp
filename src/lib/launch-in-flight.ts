/**
 * A launch that was sent but not yet confirmed, remembered across a reload.
 *
 * The page already waits out a launch whose confirmation went wrong before it
 * lets the builder try again (resolveSubmittedLaunch). That wait lived only in
 * memory: reload, or close the tab, and the next press of Launch Campaign knew
 * nothing about the transaction still out there. The duplicate check could not
 * cover for it either, because a reloaded form has a new default deadline, so
 * the same draft pins different metadata and gets a different CID. That is the
 * Trial #3 risk QA kept open: a second vault and a second bond.
 *
 * So the hash is written down the moment the network accepts the transaction,
 * and kept until the network says what became of it.
 */

const KEY = "blkfndr:launch-in-flight";

/**
 * How long a remembered launch is worth asking about. The RPC only keeps a
 * week of transactions, and after that "not found" no longer means "never
 * applied", so an older record is dropped rather than misread.
 */
const ASK_FOR_MS = 6 * 24 * 60 * 60 * 1000;

export interface InFlightLaunch {
  hash: string;
  /** The transaction's maxTime, in ms: after it, it can never be applied. */
  expiresAtMs: number | null;
  /** The builder's address, so another account's launch is not reported. */
  creator: string;
  title: string;
  sentAt: number;
}

export function rememberLaunch(launch: InFlightLaunch): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(launch));
  } catch {
    // Private browsing or storage turned off: the in-page wait still applies.
  }
}

/** The remembered launch, if there is one recent enough to ask about. */
export function recalledLaunch(): InFlightLaunch | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const launch = JSON.parse(raw) as Partial<InFlightLaunch>;
    if (typeof launch?.hash !== "string" || typeof launch.creator !== "string") return null;
    if (typeof launch.sentAt !== "number" || Date.now() - launch.sentAt > ASK_FOR_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return launch as InFlightLaunch;
  } catch {
    return null;
  }
}

/** Forget a launch once its outcome is known. Only that launch, if one is named. */
export function forgetLaunch(hash?: string): void {
  try {
    if (!hash || recalledLaunch()?.hash === hash) localStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up.
  }
}
