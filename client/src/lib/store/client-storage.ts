import { atom, type WritableAtom } from "jotai";
import { accountKey, serverConnectionAtom } from "./auth";

const STORAGE_PREFIX = "ferrotune-client-preference";
const storageVersionAtom = atom(0);

function getStorageKey(account: string | null, key: string): string {
  return `${STORAGE_PREFIX}:${account ?? "__no_account__"}:${key}`;
}

function readStoredValue<T>(storageKey: string, initialValue: T): T {
  if (typeof window === "undefined") {
    return initialValue;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  if (rawValue === null) {
    return initialValue;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    console.warn(`Failed to parse client preference '${storageKey}':`, error);
    return initialValue;
  }
}

function writeStoredValue<T>(storageKey: string, value: T): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save client preference '${storageKey}':`, error);
  }
}

/**
 * Creates a Jotai atom persisted in localStorage per browser client and account.
 *
 * Use this for UI state that should survive reloads on this device but should
 * not sync between desktop and mobile clients through server preferences.
 */
export function atomWithClientAccountStorage<T>(
  key: string,
  initialValue: T,
): WritableAtom<T, [T | ((prev: T) => T)], void> {
  return atom(
    (get) => {
      const connection = get(serverConnectionAtom);
      get(storageVersionAtom);

      const currentAccountKey = connection ? accountKey(connection) : null;
      return readStoredValue(
        getStorageKey(currentAccountKey, key),
        initialValue,
      );
    },
    (get, set, update: T | ((prev: T) => T)) => {
      const connection = get(serverConnectionAtom);
      const currentAccountKey = connection ? accountKey(connection) : null;
      const storageKey = getStorageKey(currentAccountKey, key);
      const currentValue = readStoredValue(storageKey, initialValue);
      const nextValue =
        typeof update === "function"
          ? (update as (prev: T) => T)(currentValue)
          : update;

      writeStoredValue(storageKey, nextValue);
      set(storageVersionAtom, (version) => version + 1);
    },
  );
}
