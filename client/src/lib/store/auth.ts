import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { ServerConnection } from "@/lib/api/types";

// Connection state stored in localStorage
export const serverConnectionAtom = atomWithStorage<ServerConnection | null>(
  "ferrotune-connection",
  null
);

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
  return connection !== null && (!!connection.apiKey || (!!connection.username && !!connection.password));
});

// Connection status
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export const connectionStatusAtom = atom<ConnectionStatus>("disconnected");
export const connectionErrorAtom = atom<string | null>(null);
