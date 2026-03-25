"use client";

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { ClientResponse } from "@/lib/api/generated/ClientResponse";

// ============================================================================
// Persistent atoms (sessionStorage — per tab)
// ============================================================================

/**
 * The current session ID for this tab.
 * Stored in sessionStorage so it survives page refresh.
 * With single-session-per-user, all tabs share the same session ID.
 */
export const currentSessionIdAtom = atomWithStorage<string | null>(
  "ferrotune-session-id",
  null,
  typeof window !== "undefined"
    ? {
        getItem: (key) => {
          const v = sessionStorage.getItem(key);
          return v ? JSON.parse(v) : null;
        },
        setItem: (key, value) =>
          sessionStorage.setItem(key, JSON.stringify(value)),
        removeItem: (key) => sessionStorage.removeItem(key),
      }
    : undefined,
  { getOnInit: true },
);

/**
 * Whether this tab owns audio playback (true) or is a follower (false).
 * Stored in sessionStorage so it survives page refresh.
 */
export const isAudioOwnerAtom = atomWithStorage<boolean>(
  "ferrotune-is-audio-owner",
  true,
  typeof window !== "undefined"
    ? {
        getItem: (key) => {
          const v = sessionStorage.getItem(key);
          return v ? JSON.parse(v) : true;
        },
        setItem: (key, value) =>
          sessionStorage.setItem(key, JSON.stringify(value)),
        removeItem: (key) => sessionStorage.removeItem(key),
      }
    : undefined,
  { getOnInit: true },
);

/**
 * Unique client ID for this tab. Generated once and stored in sessionStorage.
 */
export const clientIdAtom = atomWithStorage<string>(
  "ferrotune-client-id",
  "",
  typeof window !== "undefined"
    ? {
        getItem: (key) => {
          let v = sessionStorage.getItem(key);
          if (!v || v === '""' || v === "null") {
            v = JSON.stringify(crypto.randomUUID());
            sessionStorage.setItem(key, v);
          }
          return JSON.parse(v);
        },
        setItem: (key, value) =>
          sessionStorage.setItem(key, JSON.stringify(value)),
        removeItem: (key) => sessionStorage.removeItem(key),
      }
    : undefined,
  { getOnInit: true },
);

// ============================================================================
// Module-level flags (bypass React closure/timing issues)
// ============================================================================

/**
 * Set when this client initiates a self-takeover (transferToClient targeting
 * itself). Prevents the SSE PlaybackCommand(takeOver) echo and the
 * ownerChanged handler from triggering a redundant fetchQueueAndPlay.
 * Read synchronously by the SSE event handler.
 */
let _selfTakeoverPending = false;
export const selfTakeoverPending = {
  get value() {
    return _selfTakeoverPending;
  },
  set value(v: boolean) {
    _selfTakeoverPending = v;
  },
};

/**
 * Write-only atom that sets the selfTakeoverPending module-level flag.
 * Use this from React components to avoid React Compiler immutability errors.
 */
export const markSelfTakeoverAtom = atom(null, () => {
  _selfTakeoverPending = true;
});

// ============================================================================
// In-memory atoms
// ============================================================================

/**
 * List of connected clients for the current session.
 * Updated via SSE clientListChanged events and periodic refreshes.
 */
export const connectedClientsAtom = atom<ClientResponse[]>([]);

/**
 * The client ID of the current session owner.
 * Updated from server responses and owner change events.
 */
export const ownerClientIdAtom = atom<string | null>(null);

/**
 * The client name (e.g., "ferrotune-web", "ferrotune-mobile") of the current owner.
 */
export const ownerClientNameAtom = atom<string | null>(null);

// ============================================================================
// Derived atoms
// ============================================================================

/**
 * Effective session ID — always the user's single session.
 */
export const effectiveSessionIdAtom = atom<string | null>((get) => {
  return get(currentSessionIdAtom);
});

/**
 * Whether this tab is a follower (not the audio owner).
 */
export const isRemoteControllingAtom = atom<boolean>((get) => {
  return !get(isAudioOwnerAtom);
});

/**
 * Tracks the remote session's playback state (received via SSE positionUpdate events).
 * Used to show correct play/pause state when following.
 */
export interface RemotePlaybackState {
  isPlaying: boolean;
  currentIndex: number;
  positionMs: number;
  /** Timestamp (Date.now()) when this state was received from the server */
  positionTimestamp: number;
  currentSongId?: string;
  currentSongTitle?: string;
  currentSongArtist?: string;
}

export const remotePlaybackStateAtom = atom<RemotePlaybackState | null>(null);

/**
 * Derived: the client name of the session owner.
 * Used to determine capabilities — e.g. whether in-app volume control is available.
 */
export const effectiveSessionClientNameAtom = atom<string | null>((get) => {
  return get(ownerClientNameAtom);
});

/**
 * Derived: whether in-app volume controls should be shown.
 * Volume controls are shown when the session owner is a web client
 * (adjustable in-app volume) and hidden when the owner is a native/mobile
 * client (uses system volume at 100%).
 */
export const shouldShowVolumeAtom = atom<boolean>((get) => {
  const clientName = get(effectiveSessionClientNameAtom);
  if (clientName) return clientName !== "ferrotune-mobile";
  return true;
});

/**
 * Derived: follower indicator info.
 * Returns the owner's display name when we're a follower, null when we're the owner.
 */
export const followerSessionNameAtom = atom<string | null>((get) => {
  const isRemote = get(isRemoteControllingAtom);
  if (!isRemote) return null;
  const ownerClientId = get(ownerClientIdAtom);
  const clients = get(connectedClientsAtom);
  if (!ownerClientId) return null;
  const owner = clients.find((c) => c.clientId === ownerClientId);
  return owner?.displayName ?? null;
});

/**
 * Derived: follower session owner client name.
 * Returns the client name (e.g. "ferrotune-mobile") when following,
 * null when we're the owner.
 */
export const followerSessionClientNameAtom = atom<string | null>((get) => {
  const isRemote = get(isRemoteControllingAtom);
  if (!isRemote) return null;
  return get(ownerClientNameAtom);
});
