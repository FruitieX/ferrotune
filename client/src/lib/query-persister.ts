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

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => (await get(key)) ?? null,
    setItem: async (key: string, value: string) => {
      await set(key, value);
    },
    removeItem: async (key: string) => {
      await del(key);
    },
  },
  // Throttle writes so rapid query updates don't hammer IndexedDB
  throttleTime: 2000,
});
