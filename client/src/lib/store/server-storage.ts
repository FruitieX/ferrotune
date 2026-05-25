/**
 * atomWithServerStorage - A Jotai atom that syncs state with the server database.
 *
 * This is a drop-in replacement for atomWithStorage that stores preferences
 * on the server per-user instead of in localStorage.
 *
 * Features:
 * - Stores value in an account-scoped memory cache with immediate updates
 * - Mirrors preferences to the shared IndexedDB cache for fast account switches
 * - Debounces writes to server to avoid excessive API calls
 * - Loads cached state first, then refreshes from the server
 * - Falls back gracefully when offline/unauthenticated
 */

import { atom, type WritableAtom } from "jotai";
import { getClient } from "@/lib/api/client";
import { cacheGetForAccount, cacheSetForAccount } from "@/lib/cache-store";
import { accountKey, serverConnectionAtom } from "./auth";

// Debounce delay for server writes (ms)
const DEBOUNCE_DELAY = 500;
const NO_ACCOUNT_STORAGE_KEY = "__no_account__";
const SERVER_PREFERENCES_CACHE_KEY = "server-preferences";

interface PendingWrite {
  timer: ReturnType<typeof setTimeout>;
  write: () => Promise<void>;
}

interface ServerStorageState {
  pendingWrites: Map<string, PendingWrite>;
  valueCacheByAccount: Map<string, Map<string, unknown>>;
  defaultValues: Map<string, unknown>;
  loadingAccounts: Set<string>;
  loadedAccounts: Set<string>;
  cacheVersion: number;
}

type ServerStorageGlobal = typeof globalThis & {
  __ferrotuneServerStorageState?: ServerStorageState;
};

function getServerStorageState(): ServerStorageState {
  const storageGlobal = globalThis as ServerStorageGlobal;

  storageGlobal.__ferrotuneServerStorageState ??= {
    pendingWrites: new Map(),
    valueCacheByAccount: new Map(),
    defaultValues: new Map(),
    loadingAccounts: new Set(),
    loadedAccounts: new Set(),
    cacheVersion: 0,
  };

  return storageGlobal.__ferrotuneServerStorageState;
}

function getStorageAccountKey(account: string | null | undefined): string {
  return account ?? NO_ACCOUNT_STORAGE_KEY;
}

function getConnectionStorageAccountKey(
  connection: Parameters<typeof accountKey>[0] | null,
): string {
  return connection ? accountKey(connection) : NO_ACCOUNT_STORAGE_KEY;
}

function getScopedPendingWriteKey(account: string, key: string): string {
  return `${account}:${key}`;
}

function ensureAccountCache(
  state: ServerStorageState,
  account: string,
): Map<string, unknown> {
  let cache = state.valueCacheByAccount.get(account);

  if (!cache) {
    cache = new Map();
    state.valueCacheByAccount.set(account, cache);
  }

  for (const [key, defaultValue] of state.defaultValues) {
    if (!cache.has(key)) {
      cache.set(key, defaultValue);
    }
  }

  return cache;
}

function cacheToRecord(cache: Map<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of cache) {
    record[key] = value;
  }
  return record;
}

function applyPreferenceRecord(
  cache: Map<string, unknown>,
  preferences: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(preferences)) {
    cache.set(key, value);
  }
}

async function loadCachedPreferencesForAccount(
  account: string,
): Promise<Record<string, unknown> | undefined> {
  if (account === NO_ACCOUNT_STORAGE_KEY) {
    return undefined;
  }

  return cacheGetForAccount<Record<string, unknown>>(
    account,
    SERVER_PREFERENCES_CACHE_KEY,
  );
}

function persistAccountPreferences(account: string): void {
  if (account === NO_ACCOUNT_STORAGE_KEY) {
    return;
  }

  const state = getServerStorageState();
  const cache = ensureAccountCache(state, account);
  void cacheSetForAccount(
    account,
    SERVER_PREFERENCES_CACHE_KEY,
    cacheToRecord(cache),
    { pinned: true },
  );
}

// Atom to track when all preferences have been loaded from server
export const serverPreferencesLoadedAtom = atom(false);

// Counter to trigger re-renders when cache changes
const cacheVersionAtom = atom(0);

export const refreshServerStorageCacheAtom = atom(null, (_get, set) => {
  const state = getServerStorageState();
  state.cacheVersion++;
  set(cacheVersionAtom, state.cacheVersion);
});

/**
 * Load all preferences from server in a single call
 */
async function loadAllPreferencesFromServer(): Promise<Map<string, unknown>> {
  const client = getClient();
  if (!client) {
    return new Map();
  }

  try {
    const response = await client.getPreferences();
    const prefs = new Map<string, unknown>();

    if (response.preferences) {
      for (const [key, value] of Object.entries(response.preferences)) {
        prefs.set(key, value);
      }
    }

    if (response.accentColor !== undefined) {
      prefs.set("accent-color", response.accentColor);
    }
    if (
      response.customAccentHue !== undefined &&
      response.customAccentHue !== null
    ) {
      prefs.set("custom-accent-hue", response.customAccentHue);
    }
    if (
      response.customAccentLightness !== undefined &&
      response.customAccentLightness !== null
    ) {
      prefs.set("custom-accent-lightness", response.customAccentLightness);
    }
    if (
      response.customAccentChroma !== undefined &&
      response.customAccentChroma !== null
    ) {
      prefs.set("custom-accent-chroma", response.customAccentChroma);
    }

    return prefs;
  } catch (error) {
    console.warn("Failed to load preferences from server:", error);
    return new Map();
  }
}

/**
 * Write a preference to the server with debouncing
 */
