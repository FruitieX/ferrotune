import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { ServerConnection } from "@/lib/api/types";

// Connection state stored in localStorage
export const serverConnectionAtom = atomWithStorage<ServerConnection | null>(
  "ferrotune-connection",
  null,
);

// Saved accounts for quick switching
export interface SavedAccount extends ServerConnection {
  /** Display label (defaults to username@host) */
  label?: string;
}

export const savedAccountsAtom = atomWithStorage<SavedAccount[]>(
  "ferrotune-saved-accounts",
  [],
);

/**
 * Generate a unique key for an account (username+serverUrl or apiKey+serverUrl)
 */
export function accountKey(account: ServerConnection): string {
  const host = account.serverUrl || "local";
  if (account.username) return `${account.username}@${host}`;
  if (account.apiKey) return `apikey@${host}`;
  return host;
}

/**
 * Generate a display label for an account
 */
export function accountLabel(account: ServerConnection): string {
  if (account.username) {
    try {
      const url = new URL(account.serverUrl);
      return `${account.username}@${url.host}`;
    } catch {
      return account.username;
    }
  }
  try {
    const url = new URL(account.serverUrl);
    return `API Key @ ${url.host}`;
  } catch {
    return "API Key";
  }
}

// Hydration state - tracks whether localStorage has been read
// This is needed because atomWithStorage returns the default value on first render (SSR)
// and only reads from localStorage after hydration
export const isHydratedAtom = atom(false);

// Tracks whether the API client has been initialized
// This is set to true after initializeClient() is called
export const isClientInitializedAtom = atom(false);

// Derived atom for checking if connected (only valid after hydration)
export const isConnectedAtom = atom((get) => {
  const connection = get(serverConnectionAtom);
  return (
    connection !== null &&
    (!!connection.apiKey || (!!connection.username && !!connection.password))
  );
});

// Connection status
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";
export const connectionStatusAtom = atom<ConnectionStatus>("disconnected");
export const connectionErrorAtom = atom<string | null>(null);
