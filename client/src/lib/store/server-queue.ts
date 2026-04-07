/**
 * Server-Side Queue Store
 *
 * This module manages the playback queue using server-side state.
 * The server is the source of truth for:
 * - Queue contents and order
 * - Current position
 * - Shuffle state and indices
 * - Repeat mode
 *
 * The client fetches windows of songs around the current position
 * for virtualized rendering.
 */

import { atom } from "jotai";
import type { Song, QueueSourceInfo, QueueWindow } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { hasNativeAudio } from "@/lib/tauri";
import {
  nativeNextTrack,
  nativePreviousTrack,
  nativeToggleShuffle,
  nativeSetRepeatMode,
  nativePlayAtIndex,
} from "@/lib/audio/native-engine";

import {
  effectiveSessionIdAtom,
  isAudioOwnerAtom,
  isRemoteControllingAtom,
  clientIdAtom,
  ownerClientIdAtom,
  selfTakeoverPending,
} from "./session";

// Module-level signal: position in milliseconds to seek to when starting
// playback (e.g. after session takeover). Read and consumed by the audio
// engine so playback resumes where the previous owner left off.
let _pendingPlaybackPositionMs = 0;
export const pendingPlaybackPositionMs = {
  get value() {
    return _pendingPlaybackPositionMs;
  },
  set value(v: number) {
    _pendingPlaybackPositionMs = v;
  },
};

// ============================================================================
// Types
// ============================================================================

export type QueueSourceType =
  | "library"
  | "album"
  | "artist"
  | "playlist"
  | "smartPlaylist"
  | "genre"
  | "search"
  | "favorites"
  | "history"
  | "directory"
  | "directoryFlat"
  | "songRadio"
  | "albumList"
  | "continueListening"
  | "forgottenFavorites"
  | "other";

export type RepeatMode = "off" | "all" | "one";

// Queue state from server
export interface ServerQueueState {
  totalCount: number;
  currentIndex: number;
  positionMs: number;
  isShuffled: boolean;
  repeatMode: RepeatMode;
  source: QueueSourceInfo;
}

// ============================================================================
// Atoms
// ============================================================================

// Server queue state
export const serverQueueStateAtom = atom<ServerQueueState | null>(null);

// Buffered songs window (songs around the current position)
export const queueWindowAtom = atom<QueueWindow | null>(null);

// Loading states
export const isQueueLoadingAtom = atom<boolean>(false);
export const isQueueOperationPendingAtom = atom<boolean>(false);

// Flag to indicate queue is being restored (don't auto-play during restore)
// Defaults to true to prevent autoplay until user explicitly interacts
export const isRestoringQueueAtom = atom<boolean>(true);

// Counter to signal when the audio engine should load a new track
// Incremented when current track changes (not just position updates)
export const trackChangeSignalAtom = atom<number>(0);

// ============================================================================
// Derived Atoms
// ============================================================================

// Get the current song from the window
export const currentSongAtom = atom<Song | null>((get) => {
  const state = get(serverQueueStateAtom);
  const window = get(queueWindowAtom);

  if (!state || !window) return null;

  const entry = window.songs.find((s) => s.position === state.currentIndex);
  return entry?.song ?? null;
});

// Get the current queue entry's source_entry_id (for playlist "now playing" matching)
export const currentSourceEntryIdAtom = atom<string | null>((get) => {
  const state = get(serverQueueStateAtom);
  const window = get(queueWindowAtom);

  if (!state || !window) return null;

  const entry = window.songs.find((s) => s.position === state.currentIndex);
  return entry?.sourceEntryId ?? null;
});

// Get the next song from the window (for gapless pre-buffering)
export const nextSongAtom = atom<Song | null>((get) => {
  const state = get(serverQueueStateAtom);
  const window = get(queueWindowAtom);

  if (!state || !window) return null;

  let nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.totalCount) {
    if (state.repeatMode === "all") {
      nextIndex = 0;
    } else {
      return null; // No next song
    }
  }

  const entry = window.songs.find((s) => s.position === nextIndex);
  return entry?.song ?? null;
});

// Get total queue length
export const queueLengthAtom = atom<number>((get) => {
  const state = get(serverQueueStateAtom);
  return state?.totalCount ?? 0;
});

// Check if queue is empty
export const isQueueEmptyAtom = atom<boolean>((get) => {
  const length = get(queueLengthAtom);
  return length === 0;
});

