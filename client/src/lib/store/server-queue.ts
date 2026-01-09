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

    set(isQueueOperationPendingAtom, true);
    set(isRestoringQueueAtom, false); // User explicitly starting playback

    try {
      const response = await client.startQueue({
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        sourceName: params.sourceName,
        startIndex: params.startIndex ?? 0,
        startSongId: params.startSongId,
        shuffle: params.shuffle ?? false,
        filters: params.filters,
        sort: params.sort,
        songIds: params.songIds,
        inlineImages: "small", // Always request small thumbnails for queue
      });

      set(serverQueueStateAtom, {
        totalCount: response.totalCount,
        currentIndex: response.currentIndex,
        positionMs: 0,
        isShuffled: response.isShuffled,
        repeatMode: response.repeatMode as RepeatMode,
        source: {
          type: params.sourceType,
          id: params.sourceId ?? null,
          name: params.sourceName ?? null,
          filters: params.filters ?? null,
          sort: params.sort ?? null,
        },
      });

      set(queueWindowAtom, response.window);
      set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
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

  set(isQueueLoadingAtom, true);
  // Mark as restoring so audio doesn't auto-play (browser blocks autoplay without interaction)
  set(isRestoringQueueAtom, true);

  try {
    const response = await client.getQueueCurrentWindow(20, "small");

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

    try {
      const response = await client.getServerQueue({
        ...params,
        inlineImages: "small",
        signal: params.signal,
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
  const state = get(serverQueueStateAtom);
  if (!state) return;

  const client = getClient();
  if (!client) return;

  let nextIndex = state.currentIndex + 1;

  if (nextIndex >= state.totalCount) {
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
    await client.updateServerQueuePosition(nextIndex, 0);

    // Update local state immediately for responsive UI
    set(serverQueueStateAtom, {
      ...state,
      currentIndex: nextIndex,
      positionMs: 0,
    });
    set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);

    // Fetch new window if needed
    const window = get(queueWindowAtom);
    if (window) {
      const needsFetch = !window.songs.some((s) => s.position === nextIndex);
      if (needsFetch) {
        const response = await client.getQueueCurrentWindow(20, "small");
        set(queueWindowAtom, response.window);
      }
    }
  } catch (error) {
    console.error("Failed to go to next track:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});

// Go to previous track
export const goToPreviousAtom = atom(null, async (get, set) => {
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

  try {
    await client.updateServerQueuePosition(prevIndex, 0);

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
        const response = await client.getQueueCurrentWindow(20, "small");
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

  set(isQueueOperationPendingAtom, true);
  set(isRestoringQueueAtom, false); // User explicitly starting playback

  try {
    await client.updateServerQueuePosition(index, 0);

    set(serverQueueStateAtom, { ...state, currentIndex: index, positionMs: 0 });
    set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);

    // Fetch new window centered on the new position
    const response = await client.getQueueCurrentWindow(20, "small");
    set(queueWindowAtom, response.window);
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

  const client = getClient();
  if (!client) return;

  const newShuffleState = !state.isShuffled;

  set(isQueueOperationPendingAtom, true);

  try {
    const response = await client.toggleServerShuffle(newShuffleState);

    // Update state with new shuffle state and index
    set(serverQueueStateAtom, {
      ...state,
      isShuffled: newShuffleState,
      currentIndex: response.new_index ?? state.currentIndex,
    });

    // Fetch new window since order may have changed
    const queueResponse = await client.getQueueCurrentWindow(20, "small");
    set(queueWindowAtom, queueResponse.window);
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

    const client = getClient();
    if (!client) return;

    try {
      await client.updateServerRepeatMode(mode);
      set(serverQueueStateAtom, { ...state, repeatMode: mode });
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

    set(isQueueOperationPendingAtom, true);

    try {
      // If no queue exists, start a new queue instead of adding
      if (!hasQueue && params.songIds && params.songIds.length > 0) {
        set(isRestoringQueueAtom, false); // User action - enable auto-play
        const response = await client.startQueue({
          sourceType: "other",
          songIds: params.songIds,
          startIndex: 0,
          shuffle: false,
          inlineImages: "small",
        });

        set(serverQueueStateAtom, {
          totalCount: response.totalCount,
          currentIndex: response.currentIndex,
          positionMs: 0,
          isShuffled: response.isShuffled,
          repeatMode: response.repeatMode as RepeatMode,
          source: {
            type: "other",
            id: null,
            name: null,
            filters: null,
            sort: null,
          },
        });
        set(queueWindowAtom, response.window);
        set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
        return { success: true, addedCount: params.songIds.length };
      }

      // Queue exists, add to it
      const response = await client.addToServerQueue({
        songIds: params.songIds ?? [],
        position: params.position,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
      });

      // Update total count
      if (
        state &&
        response.total_count !== undefined &&
        response.total_count !== null
      ) {
        set(serverQueueStateAtom, {
          ...state,
          totalCount: response.total_count,
        });
      }

      // Refresh window
      const queueResponse = await client.getQueueCurrentWindow(20, "small");
      set(queueWindowAtom, queueResponse.window);
      return { success: true, addedCount: response.added_count ?? 0 };
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

    set(isQueueOperationPendingAtom, true);

    try {
      const response = await client.removeFromServerQueue(position);

      // Update state
      const state = get(serverQueueStateAtom);
      if (state) {
        set(serverQueueStateAtom, {
          ...state,
          currentIndex: response.new_index ?? state.currentIndex,
          totalCount: response.total_count ?? state.totalCount,
        });
      }

      // Refresh window
      const queueResponse = await client.getQueueCurrentWindow(20, "small");
      set(queueWindowAtom, queueResponse.window);
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
      const response = await client.moveInServerQueue(fromPosition, toPosition);

      // Update current index from server response (authoritative)
      if (
        currentState &&
        response.new_index !== undefined &&
        response.new_index !== null
      ) {
        set(serverQueueStateAtom, {
          ...currentState,
          currentIndex: response.new_index,
        });
      }

      // Refresh window to get authoritative state
      const queueResponse = await client.getQueueCurrentWindow(20, "small");
      set(queueWindowAtom, queueResponse.window);
    } catch (error) {
      console.error("Failed to move in queue:", error);
      // On error, refetch to restore correct state
      try {
        const queueResponse = await client.getQueueCurrentWindow(20, "small");
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

  set(isQueueOperationPendingAtom, true);

  try {
    await client.clearServerQueue();
    set(serverQueueStateAtom, null);
    set(queueWindowAtom, null);
  } catch (error) {
    console.error("Failed to clear queue:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});

// Stop playback and clear queue
export const stopPlaybackAtom = atom(null, async (_get, set) => {
  const client = getClient();
  if (!client) return;

  try {
    await client.clearServerQueue();
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

  set(isQueueOperationPendingAtom, true);
  set(isRestoringQueueAtom, false);

  try {
    const response = await client.startQueue({
      sourceType: "other",
      sourceName: `Preview: ${song.title}`,
      songIds: [song.id],
      startIndex: 0,
      inlineImages: "small",
    });

    set(serverQueueStateAtom, {
      totalCount: response.totalCount,
      currentIndex: response.currentIndex,
      // Start at 30% of the song duration
      positionMs: Math.floor((song.duration || 0) * 1000 * 0.3),
      isShuffled: response.isShuffled,
      repeatMode: response.repeatMode as RepeatMode,
      source: {
        type: "other",
        id: null,
        name: `Preview: ${song.title}`,
        filters: null,
        sort: null,
      },
    });

    set(queueWindowAtom, response.window);
    set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
  } catch (error) {
    console.error("Failed to preview song:", error);
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
});
