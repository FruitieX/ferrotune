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
 * Whether we're currently remote-controlling another session,
 * or a follower of a session we don't own.
 */
export const isRemoteControllingAtom = atom<boolean>((get) => {
  const controlling = get(controllingSessionIdAtom);
  const current = get(currentSessionIdAtom);
  const isOwner = get(isAudioOwnerAtom);
  return (controlling !== null && controlling !== current) || !isOwner;
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

/**
 * Derived: the client name of the effective (controlled/followed) session.
 * Used to determine capabilities — e.g. whether in-app volume control is available.
 * Returns null if session not found in the active sessions list.
 */
export const effectiveSessionClientNameAtom = atom<string | null>((get) => {
  const effectiveId = get(effectiveSessionIdAtom);
  const sessions = get(activeSessionsAtom);
  if (!effectiveId) return null;
  const session = sessions.find((s) => s.id === effectiveId);
  return session?.clientName ?? null;
});

/**
 * Derived: whether in-app volume controls should be shown.
 * Volume controls are shown when the session owner is a web client
 * (adjustable in-app volume) and hidden when the owner is a native/mobile
 * client (uses system volume at 100%).
 */
export const shouldShowVolumeAtom = atom<boolean>((get) => {
  const clientName = get(effectiveSessionClientNameAtom);
  // If we have session info, decide based on owner's client type
  if (clientName) return clientName !== "ferrotune-mobile";
  // Fallback: hide on native audio (Android Tauri as owner)
  return true;
});

/**
 * Signal that the next session-change queue fetch should auto-play.
 * Set when taking over a playing session where effectiveSessionId changes.
 */
export const pendingTakeoverPlayAtom = atom(false);

/**
 * Derived: follower session indicator info.
 * Returns the session name when we're a follower (remote controlling),
 * null when we're the owner (no indicator needed).
 */
export const followerSessionNameAtom = atom<string | null>((get) => {
  const isRemote = get(isRemoteControllingAtom);
  if (!isRemote) return null;
  const effectiveId = get(effectiveSessionIdAtom);
  const sessions = get(activeSessionsAtom);
  if (!effectiveId) return null;
  const session = sessions.find((s) => s.id === effectiveId);
  return session?.name ?? null;
});
