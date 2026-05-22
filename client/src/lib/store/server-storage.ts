/**
 * atomWithServerStorage - A Jotai atom that syncs state with the server database.
 *
 * This is a drop-in replacement for atomWithStorage that stores preferences
 * on the server per-user instead of in localStorage.
 *
 * Features:
 * - Stores value in memory with immediate updates (no localStorage)
 * - Debounces writes to server to avoid excessive API calls
 * - Loads initial state from server on first access
 * - Falls back gracefully when offline/unauthenticated
 */

import { atom, type WritableAtom } from "jotai";
import { getClient } from "@/lib/api/client";
import { serverConnectionAtom } from "./auth";

// Debounce delay for server writes (ms)
const DEBOUNCE_DELAY = 500;

interface ServerStorageState {
  pendingWrites: Map<string, ReturnType<typeof setTimeout>>;
  valueCache: Map<string, unknown>;
  defaultValues: Map<string, unknown>;
  isLoadingFromServer: boolean;
  hasLoadedOnce: boolean;
  cacheVersion: number;
}

type ServerStorageGlobal = typeof globalThis & {
  __ferrotuneServerStorageState?: ServerStorageState;
};

function getServerStorageState(): ServerStorageState {
  const storageGlobal = globalThis as ServerStorageGlobal;

  storageGlobal.__ferrotuneServerStorageState ??= {
    pendingWrites: new Map(),
    valueCache: new Map(),
    defaultValues: new Map(),
    isLoadingFromServer: false,
    hasLoadedOnce: false,
    cacheVersion: 0,
  };

  return storageGlobal.__ferrotuneServerStorageState;
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
function writeToServer<T>(key: string, value: T): void {
  const client = getClient();
  if (!client) return;

  const { pendingWrites } = getServerStorageState();

  // Clear any pending write for this key
  const existing = pendingWrites.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // Schedule a new write
  const timer = setTimeout(async () => {
    pendingWrites.delete(key);
    try {
      await client.setPreference(key, value);
    } catch (error) {
      // Error toast is shown by the API client
      console.warn(`Failed to save preference '${key}' to server:`, error);
    }
  }, DEBOUNCE_DELAY);

  pendingWrites.set(key, timer);
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

  // Initialize cache with default if not set
  if (!state.valueCache.has(key)) {
    state.valueCache.set(key, initialValue);
  }

  // Create a simple atom backed by the cache
  const serverAtom = atom(
    (get) => {
      // Subscribe to connection changes to trigger re-render when connection changes
      get(serverConnectionAtom);
      // Subscribe to cache version to trigger re-render when any value changes
      get(cacheVersionAtom);

      // Return cached value (or default)
      return (getServerStorageState().valueCache.get(key) ?? initialValue) as T;
    },
    (get, set, update: T | ((prev: T) => T)) => {
      const state = getServerStorageState();
      const currentValue = (state.valueCache.get(key) ?? initialValue) as T;
      const newValue =
        typeof update === "function"
          ? (update as (prev: T) => T)(currentValue)
          : update;

      if (Object.is(newValue, currentValue)) {
        return;
      }

      // Update cache immediately (this is the single source of truth)
      state.valueCache.set(key, newValue);

      // Trigger re-render by incrementing cache version
      state.cacheVersion++;
      set(cacheVersionAtom, state.cacheVersion);

      // Queue server write (debounced)
      const connection = get(serverConnectionAtom);
      if (connection) {
        writeToServer(key, newValue);
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
  triggerRerender?: () => void,
): Promise<void> {
  const state = getServerStorageState();
  if (state.isLoadingFromServer || state.hasLoadedOnce) return;

  const client = getClient();
  if (!client) return;

  state.isLoadingFromServer = true;

  try {
    const serverPrefs = await loadAllPreferencesFromServer();

    // Update cache with server values
    for (const [key, value] of serverPrefs) {
      state.valueCache.set(key, value);
    }

    state.hasLoadedOnce = true;

    // Trigger re-render if callback provided
    if (triggerRerender) {
      triggerRerender();
    }
  } catch (error) {
    console.warn("Failed to load server preferences:", error);
  } finally {
    state.isLoadingFromServer = false;
  }
}

/**
 * Force a refresh of all preferences from the server.
 */
export async function refreshServerPreferences(
  triggerRerender?: () => void,
): Promise<void> {
  getServerStorageState().hasLoadedOnce = false;
  await loadServerPreferences(triggerRerender);
}

/**
 * Reset preferences state (call on logout)
 */
export function resetServerPreferences(): void {
  const state = getServerStorageState();
  state.hasLoadedOnce = false;
  state.valueCache.clear();

  // Restore defaults
  for (const [key, defaultValue] of state.defaultValues) {
    state.valueCache.set(key, defaultValue);
  }

  // Clear pending writes
  for (const timer of state.pendingWrites.values()) {
    clearTimeout(timer);
  }
  state.pendingWrites.clear();
}

/**
 * Flush any pending writes immediately.
 * Call this before logout or page unload.
 */
export async function flushPendingWrites(): Promise<void> {
  const client = getClient();
  if (!client) return;

  const { pendingWrites, valueCache } = getServerStorageState();
  const writes: Promise<unknown>[] = [];

  for (const [key, timer] of pendingWrites) {
    clearTimeout(timer);
    const value = valueCache.get(key);
    if (value !== undefined) {
      writes.push(client.setPreference(key, value));
    }
  }

  pendingWrites.clear();
  await Promise.allSettled(writes);
}

/**
 * Check if preferences have been loaded from server
 */
export function hasLoadedPreferences(): boolean {
  return getServerStorageState().hasLoadedOnce;
}
