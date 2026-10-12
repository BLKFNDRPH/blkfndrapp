/**
 * A short-lived, in-process cache for chain reads served to browsers.
 *
 * Browsers used to read the ledger themselves, each from the public Soroban
 * RPC, and each paying a CORS preflight per burst. Reading through our own
 * routes moves every visitor's reads onto this server's address, which shares
 * one rate limit at the RPC, so the routes must not pass every page view
 * straight through. Here, a read is kept for a few seconds and shared, and a
 * read already under way is joined rather than sent again.
 *
 * Only answers are kept: a read that comes back null (the vault could not be
 * reached) is not cached, so the next visitor tries again.
 *
 * Self-contained so node --test can load it.
 */

interface Entry {
  value: unknown;
  expires: number;
}

/** Enough for every vault and then some; the oldest go first past it. */
const MAX_ENTRIES = 500;

const store = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

/** Keep an answer for `ttlMs`, replacing anything older under the same key. */
export function remember(key: string, value: unknown, ttlMs: number, now = Date.now()): void {
  store.delete(key);
  store.set(key, { value, expires: now + ttlMs });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** The kept answer, or undefined when there is none or it has expired. */
export function recall<T>(key: string, now = Date.now()): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export interface CachedReadOptions {
  /** Skip a kept answer and read again. A read already under way is still joined. */
  fresh?: boolean;
}

/**
 * The answer to `read`, from the cache when it is there and recent.
 * Concurrent callers for one key share a single read.
 */
export async function cachedRead<T>(
  key: string,
  ttlMs: number,
  read: () => Promise<T>,
  options: CachedReadOptions = {},
): Promise<T> {
  if (!options.fresh) {
    const kept = recall<T>(key);
    if (kept !== undefined) return kept;
  }

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const started = read()
    .then((value) => {
      if (value !== null && value !== undefined) remember(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, started);
  return started;
}

/** Forget everything. For tests. */
export function clearReadCache(): void {
  store.clear();
  inFlight.clear();
}