// Check if we can go to next track
export const canGoNextAtom = atom<boolean>((get) => {
  const state = get(serverQueueStateAtom);
  if (!state) return false;

  if (state.repeatMode === "all") return state.totalCount > 0;
  return state.currentIndex < state.totalCount - 1;
});

// Check if we can go to previous track
export const canGoPreviousAtom = atom<boolean>((get) => {
  const state = get(serverQueueStateAtom);
  if (!state) return false;

  if (state.repeatMode === "all") return state.totalCount > 0;
  return state.currentIndex > 0;
});

// ============================================================================
// Action Atoms
// ============================================================================

// Start a new queue from a source
export const startQueueAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      sourceType: QueueSourceType;
      sourceId?: string;
      sourceName?: string;
      startIndex?: number;
      /** ID of the song to start playing (for verification against index) */
      startSongId?: string;
      shuffle?: boolean;
      /** Filters to apply when materializing the queue (for library/search sources) */
      filters?: Record<string, unknown>;
      /** Sort configuration for the queue */
      sort?: { field: string; direction: string };
      /** Explicit song IDs for history or custom queues */
      songIds?: string[];
    },
  ) => {
    const client = getClient();
    if (!client) return;

    const isRemote = get(isRemoteControllingAtom);

    // If there's no current owner (cleared by inactivity), optimistically
    // claim ownership so the track loader doesn't need to wait for the
    // SSE OwnerChanged roundtrip.
    const noOwner = !get(ownerClientIdAtom);
    const shouldPlay = !isRemote || noOwner;

    // Check if this is a "seamless swap" scenario: the new queue's first
    // song is the same as the currently playing song (e.g. starting song
    // radio for the song that's already playing). In that case we swap
    // the queue without interrupting playback.
    const currentSong = get(currentSongAtom);
    const currentQueueState = get(serverQueueStateAtom);
    const isSeamlessSwap =
      currentSong &&
      currentQueueState &&
      params.sourceType === "songRadio" &&
      params.sourceId === currentSong.id &&
      (params.startIndex ?? 0) === 0;

    set(isQueueOperationPendingAtom, true);
    if (!isSeamlessSwap) {
      set(isRestoringQueueAtom, false); // User explicitly starting playback
      if (shouldPlay && noOwner) {
        set(isAudioOwnerAtom, true);
      }
    }

    try {
      // Preserve current shuffle state when not explicitly specified.
      // Play buttons pass shuffle: false, Shuffle buttons pass shuffle: true,
      // and song clicks omit it to preserve the current setting.
      const shuffle =
        params.shuffle ?? get(serverQueueStateAtom)?.isShuffled ?? false;

      const sessionId = get(effectiveSessionIdAtom) ?? undefined;
      const clientId = get(clientIdAtom) || undefined;

      const response = await client.startQueue({
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        sourceName: params.sourceName,
        startIndex: params.startIndex ?? 0,
        startSongId: params.startSongId,
        shuffle,
        filters: params.filters,
        sort: params.sort,
        songIds: params.songIds,
        inlineImages: "small", // Always request small thumbnails for queue
        sessionId,
        clientId,
      });

      if (isSeamlessSwap) {
        // Seamless swap: update queue state but preserve the current
        // playback position and don't trigger a track reload.
        set(serverQueueStateAtom, {
          totalCount: response.totalCount,
          currentIndex: response.currentIndex,
          positionMs: currentQueueState.positionMs,
          isShuffled: response.isShuffled,
          repeatMode: response.repeatMode as RepeatMode,
          source: response.source,
        });
        set(queueWindowAtom, response.window);
        // Don't increment trackChangeSignalAtom — keeps audio playing.
        // On Android, the SSE QueueChanged handler will update
        // the native queue without restarting the current track.
      } else {
        set(serverQueueStateAtom, {
          totalCount: response.totalCount,
          currentIndex: response.currentIndex,
          positionMs: 0,
          isShuffled: response.isShuffled,
          repeatMode: response.repeatMode as RepeatMode,
          source: response.source,
        });

        set(queueWindowAtom, response.window);
        set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
      }

      // No explicit sendSessionCommand("queueChanged") needed here:
      // the server's start_queue endpoint already broadcasts QueueChanged
      // to all SSE subscribers. Sending it again would cause the owner
      // to receive two QueueChanged events and restart the track.
    } catch (error) {
      console.error("Failed to start queue:", error);
    } finally {
      set(isQueueOperationPendingAtom, false);
    }
  },
);

