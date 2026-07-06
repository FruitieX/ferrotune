/**
 * Unified IndexedDB cache store with LRU eviction.
 *
 * Provides a key-value store for all persistent client-side data:
 * - React Query serialized blob (pinned, never evicted)
 * - Sparse pagination page data (evictable via LRU)
 *
 * Enforces a total size cap (default 100 MB) across all entries.
 * Most entries use per-account isolation via key prefix; device-level entries
 * can opt into the explicit shared prefix.
 */

import { createStore, get, set, del, keys, entries } from "idb-keyval";

/** Maximum total cache size in bytes (100 MB). */
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024;

/** Metadata tracked per cache entry for LRU eviction. */
interface EntryMeta {
  sizeBytes: number;
  lastAccessedMs: number;
  pinned: boolean;
}

/** In-memory metadata index: key → EntryMeta */
let metaMap = new Map<string, EntryMeta>();

/** Current account key prefix for scoping */
let currentAccountPrefix = "";

let cacheInitVersion = 0;

const SHARED_CACHE_PREFIX = "shared:";

/** Dedicated IndexedDB store (separate from idb-keyval default) */
const cacheIdbStore = createStore("ferrotune-cache", "cache-store");

/**
 * Initialize the cache store for a given account.
 * Loads size metadata from IndexedDB so LRU eviction works across sessions.
 */
export async function cacheInit(accountKey: string): Promise<void> {
  const accountPrefix = `${accountKey}:`;
  const initVersion = ++cacheInitVersion;
  currentAccountPrefix = accountPrefix;
  metaMap = new Map();
  const nextMetaMap = new Map<string, EntryMeta>();

  try {
    const allEntries = await entries(cacheIdbStore);
    for (const [key, value] of allEntries) {
      const keyStr = key as string;
      if (
        !keyStr.startsWith(accountPrefix) &&
        !keyStr.startsWith(SHARED_CACHE_PREFIX)
      ) {
        continue;
      }

      const serialized =
        typeof value === "string" ? value : JSON.stringify(value);
      const sizeBytes = new Blob([serialized]).size;
      nextMetaMap.set(keyStr, {
        sizeBytes,
        lastAccessedMs: Date.now(),
        pinned: keyStr.endsWith(":rq-blob"),
      });
    }
  } catch {
    // IndexedDB may be unavailable (e.g. private browsing in some browsers)
  }

  if (
    cacheInitVersion !== initVersion ||
    currentAccountPrefix !== accountPrefix
  ) {
    return;
  }

  for (const [key, meta] of metaMap) {
    if (
      (key.startsWith(accountPrefix) || key.startsWith(SHARED_CACHE_PREFIX)) &&
      !nextMetaMap.has(key)
    ) {
      nextMetaMap.set(key, meta);
    }
  }
  metaMap = nextMetaMap;
}

/** Get total size of all cached entries in bytes. */
export function cacheGetTotalSize(): number {
  let total = 0;
  for (const meta of metaMap.values()) {
    total += meta.sizeBytes;
  }
  return total;
}

/**
 * Evict least-recently-accessed unpinned entries until total size is under
 * the cap minus the size of a pending write.
 */
async function evictIfNeeded(pendingBytes: number): Promise<void> {
  let totalSize = cacheGetTotalSize() + pendingBytes;
  if (totalSize <= MAX_CACHE_SIZE_BYTES) return;

  // Build eviction candidates sorted by lastAccessedMs ascending (oldest first)
  const candidates = [...metaMap.entries()]
    .filter(([, meta]) => !meta.pinned)
    .sort((a, b) => a[1].lastAccessedMs - b[1].lastAccessedMs);

  for (const [key, meta] of candidates) {
    if (totalSize <= MAX_CACHE_SIZE_BYTES) break;
    try {
      await del(key, cacheIdbStore);
    } catch {
      // Ignore individual delete failures
    }
    totalSize -= meta.sizeBytes;
    metaMap.delete(key);
  }
}

function scopedKey(key: string): string {
  return `${currentAccountPrefix}${key}`;
}

function scopedKeyForAccount(accountKey: string, key: string): string {
  return `${accountKey}:${key}`;
}

function sharedKey(key: string): string {
  return `${SHARED_CACHE_PREFIX}${key}`;
}

export interface CacheSetOptions {
  /** If true, entry is never evicted by LRU (use for React Query blob). */
  pinned?: boolean;
}

/** Retrieve a value from the cache. Returns undefined on miss. */
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const fullKey = scopedKey(key);
  return cacheGetByFullKey<T>(fullKey);
}