function writeToServer<T>(account: string, key: string, value: T): void {
  const client = getClient();
  if (!client) return;

  const { pendingWrites } = getServerStorageState();
  const pendingKey = getScopedPendingWriteKey(account, key);

  // Clear any pending write for this key
  const existing = pendingWrites.get(pendingKey);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const write = async () => {
    await client.setPreference(key, value);
  };

  // Schedule a new write
  const timer = setTimeout(async () => {
    pendingWrites.delete(pendingKey);
    try {
      await write();
    } catch (error) {
      // Error toast is shown by the API client
      console.warn(`Failed to save preference '${key}' to server:`, error);
    }
  }, DEBOUNCE_DELAY);

  pendingWrites.set(pendingKey, { timer, write });
}

/**
 * Creates an atom that syncs with server storage.
 *
 * @param key - Unique key for this preference
 * @param initialValue - Default value before server load
 * @returns A writable atom that syncs with the server
 */
export function atomWithServerStorage<T>(
  key: string,
  initialValue: T,
): WritableAtom<T, [T | ((prev: T) => T)], void> {
  const state = getServerStorageState();

  // Store default value
  state.defaultValues.set(key, initialValue);
  for (const cache of state.valueCacheByAccount.values()) {
    if (!cache.has(key)) {
      cache.set(key, initialValue);
    }
  }

  // Initialize no-account cache with default if not set
  ensureAccountCache(state, NO_ACCOUNT_STORAGE_KEY);

  // Create a simple atom backed by the cache
  const serverAtom = atom(
    (get) => {
      // Subscribe to connection changes to trigger re-render when connection changes
      const connection = get(serverConnectionAtom);
      // Subscribe to cache version to trigger re-render when any value changes
      get(cacheVersionAtom);

      // Return cached value (or default)
      const account = getConnectionStorageAccountKey(connection);
      const cache = ensureAccountCache(getServerStorageState(), account);
      return (cache.get(key) ?? initialValue) as T;
    },
    (get, set, update: T | ((prev: T) => T)) => {
      const state = getServerStorageState();
      const connection = get(serverConnectionAtom);
      const account = getConnectionStorageAccountKey(connection);
      const cache = ensureAccountCache(state, account);
      const currentValue = (cache.get(key) ?? initialValue) as T;
      const newValue =
        typeof update === "function"
          ? (update as (prev: T) => T)(currentValue)
          : update;

      if (Object.is(newValue, currentValue)) {
        return;
      }

      // Update cache immediately (this is the single source of truth)
      cache.set(key, newValue);
      persistAccountPreferences(account);

      // Trigger re-render by incrementing cache version
      state.cacheVersion++;
      set(cacheVersionAtom, state.cacheVersion);

      // Queue server write (debounced)
      if (connection) {
        writeToServer(account, key, newValue);
      }
    },
  );

  return serverAtom as WritableAtom<T, [T | ((prev: T) => T)], void>;
}

/**
 * Load preferences from server and update all atoms.
 * Call this once when the app initializes and has a valid connection.
 */
export async function loadServerPreferences(
  account: string | null | undefined,
  triggerRerender?: () => void,
): Promise<void> {
  const state = getServerStorageState();
  const storageAccount = getStorageAccountKey(account);
  if (
    state.loadingAccounts.has(storageAccount) ||
    state.loadedAccounts.has(storageAccount)
  ) {
    return;
  }

  const client = getClient();
  if (!client) return;

  state.loadingAccounts.add(storageAccount);

  try {
    const accountCache = ensureAccountCache(state, storageAccount);
    const cachedPrefs = await loadCachedPreferencesForAccount(storageAccount);
    if (cachedPrefs) {
      applyPreferenceRecord(accountCache, cachedPrefs);
      if (triggerRerender) {
        triggerRerender();
      }
    }

    const serverPrefs = await loadAllPreferencesFromServer();

    // Update cache with server values
    for (const [key, value] of serverPrefs) {
      accountCache.set(key, value);
    }
    persistAccountPreferences(storageAccount);

    state.loadedAccounts.add(storageAccount);

    // Trigger re-render if callback provided
    if (triggerRerender) {
      triggerRerender();
    }
  } catch (error) {
    console.warn("Failed to load server preferences:", error);
  } finally {
    state.loadingAccounts.delete(storageAccount);
  }
}

/**
 * Force a refresh of all preferences from the server.
 */
export async function refreshServerPreferences(
  account: string | null | undefined,
  triggerRerender?: () => void,
): Promise<void> {
  const storageAccount = getStorageAccountKey(account);
  getServerStorageState().loadedAccounts.delete(storageAccount);
  await loadServerPreferences(account, triggerRerender);
}

/**
 * Reset loading state while preserving account-scoped preference caches.
 * Cached values let account switches show the correct Home/settings state
 * immediately when the user returns to an account in the same client session.
 */
export function resetServerPreferences(): void {
  const state = getServerStorageState();
  state.loadingAccounts.clear();
  state.loadedAccounts.clear();
}

/**
 * Flush any pending writes immediately.
 * Call this before logout or page unload.
 */
export async function flushPendingWrites(): Promise<void> {
  const { pendingWrites } = getServerStorageState();
  const writes: Promise<unknown>[] = [];

  for (const { timer, write } of pendingWrites.values()) {
    clearTimeout(timer);
    writes.push(write());
  }

  pendingWrites.clear();
  await Promise.allSettled(writes);
}

/**
 * Check if preferences have been loaded from server
 */
export function hasLoadedPreferences(): boolean {
  return getServerStorageState().loadedAccounts.size > 0;
}