// Fetch queue state from server (used for initial restoration)
export const fetchQueueAtom = atom(null, async (get, set) => {
  const client = getClient();
  if (!client) return;

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;
  if (!sessionId) return; // Session not initialized yet

  set(isQueueLoadingAtom, true);
  // Mark as restoring so audio doesn't auto-play (browser blocks autoplay without interaction)
  set(isRestoringQueueAtom, true);

  // Snapshot state before the async fetch so we can detect if a user-initiated
  // operation (e.g. playAtIndex) changed it while we were waiting.
  const stateBefore = get(serverQueueStateAtom);

  try {
    const response = await client.getQueueCurrentWindow(20, "small", sessionId);

    // If a user operation changed the queue state while we were fetching,
    // discard this stale response to avoid overwriting the user's intent.
    const stateAfter = get(serverQueueStateAtom);
    if (stateAfter !== stateBefore) {
      console.log(
        "fetchQueueAtom: discarding stale response (state changed during fetch)",
      );
      return;
    }

    // Empty queue (totalCount 0) means no queue exists yet
    if (response.totalCount === 0) {
      set(serverQueueStateAtom, null);
      set(queueWindowAtom, null);
    } else {
      set(serverQueueStateAtom, {
        totalCount: response.totalCount,
        currentIndex: response.currentIndex,
        positionMs: Number(response.positionMs),
        isShuffled: response.isShuffled,
        repeatMode: response.repeatMode as RepeatMode,
        source: response.source,
      });

      set(queueWindowAtom, response.window);
    }
  } catch (error) {
    // Network error or other failure
    console.error("Failed to fetch queue:", error);
    set(serverQueueStateAtom, null);
    set(queueWindowAtom, null);
  } finally {
    set(isQueueLoadingAtom, false);
  }
});

/**
 * Fetch queue and force the current track to materialize in a paused state.
 * Used when a follower becomes locally controllable/owner without an explicit
 * resume request, so local play can continue from the authoritative position.
 */
export const fetchQueueAndRestoreAtom = atom(null, async (get, set) => {
  const client = getClient();
  if (!client) return;

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;
  if (!sessionId) return;

  try {
    const response = await client.getQueueCurrentWindow(20, "small", sessionId);

    if (response.totalCount === 0) {
      set(serverQueueStateAtom, null);
      set(queueWindowAtom, null);
    } else {
      set(serverQueueStateAtom, {
        totalCount: response.totalCount,
        currentIndex: response.currentIndex,
        positionMs: Number(response.positionMs),
        isShuffled: response.isShuffled,
        repeatMode: response.repeatMode as RepeatMode,
        source: response.source,
      });
      set(queueWindowAtom, response.window);
      pendingPlaybackPositionMs.value = Number(response.positionMs);
      set(isRestoringQueueAtom, true);
      set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
    }
  } catch (error) {
    console.error("Failed to fetch queue for paused restore:", error);
  }
});

/**
 * Silently refresh queue state without affecting playback.
 * Used when the queue metadata changes (shuffle/repeat/add/remove/move)
 * but the currently playing track should continue uninterrupted.
 */
export const fetchQueueSilentAtom = atom(null, async (get, set) => {
  const client = getClient();
  if (!client) return;

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;
  if (!sessionId) return; // Session not initialized yet
  const stateBefore = get(serverQueueStateAtom);

  try {
    const response = await client.getQueueCurrentWindow(20, "small", sessionId);

    // Discard stale response if a user operation changed state during fetch
    const stateAfter = get(serverQueueStateAtom);
    if (stateAfter !== stateBefore) {
      console.log(
        "fetchQueueSilentAtom: discarding stale response (state changed during fetch)",
      );
      return;
    }

    if (response.totalCount === 0) {
      set(serverQueueStateAtom, null);
      set(queueWindowAtom, null);
    } else {
      set(serverQueueStateAtom, {
        totalCount: response.totalCount,
        currentIndex: response.currentIndex,
        positionMs: Number(response.positionMs),
        isShuffled: response.isShuffled,
        repeatMode: response.repeatMode as RepeatMode,
        source: response.source,
      });
      set(queueWindowAtom, response.window);
    }
  } catch (error) {
    console.error("Failed to silently fetch queue:", error);
  }
});

/**
 * Fetch queue and trigger playback (for external queue changes via SSE).
 * Unlike fetchQueueAtom, this marks the queue as ready to play rather than
 * restoring, so the audio engine will auto-play the current track.
 */
