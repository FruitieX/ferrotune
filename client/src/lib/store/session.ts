"use client";

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { SessionResponse } from "@/lib/api/generated/SessionResponse";

/**
 * The current active session ID for this tab.
 * Stored in sessionStorage so each tab gets its own session.
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
 * List of all active sessions for the current user.
 * Refreshed periodically and on session list change.
 */
export const activeSessionsAtom = atom<SessionResponse[]>([]);

/**
 * Whether this tab owns audio playback (true) or is a remote controller (false).
 * Defaults to true for the session that was created in this tab.
 */
export const isAudioOwnerAtom = atom(true);

/**
 * The session ID being remote-controlled (if different from currentSessionId).
 * null means we're controlling our own session.
 */
export const controllingSessionIdAtom = atom<string | null>(null);

/**
 * Derived: the effective session ID for queue operations.
 * Uses the controlling session ID if set, otherwise the current session.
 */
export const effectiveSessionIdAtom = atom<string | null>((get) => {
  return get(controllingSessionIdAtom) ?? get(currentSessionIdAtom);
});

/**
 * Whether we're currently remote-controlling another session.
 */
export const isRemoteControllingAtom = atom<boolean>((get) => {
  const controlling = get(controllingSessionIdAtom);
  const current = get(currentSessionIdAtom);
  return controlling !== null && controlling !== current;
});

/**
 * Tracks the remote session's playback state (received via SSE positionUpdate events).
 * Used to show correct play/pause state when remote controlling.
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
