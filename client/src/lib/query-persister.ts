import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del } from "idb-keyval";
import { cacheGet, cacheSet, cacheDel } from "@/lib/cache-store";

/**
 * Persists React Query cache to IndexedDB via the unified cache store so the
 * home page and library views can render immediately from cached data on
 * subsequent visits.
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
  "playlistFolders",
  "smartPlaylists",
  "queue",
  "continue-listening",
  "album",
  "artist",
  "smartPlaylist",
]);

/** How long persisted cache entries stay valid (30 days). */
export const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * React Query implements gcTime with timers, and JS runtimes clamp timer
 * durations to a signed 32-bit integer. Keep persisted maxAge at 30 days, but
 * clamp in-memory gcTime so Next.js builds do not emit TimeoutOverflowWarning.
 */
const MAX_TIMER_DURATION_MS = 2_147_483_647;
export const PERSIST_GC_TIME_MS = Math.min(
  PERSIST_MAX_AGE_MS,
  MAX_TIMER_DURATION_MS,
);

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const prefix = queryKey[0];
  return typeof prefix === "string" && PERSISTED_QUERY_PREFIXES.has(prefix);
}

/** Storage adapter backed by the unified cache store (pinned = never LRU-evicted). */
const cacheBackedStorage = {
  getItem: async (key: string) => (await cacheGet<string>(key)) ?? null,
  setItem: async (key: string, value: string) => {
    await cacheSet(key, value, { pinned: true });
  },
  removeItem: async (key: string) => {
    await cacheDel(key);
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
      storage: cacheBackedStorage,
      key: `rq-blob`,
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