export const fetchQueueAndPlayAtom = atom(null, async (get, set) => {
  const client = getClient();
  if (!client) return;

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;
  if (!sessionId) return; // Session not initialized yet

  try {
    const response = await client.getQueueCurrentWindow(20, "small", sessionId);

    if (response.totalCount === 0) {
      set(serverQueueStateAtom, null);
      set(queueWindowAtom, null);
    } else {
      set(serverQueueStateAtom, {
        totalCount: response.totalCount,
        currentIndex: response.currentIndex,
        positionMs: Number(response.positionMs),
        isShuffled: response.isShuffled,
        repeatMode: response.repeatMode as RepeatMode,
        source: response.source,
      });
      set(queueWindowAtom, response.window);
      // Signal the audio engine to load and play the new track,
      // resuming from the server-reported position (e.g. session takeover)
      pendingPlaybackPositionMs.value = Number(response.positionMs);
      set(isRestoringQueueAtom, false);
      set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
    }
  } catch (error) {
    console.error("Failed to fetch queue for playback:", error);
  }
});

// Fetch a specific range of the queue
export const fetchQueueRangeAtom = atom(
  null,
  async (
    get,
    set,
    params: { offset: number; limit: number; signal?: AbortSignal },
  ) => {
    const client = getClient();
    if (!client) return null;

    const sessionId = get(effectiveSessionIdAtom) ?? undefined;

    try {
      const response = await client.getServerQueue({
        ...params,
        inlineImages: "small",
        signal: params.signal,
        sessionId,
      });

      // Merge the new window into existing state
      const currentWindow = get(queueWindowAtom);
      if (currentWindow) {
        // Merge windows, preferring new data for overlapping positions
        const existingSongs = currentWindow.songs.filter(
          (s) =>
            s.position < params.offset ||
            s.position >= params.offset + params.limit,
        );
        const mergedSongs = [...existingSongs, ...response.window.songs].sort(
          (a, b) => a.position - b.position,
        );
        set(queueWindowAtom, { ...currentWindow, songs: mergedSongs });
      } else {
        set(queueWindowAtom, response.window);
      }

      return response.window;
    } catch (error) {
      // Silently ignore abort errors
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      console.error("Failed to fetch queue range:", error);
      return null;
    }
  },
);

