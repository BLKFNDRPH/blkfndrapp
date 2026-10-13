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
  /** Fresh until then. */
  expires: number;
  /** Still servable, while a fresh read runs, until then. */
  staleUntil: number;
}

export interface CachedReadOptions {
  /** Skip a kept answer and read again. A read already under way is still joined. */
  fresh?: boolean;
  /**
   * Past its time, keep serving the old answer for this much longer while a
   * fresh read runs in the background, so a caller almost never waits on the
   * source. 0 (the default) waits for the fresh read instead.
   */
  staleMs?: number;
}

/**
 * One cache: answers kept up to their time, at most `maxEntries` of them, the
 * oldest going first past that. Separate caches keep large answers (resized
 * images) from pushing out small, hot ones (vault figures).
 */
export function createReadCache(maxEntries: number) {
  const store = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<unknown>>();

  /** Keep an answer for `ttlMs`, replacing anything older under the same key. */
  function remember(
    key: string,
    value: unknown,
    ttlMs: number,
    now = Date.now(),
    staleMs = 0,
  ): void {
    store.delete(key);
    store.set(key, { value, expires: now + ttlMs, staleUntil: now + ttlMs + staleMs });
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  /** The kept answer, or undefined when there is none or it has expired. */
  function recall<T>(key: string, now = Date.now()): T | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now) {
      if (entry.staleUntil <= now) store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /** The kept answer past its time but still within its stale window, or undefined. */
  function recallStale<T>(key: string, now = Date.now()): T | undefined {
    const entry = store.get(key);
    if (!entry || entry.staleUntil <= now) return undefined;
    return entry.value as T;
  }

  /**
   * The answer to `read`, from the cache when it is there and recent.
   * Concurrent callers for one key share a single read.
   */
  async function cachedRead<T>(
    key: string,
    ttlMs: number,
    read: () => Promise<T>,
    options: CachedReadOptions = {},
  ): Promise<T> {
    const staleMs = options.staleMs ?? 0;
    if (!options.fresh) {
      const kept = recall<T>(key);
      if (kept !== undefined) return kept;
    }

    const pending = inFlight.get(key);
    // Past its time but still within its stale window: answer with the old
    // value now and let the fresh read finish in the background.
    const stale = options.fresh || staleMs === 0 ? undefined : recallStale<T>(key);
    if (pending) return stale !== undefined ? stale : (pending as Promise<T>);

    const started = read()
      .then((value) => {
        if (value !== null && value !== undefined) remember(key, value, ttlMs, Date.now(), staleMs);
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, started);
    if (stale !== undefined) {
      // Nobody awaits this read, so a failure must not go unhandled; the old
      // answer stays until its stale window ends.
      started.catch(() => {});
      return stale;
    }
    return started;
  }

  /** Forget everything. For tests. */
  function clear(): void {
    store.clear();
    inFlight.clear();
  }

  return { remember, recall, cachedRead, clear };
}

/** The chain-read cache: enough for every vault and then some. */
const chainReads = createReadCache(500);

export const remember = chainReads.remember;
export const recall = chainReads.recall;
export const cachedRead = chainReads.cachedRead;
export const clearReadCache = chainReads.clear;
