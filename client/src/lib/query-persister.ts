import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";

/**
 * Persists React Query cache to IndexedDB so the home page and library
 * views can render immediately from cached data on subsequent visits.
 *
 * Only queries whose first key segment is in PERSISTED_QUERY_PREFIXES
 * are written to disk; everything else stays in-memory only.
 */

/** Query key prefixes worth persisting across sessions. */
const PERSISTED_QUERY_PREFIXES = new Set([
  "albums",
  "songs",
  "playlists",
  "artists",
  "sidebar",
]);

/** How long persisted cache entries stay valid (24 hours). */
export const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24;

/**
 * gcTime must be >= maxAge so React Query keeps the data in memory
 * long enough for the persister to restore it on next load.
 */
export const PERSIST_GC_TIME_MS = PERSIST_MAX_AGE_MS;

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const prefix = queryKey[0];
  return typeof prefix === "string" && PERSISTED_QUERY_PREFIXES.has(prefix);
}

const idbStorage = {
  getItem: async (key: string) => (await get(key)) ?? null,
  setItem: async (key: string, value: string) => {
    await set(key, value);
  },
  removeItem: async (key: string) => {
    await del(key);
  },
};

const persisterCache = new Map<
  string,
  ReturnType<typeof createAsyncStoragePersister>
>();

/**
 * Returns a per-account IndexedDB persister so each account keeps its own
 * cache. Persisters are cached by account key for reuse.
 */
export function getAccountPersister(accountKeyStr: string) {
  let persister = persisterCache.get(accountKeyStr);
  if (!persister) {
    persister = createAsyncStoragePersister({
      storage: idbStorage,
      key: `REACT_QUERY_CACHE_${accountKeyStr}`,
      throttleTime: 2000,
    });
    persisterCache.set(accountKeyStr, persister);
  }
  return persister;
}

/**
 * Remove the legacy unified cache key that was used before per-account
 * persistence was introduced. Safe to call multiple times (no-op if missing).
 */
export function cleanupLegacyCache() {
  del("REACT_QUERY_OFFLINE_CACHE").catch(() => {});
}