export async function cacheGetForAccount<T>(
  accountKey: string,
  key: string,
): Promise<T | undefined> {
  return cacheGetByFullKey<T>(scopedKeyForAccount(accountKey, key));
}

export async function cacheGetShared<T>(key: string): Promise<T | undefined> {
  return cacheGetByFullKey<T>(sharedKey(key));
}

async function cacheGetByFullKey<T>(fullKey: string): Promise<T | undefined> {
  try {
    const value = await get<T>(fullKey, cacheIdbStore);
    if (value !== undefined) {
      // Update last accessed time in memory
      const meta = metaMap.get(fullKey);
      if (meta) {
        meta.lastAccessedMs = Date.now();
      }
    }
    return value;
  } catch {
    return undefined;
  }
}

/** Store a value in the cache, evicting old entries if needed. */
export async function cacheSet<T>(
  key: string,
  value: T,
  options?: CacheSetOptions,
): Promise<void> {
  const fullKey = scopedKey(key);
  await cacheSetByFullKey(fullKey, value, options);
}

export async function cacheSetForAccount<T>(
  accountKey: string,
  key: string,
  value: T,
  options?: CacheSetOptions,
): Promise<void> {
  await cacheSetByFullKey(scopedKeyForAccount(accountKey, key), value, options);
}

export async function cacheSetShared<T>(
  key: string,
  value: T,
  options?: CacheSetOptions,
): Promise<void> {
  await cacheSetByFullKey(sharedKey(key), value, options);
}

async function cacheSetByFullKey<T>(
  fullKey: string,
  value: T,
  options?: CacheSetOptions,
): Promise<void> {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const sizeBytes = new Blob([serialized]).size;

  // Remove old size from accounting before eviction check
  const existing = metaMap.get(fullKey);
  if (existing) {
    existing.sizeBytes = 0;
  }

  await evictIfNeeded(sizeBytes);

  try {
    await set(fullKey, value, cacheIdbStore);
    metaMap.set(fullKey, {
      sizeBytes,
      lastAccessedMs: Date.now(),
      pinned: options?.pinned ?? false,
    });
  } catch {
    // IndexedDB write failed — don't crash the app
  }
}

/** Delete a specific key from the cache. */
export async function cacheDel(key: string): Promise<void> {
  const fullKey = scopedKey(key);
  await cacheDelByFullKey(fullKey);
}

export async function cacheDelForAccount(
  accountKey: string,
  key: string,
): Promise<void> {
  await cacheDelByFullKey(scopedKeyForAccount(accountKey, key));
}

async function cacheDelByFullKey(fullKey: string): Promise<void> {
  try {
    await del(fullKey, cacheIdbStore);
  } catch {
    // Ignore
  }
  metaMap.delete(fullKey);
}

/** Delete all keys matching a prefix (scoped to current account). */
export async function cacheDelByPrefix(prefix: string): Promise<void> {
  const fullPrefix = scopedKey(prefix);
  await cacheDelByFullKeyPrefix(fullPrefix);
}

export async function cacheDelByPrefixForAccount(
  accountKey: string,
  prefix: string,
): Promise<void> {
  await cacheDelByFullKeyPrefix(scopedKeyForAccount(accountKey, prefix));
}

export async function cacheDelByPrefixShared(prefix: string): Promise<void> {
  await cacheDelByFullKeyPrefix(sharedKey(prefix));
}

async function cacheDelByFullKeyPrefix(fullPrefix: string): Promise<void> {
  const toDelete: string[] = [];
  for (const key of metaMap.keys()) {
    if (key.startsWith(fullPrefix)) {
      toDelete.push(key);
    }
  }
  await Promise.all(
    toDelete.map(async (key) => {
      try {
        await del(key, cacheIdbStore);
      } catch {
        // Ignore
      }
      metaMap.delete(key);
    }),
  );
}

/** Clear all cache entries for the current account. */
export async function cacheClear(): Promise<void> {
  const toDelete: string[] = [];
  try {
    const allKeys = await keys(cacheIdbStore);
    for (const key of allKeys) {
      const keyStr = key as string;
      if (keyStr.startsWith(currentAccountPrefix)) {
        toDelete.push(keyStr);
      }
    }
  } catch {
    return;
  }
  await Promise.all(
    toDelete.map(async (key) => {
      try {
        await del(key, cacheIdbStore);
      } catch {
        // Ignore
      }
      metaMap.delete(key);
    }),
  );
}
