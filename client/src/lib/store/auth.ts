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

export interface AuthSessionUpdate {
  sessionExpiresAt?: string;
  urlToken?: string;
  urlTokenExpiresAt?: string;
}

/**
 * Generate a unique key for an account (user identity + server URL).
 */
export function accountKey(account: ServerConnection): string {
  const host = account.serverUrl || "local";
  if (account.userId !== undefined) return `${account.userId}@${host}`;
  if (account.username) return `${account.username}@${host}`;
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
    return url.host;
  } catch {
    return account.serverUrl || "Saved account";
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
  return connection !== null && hasSessionToken(connection);
});

export const authSessionUpdateAtom = atom(
  null,
  (get, set, update: AuthSessionUpdate) => {
    const connection = get(serverConnectionAtom);
    if (!connection) {
      return;
    }

    const updatedConnection = connectionWithAuthSessionUpdate(
      connection,
      update,
    );
    if (updatedConnection !== connection) {
      set(serverConnectionAtom, updatedConnection);
    }

    const key = accountKey(connection);
    set(savedAccountsAtom, (accounts) =>
      accounts.map((account) => {
        if (accountKey(account) !== key) {
          return account;
        }

        const updatedAccount = connectionWithAuthSessionUpdate(account, update);
        if (updatedAccount === account) {
          return account;
        }

        return { ...updatedAccount, label: account.label };
      }),
    );
  },
);

export function hasSessionToken(connection: ServerConnection): boolean {
  return !!connection.sessionToken;
}

export function isSessionExpired(connection: ServerConnection): boolean {
  if (!connection.sessionExpiresAt) {
    return false;
  }

  const expiresAt = Date.parse(connection.sessionExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function connectionWithAuthSessionUpdate(
  connection: ServerConnection,
  update: AuthSessionUpdate,
): ServerConnection {
  const sessionExpiresAt =
    update.sessionExpiresAt !== undefined
      ? update.sessionExpiresAt
      : connection.sessionExpiresAt;
  const urlToken =
    update.urlToken !== undefined ? update.urlToken : connection.urlToken;
  const urlTokenExpiresAt =
    update.urlTokenExpiresAt !== undefined
      ? update.urlTokenExpiresAt
      : connection.urlTokenExpiresAt;

  if (
    sessionExpiresAt === connection.sessionExpiresAt &&
    urlToken === connection.urlToken &&
    urlTokenExpiresAt === connection.urlTokenExpiresAt
  ) {
    return connection;
  }

  return {
    ...connection,
    sessionExpiresAt,
    urlToken,
    urlTokenExpiresAt,
  };
}

// Connection status
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";
export const connectionStatusAtom = atom<ConnectionStatus>("disconnected");
export const connectionErrorAtom = atom<string | null>(null);
