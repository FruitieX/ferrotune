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

// Track pending writes and debounce timers
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

// In-memory cache of current values (single source of truth)
const valueCache = new Map<string, unknown>();

// Store default values for keys
const defaultValues = new Map<string, unknown>();

// Atom to track when all preferences have been loaded from server
export const serverPreferencesLoadedAtom = atom(false);

// Flag to prevent duplicate loads
let isLoadingFromServer = false;
let hasLoadedOnce = false;

// Counter to trigger re-renders when cache changes
let cacheVersion = 0;
const cacheVersionAtom = atom(0);

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
  // Store default value
  defaultValues.set(key, initialValue);

  // Initialize cache with default if not set
  if (!valueCache.has(key)) {
    valueCache.set(key, initialValue);
  }

  // Create a simple atom backed by the cache
  const serverAtom = atom(
    (get) => {
      // Subscribe to connection changes to trigger re-render when connection changes
      get(serverConnectionAtom);
      // Subscribe to cache version to trigger re-render when any value changes
      get(cacheVersionAtom);

      // Return cached value (or default)
      return (valueCache.get(key) ?? initialValue) as T;
    },
    (get, set, update: T | ((prev: T) => T)) => {
      const currentValue = (valueCache.get(key) ?? initialValue) as T;
      const newValue =
        typeof update === "function"
          ? (update as (prev: T) => T)(currentValue)
          : update;

      // Update cache immediately (this is the single source of truth)
      valueCache.set(key, newValue);

      // Trigger re-render by incrementing cache version
      cacheVersion++;
      set(cacheVersionAtom, cacheVersion);

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
  if (isLoadingFromServer || hasLoadedOnce) return;

  const client = getClient();
  if (!client) return;

  isLoadingFromServer = true;

  try {
    const serverPrefs = await loadAllPreferencesFromServer();

    // Update cache with server values
    for (const [key, value] of serverPrefs) {
      valueCache.set(key, value);
    }

    hasLoadedOnce = true;

    // Trigger re-render if callback provided
    if (triggerRerender) {
      triggerRerender();
    }
  } catch (error) {
    console.warn("Failed to load server preferences:", error);
  } finally {
    isLoadingFromServer = false;
  }
}

/**
 * Force a refresh of all preferences from the server.
 */
export async function refreshServerPreferences(
  triggerRerender?: () => void,
): Promise<void> {
  hasLoadedOnce = false;
  await loadServerPreferences(triggerRerender);
}

/**
 * Reset preferences state (call on logout)
 */
export function resetServerPreferences(): void {
  hasLoadedOnce = false;
  valueCache.clear();

  // Restore defaults
  for (const [key, defaultValue] of defaultValues) {
    valueCache.set(key, defaultValue);
  }

  // Clear pending writes
  for (const timer of pendingWrites.values()) {
    clearTimeout(timer);
  }
  pendingWrites.clear();
}

/**
 * Flush any pending writes immediately.
 * Call this before logout or page unload.
 */
export async function flushPendingWrites(): Promise<void> {
  const client = getClient();
  if (!client) return;

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
  return hasLoadedOnce;
}