// Go to next track
export const goToNextAtom = atom(null, async (get, set) => {
  // When native audio owns playback, Kotlin handles skip + server sync + scrobble
  if (hasNativeAudio() && get(isAudioOwnerAtom)) {
    try {
      await nativeNextTrack();
    } catch (error) {
      console.error("Failed to go to next track (native):", error);
    }
    return;
  }

  const state = get(serverQueueStateAtom);
  if (!state) return;

  const client = getClient();
  if (!client) return;

  let nextIndex = state.currentIndex + 1;
  const isWrapping = nextIndex >= state.totalCount;

  if (isWrapping) {
    if (state.repeatMode === "all") {
      nextIndex = 0;
    } else {
      // End of queue - stop playback and clear state
      const { playbackStateAtom, currentTimeAtom } = await import("./player");
      set(currentTimeAtom, 0);
      set(playbackStateAtom, "ended");
      return;
    }
  }

  set(isQueueOperationPendingAtom, true);

  try {
    const sessionId = get(effectiveSessionIdAtom) ?? undefined;

    // When wrapping around with shuffle + repeat-all, request a reshuffle
    // so the next cycle has a fresh random order
    const shouldReshuffle = isWrapping && state.isShuffled;
    const response = await client.updateServerQueuePosition(
      nextIndex,
      0,
      shouldReshuffle,
      sessionId,
    );

    const newIndex = response.newIndex ?? nextIndex;

    // Update local state immediately for responsive UI
    set(serverQueueStateAtom, {
      ...state,
      currentIndex: newIndex,
      positionMs: 0,
    });
    set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);

    // Fetch new window if needed (always fetch after reshuffle since order changed)
    const window = get(queueWindowAtom);
    if (
      shouldReshuffle ||
      !window?.songs.some((s) => s.position === newIndex)
    ) {
      const queueResponse = await client.getQueueCurrentWindow(
        20,
        "small",
        sessionId,
      );
      set(queueWindowAtom, queueResponse.window);
    }
  } catch (error) {
    console.error("Failed to go to next track:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});

// Go to previous track
export const goToPreviousAtom = atom(null, async (get, set) => {
  // When native audio owns playback, Kotlin handles skip + server sync
  if (hasNativeAudio() && get(isAudioOwnerAtom)) {
    try {
      await nativePreviousTrack();
    } catch (error) {
      console.error("Failed to go to previous track (native):", error);
    }
    return;
  }

  const state = get(serverQueueStateAtom);
  if (!state) return;

  const client = getClient();
  if (!client) return;

  let prevIndex = state.currentIndex - 1;

  if (prevIndex < 0) {
    if (state.repeatMode === "all") {
      prevIndex = state.totalCount - 1;
    } else {
      return; // Start of queue
    }
  }

  set(isQueueOperationPendingAtom, true);

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;

  try {
    await client.updateServerQueuePosition(prevIndex, 0, false, sessionId);

    set(serverQueueStateAtom, {
      ...state,
      currentIndex: prevIndex,
      positionMs: 0,
    });
    set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);

    const window = get(queueWindowAtom);
    if (window) {
      const needsFetch = !window.songs.some((s) => s.position === prevIndex);
      if (needsFetch) {
        const response = await client.getQueueCurrentWindow(
          20,
          "small",
          sessionId,
        );
        set(queueWindowAtom, response.window);
      }
    }
  } catch (error) {
    console.error("Failed to go to previous track:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});

// Play at a specific index
export const playAtIndexAtom = atom(null, async (get, set, index: number) => {
  const state = get(serverQueueStateAtom);
  if (!state || index < 0 || index >= state.totalCount) return;

  const client = getClient();
  if (!client) return;

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;

  // When native audio owns playback, delegate entirely to Kotlin which handles
  // server position update + queue refetch + ExoPlayer rebuild atomically.
  // Also handle the case where ownership was cleared (e.g. inactivity
  // timeout while backgrounded) — claim ownership and use native path.
  if (hasNativeAudio()) {
    const isOwner = get(isAudioOwnerAtom);
    const noOwner = !get(ownerClientIdAtom);

    // Only use native path if we're the owner or there's no owner (we can claim)
    if (isOwner || noOwner) {
      if (noOwner) {
        // Claim ownership before starting native playback
        set(isAudioOwnerAtom, true);
        if (sessionId) {
          selfTakeoverPending.value = true;
          const clientId = get(clientIdAtom) || undefined;
          await client
            .sendSessionCommand(
              sessionId,
              "takeOver",
              undefined,
              undefined,
              undefined,
              undefined,
              clientId,
            )
            .catch(() => {
              selfTakeoverPending.value = false;
            });
        }
      }

      set(isQueueOperationPendingAtom, true);
      try {
        await nativePlayAtIndex(index);
      } catch (error) {
        console.error("Failed to play at index (native):", error);
      } finally {
        set(isQueueOperationPendingAtom, false);
      }
      return;
    }
  }

  set(isQueueOperationPendingAtom, true);
  set(isRestoringQueueAtom, false); // User explicitly starting playback

  const noOwner = !get(ownerClientIdAtom);
  if (noOwner) {
    set(isAudioOwnerAtom, true);
  }

  try {
    // If claiming ownership from no-owner state, tell the server first
    if (noOwner && sessionId) {
      selfTakeoverPending.value = true;
      const clientId = get(clientIdAtom) || undefined;
      await client
        .sendSessionCommand(
          sessionId,
          "takeOver",
          undefined,
          undefined,
          undefined,
          undefined,
          clientId,
        )
        .catch(() => {
          selfTakeoverPending.value = false;
        });
    }

    await client.updateServerQueuePosition(index, 0, false, sessionId);

    set(serverQueueStateAtom, { ...state, currentIndex: index, positionMs: 0 });
    set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);

    // Fetch new window centered on the new position
    const response = await client.getQueueCurrentWindow(20, "small", sessionId);
    set(queueWindowAtom, response.window);

    // Notify the session owner via SSE when remote controlling
    if (get(isRemoteControllingAtom) && sessionId) {
      client.sendSessionCommand(sessionId, "queueChanged").catch(console.error);
    }
  } catch (error) {
    console.error("Failed to play at index:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});

// Toggle shuffle
export const toggleShuffleAtom = atom(null, async (get, set) => {
  const state = get(serverQueueStateAtom);
  if (!state) return;

  const newShuffleState = !state.isShuffled;
  const sessionId = get(effectiveSessionIdAtom) ?? undefined;

  // Kotlin handles server API + ExoPlayer queue update.
  // nativeToggleShuffle only resolves after Kotlin finishes the server toggle
  // and ExoPlayer queue update, so the queue window fetch returns consistent data.
  if (hasNativeAudio() && get(isAudioOwnerAtom)) {
    set(isQueueOperationPendingAtom, true);
    try {
      await nativeToggleShuffle(newShuffleState);
      // Kotlin has finished: fetch updated queue window for the UI.
      // Update both atoms atomically to avoid a transient mismatch where
      // currentIndex points to a different song in the old/new window,
      // which would cause the audio effect to restart playback.
      const client = getClient();
      if (client) {
        const queueResponse = await client.getQueueCurrentWindow(
          20,
          "small",
          sessionId,
        );
        set(serverQueueStateAtom, {
          ...state,
          isShuffled: queueResponse.isShuffled,
          currentIndex: queueResponse.currentIndex,
          totalCount: queueResponse.totalCount,
          repeatMode: queueResponse.repeatMode as "off" | "all" | "one",
        });
        set(queueWindowAtom, queueResponse.window);
      }
    } catch (error) {
      console.error("Failed to toggle shuffle (native):", error);
    } finally {
      set(isQueueOperationPendingAtom, false);
    }
    return;
  }

  const client = getClient();
  if (!client) return;

  set(isQueueOperationPendingAtom, true);

  try {
    const response = await client.toggleServerShuffle(
      newShuffleState,
      sessionId,
    );

    // Fetch new window since order has changed
    const queueResponse = await client.getQueueCurrentWindow(
      20,
      "small",
      sessionId,
    );

    // Update state and window atomically to avoid a transient mismatch
    // where currentIndex points to a different song in the old window
    set(serverQueueStateAtom, {
      ...state,
      isShuffled: newShuffleState,
      currentIndex: response.newIndex ?? state.currentIndex,
    });
    set(queueWindowAtom, queueResponse.window);

    // Notify the session owner via SSE when remote controlling
    if (get(isRemoteControllingAtom) && sessionId) {
      client.sendSessionCommand(sessionId, "queueUpdated").catch(console.error);
    }
  } catch (error) {
    console.error("Failed to toggle shuffle:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});

// Set repeat mode
export const setRepeatModeAtom = atom(
  null,
  async (get, set, mode: RepeatMode) => {
    const state = get(serverQueueStateAtom);
    if (!state) return;

    // Kotlin handles repeat mode + ExoPlayer update
    if (hasNativeAudio() && get(isAudioOwnerAtom)) {
      try {
        await nativeSetRepeatMode(mode);
        set(serverQueueStateAtom, { ...state, repeatMode: mode });
      } catch (error) {
        console.error("Failed to set repeat mode (native):", error);
      }
      return;
    }

    const client = getClient();
    if (!client) return;

    const sessionId = get(effectiveSessionIdAtom) ?? undefined;

    try {
      await client.updateServerRepeatMode(mode, sessionId);
      set(serverQueueStateAtom, { ...state, repeatMode: mode });

      // Notify the session owner via SSE when remote controlling
      if (get(isRemoteControllingAtom) && sessionId) {
        client
          .sendSessionCommand(sessionId, "queueUpdated")
          .catch(console.error);
      }
    } catch (error) {
      console.error("Failed to set repeat mode:", error);
    }
  },
);

// Add songs to queue - returns { success, addedCount } for better messaging
// If no queue exists, starts a new queue with the songs
export const addToQueueAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      songIds?: string[];
      position: "next" | "end";
      sourceType?: QueueSourceType;
      sourceId?: string;
    },
  ): Promise<{ success: boolean; addedCount: number }> => {
    const client = getClient();
    if (!client) return { success: false, addedCount: 0 };

    const state = get(serverQueueStateAtom);
    const hasQueue = state !== null && state.totalCount > 0;
    const sessionId = get(effectiveSessionIdAtom) ?? undefined;

    set(isQueueOperationPendingAtom, true);

    try {
      // If no queue exists, start a new queue instead of adding
      if (!hasQueue && params.songIds && params.songIds.length > 0) {
        set(isRestoringQueueAtom, false); // User action - enable auto-play
        const response = await client.startQueue({
          sourceType: "other",
          songIds: params.songIds,
          startIndex: 0,
          inlineImages: "small",
          sessionId,
        });

        set(serverQueueStateAtom, {
          totalCount: response.totalCount,
          currentIndex: response.currentIndex,
          positionMs: 0,
          isShuffled: response.isShuffled,
          repeatMode: response.repeatMode as RepeatMode,
          source: response.source,
        });
        set(queueWindowAtom, response.window);
        set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
        return { success: true, addedCount: params.songIds.length };
      }

      // Queue exists, add to it
      const response = await client.addToServerQueue({
        songIds: params.songIds ?? [],
        position: params.position,
        currentIndex:
          params.position === "next" ? state?.currentIndex : undefined,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        sessionId,
      });

      // Update total count
      if (
        state &&
        response.totalCount !== undefined &&
        response.totalCount !== null
      ) {
        set(serverQueueStateAtom, {
          ...state,
          totalCount: response.totalCount,
        });
      }

      // Refresh window
      const queueResponse = await client.getQueueCurrentWindow(
        20,
        "small",
        sessionId,
      );

      // Pull the authoritative queue metadata from the same response so local
      // state stays aligned with the server after queue mutations.
      set(serverQueueStateAtom, {
        totalCount: queueResponse.totalCount,
        currentIndex: queueResponse.currentIndex,
        positionMs: Number(queueResponse.positionMs ?? 0),
        isShuffled: queueResponse.isShuffled,
        repeatMode: queueResponse.repeatMode as RepeatMode,
        source: queueResponse.source,
      });
      set(queueWindowAtom, queueResponse.window);

      // PlaybackService already receives the server-broadcast QueueUpdated
      // event over SSE, so avoid issuing a second local invalidate here.

      // Notify the session owner via SSE when remote controlling
      if (get(isRemoteControllingAtom) && sessionId) {
        client
          .sendSessionCommand(sessionId, "queueUpdated")
          .catch(console.error);
      }

      return { success: true, addedCount: response.addedCount ?? 0 };
    } catch (error) {
      console.error("Failed to add to queue:", error);
      return { success: false, addedCount: 0 };
    } finally {
      set(isQueueOperationPendingAtom, false);
    }
  },
);

// Remove song at position
export const removeFromQueueAtom = atom(
  null,
  async (get, set, position: number) => {
    const client = getClient();
    if (!client) return;

    const sessionId = get(effectiveSessionIdAtom) ?? undefined;

    set(isQueueOperationPendingAtom, true);

    try {
      const response = await client.removeFromServerQueue(position, sessionId);

      // Optimistically update BOTH window and state synchronously to prevent
      // a transient mismatch where currentSongAtom resolves against a stale
      // window, triggering track-loader to clear/reload audio.
      const currentWindow = get(queueWindowAtom);
      if (currentWindow) {
        const updatedSongs = currentWindow.songs
          .filter((s) => s.position !== position)
          .map((s) => ({
            ...s,
            position: s.position > position ? s.position - 1 : s.position,
          }));
        set(queueWindowAtom, { ...currentWindow, songs: updatedSongs });
      }
      const state = get(serverQueueStateAtom);
      if (state) {
        set(serverQueueStateAtom, {
          ...state,
          currentIndex: response.newIndex ?? state.currentIndex,
          totalCount: response.totalCount ?? state.totalCount,
        });
      }

      // Refresh window from server for authoritative data
      const queueResponse = await client.getQueueCurrentWindow(
        20,
        "small",
        sessionId,
      );
      set(queueWindowAtom, queueResponse.window);

      // Native PlaybackService already receives the server-broadcast
      // QueueUpdated event and applies the change from its own SSE stream.
      // Triggering a second invalidate here can make Android apply the same
      // queue mutation twice and advance playback unnecessarily.

      // Notify the session owner via SSE when remote controlling
      if (get(isRemoteControllingAtom) && sessionId) {
        client
          .sendSessionCommand(sessionId, "queueUpdated")
          .catch(console.error);
      }
    } catch (error) {
      console.error("Failed to remove from queue:", error);
    } finally {
      set(isQueueOperationPendingAtom, false);
    }
  },
);

// Move song in queue with optimistic update
export const moveInQueueAtom = atom(
  null,
  async (get, set, params: { fromPosition: number; toPosition: number }) => {
    const client = getClient();
    if (!client) return;

    const { fromPosition, toPosition } = params;
    if (fromPosition === toPosition) return;

    const sessionId = get(effectiveSessionIdAtom) ?? undefined;

    // Optimistic update: reorder the local window immediately
    const currentWindow = get(queueWindowAtom);
    const currentState = get(serverQueueStateAtom);

    if (currentWindow?.songs) {
      const songs = [...currentWindow.songs];
      const movedEntry = songs.find((s) => s.position === fromPosition);

      if (movedEntry) {
        // Update positions locally
        const newSongs = songs.map((entry) => {
          if (entry.position === fromPosition) {
            // This is the moved item
            return { ...entry, position: toPosition };
          } else if (fromPosition < toPosition) {
            // Moving down: shift items in range (from+1, to] up by 1
            if (entry.position > fromPosition && entry.position <= toPosition) {
              return { ...entry, position: entry.position - 1 };
            }
          } else {
            // Moving up: shift items in range [to, from) down by 1
            if (entry.position >= toPosition && entry.position < fromPosition) {
              return { ...entry, position: entry.position + 1 };
            }
          }
          return entry;
        });

        set(queueWindowAtom, { ...currentWindow, songs: newSongs });

        // Also update current index optimistically if needed
        if (currentState) {
          let newCurrentIndex = currentState.currentIndex;
          const currentIdx = currentState.currentIndex;

          if (fromPosition === currentIdx) {
            // Moving the current track
            newCurrentIndex = toPosition;
          } else if (fromPosition < toPosition) {
            // Moving down: current shifts up if it was in the range
            if (currentIdx > fromPosition && currentIdx <= toPosition) {
              newCurrentIndex = currentIdx - 1;
            }
          } else {
            // Moving up: current shifts down if it was in the range
            if (currentIdx >= toPosition && currentIdx < fromPosition) {
              newCurrentIndex = currentIdx + 1;
            }
          }

          if (newCurrentIndex !== currentState.currentIndex) {
            set(serverQueueStateAtom, {
              ...currentState,
              currentIndex: newCurrentIndex,
            });
          }
        }
      }
    }

    set(isQueueOperationPendingAtom, true);

    try {
      const response = await client.moveInServerQueue(
        fromPosition,
        toPosition,
        sessionId,
      );

      // Update current index from server response (authoritative)
      if (
        currentState &&
        response.newIndex !== undefined &&
        response.newIndex !== null
      ) {
        set(serverQueueStateAtom, {
          ...currentState,
          currentIndex: response.newIndex,
        });
      }

      // Refresh window to get authoritative state
      const queueResponse = await client.getQueueCurrentWindow(
        20,
        "small",
        sessionId,
      );
      set(queueWindowAtom, queueResponse.window);

      // Native PlaybackService already receives the server-broadcast
      // QueueUpdated event and applies the change from its own SSE stream.
      // Triggering a second invalidate here can make Android apply the same
      // queue mutation twice and advance playback unnecessarily.

      // Notify the session owner via SSE when remote controlling
      if (get(isRemoteControllingAtom) && sessionId) {
        client
          .sendSessionCommand(sessionId, "queueUpdated")
          .catch(console.error);
      }
    } catch (error) {
      console.error("Failed to move in queue:", error);
      // On error, refetch to restore correct state
      try {
        const queueResponse = await client.getQueueCurrentWindow(
          20,
          "small",
          sessionId,
        );
        set(queueWindowAtom, queueResponse.window);
      } catch {
        // Ignore refetch errors
      }
    } finally {
      set(isQueueOperationPendingAtom, false);
    }
  },
);

// Clear queue
export const clearQueueAtom = atom(null, async (get, set) => {
  const client = getClient();
  if (!client) return;

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;

  set(isQueueOperationPendingAtom, true);

  try {
    await client.clearServerQueue(sessionId);
    set(serverQueueStateAtom, null);
    set(queueWindowAtom, null);
  } catch (error) {
    console.error("Failed to clear queue:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});

// Stop playback and clear queue
export const stopPlaybackAtom = atom(null, async (get, set) => {
  const client = getClient();
  if (!client) return;

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;

  try {
    await client.clearServerQueue(sessionId);
    set(serverQueueStateAtom, null);
    set(queueWindowAtom, null);
  } catch (error) {
    console.error("Failed to stop playback:", error);
  }
});

// Preview a single song (starts playback at ~30% position)
// This is used for previewing songs in the track matcher dialog
export const previewSongAtom = atom(null, async (get, set, song: Song) => {
  const client = getClient();
  if (!client) return;

  const sessionId = get(effectiveSessionIdAtom) ?? undefined;

  set(isQueueOperationPendingAtom, true);
  set(isRestoringQueueAtom, false);

  try {
    const response = await client.startQueue({
      sourceType: "other",
      sourceName: `Preview: ${song.title}`,
      songIds: [song.id],
      startIndex: 0,
      inlineImages: "small",
      sessionId,
    });

    set(serverQueueStateAtom, {
      totalCount: response.totalCount,
      currentIndex: response.currentIndex,
      // Start at 30% of the song duration
      positionMs: Math.floor((song.duration || 0) * 1000 * 0.3),
      isShuffled: response.isShuffled,
      repeatMode: response.repeatMode as RepeatMode,
      source: response.source,
    });

    set(queueWindowAtom, response.window);
    set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
  } catch (error) {
    console.error("Failed to preview song:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});
