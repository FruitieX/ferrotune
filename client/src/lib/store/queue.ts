import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Song } from "@/lib/api/types";

// Queue item with unique ID for stable React keys during reordering
export interface QueueItem {
  /** Unique ID for this queue entry (stable across reordering) */
  queueItemId: string;
  /** The song data */
  song: Song;
}

// Helper to create a queue item with a unique ID
function createQueueItem(song: Song): QueueItem {
  return {
    queueItemId: crypto.randomUUID(),
    song,
  };
}

// Helper to create queue items from songs (exported for use in persistence)
export function createQueueItems(songs: Song[]): QueueItem[] {
  return songs.map(createQueueItem);
}

// Queue state - now stores QueueItem[] instead of Song[]
export const queueAtom = atom<QueueItem[]>([]);
export const queueIndexAtom = atom<number>(-1);

// Flag to indicate queue is being restored from server (don't auto-play during restore)
// This flag stays true until the user explicitly presses play
export const isRestoringQueueAtom = atom<boolean>(false);

// Flag to indicate queue data is loading from the server (for skeleton UI)
// This is set to true when restoration starts and false when the API call completes
export const isQueueLoadingAtom = atom<boolean>(true);

// Counter that increments when an immediate save is needed (e.g., when replacing the queue)
// This helps the persistence hook know to save immediately instead of debouncing
export const queueSaveRequestAtom = atom<number>(0);

// Atom to clear the restoring flag (called when user explicitly presses play)
export const clearRestoringFlagAtom = atom(null, (_get, set) => {
  set(isRestoringQueueAtom, false);
});

// Current track derived from queue (returns the Song, not QueueItem)
export const currentTrackAtom = atom((get) => {
  const queue = get(queueAtom);
  const index = get(queueIndexAtom);
  return index >= 0 && index < queue.length ? queue[index].song : null;
});

// Current queue item (includes queueItemId)
export const currentQueueItemAtom = atom((get) => {
  const queue = get(queueAtom);
  const index = get(queueIndexAtom);
  return index >= 0 && index < queue.length ? queue[index] : null;
});

// History for previous track navigation
export const playHistoryAtom = atom<Song[]>([]);

// Shuffle state
export const isShuffledAtom = atomWithStorage("ferrotune-shuffle", false);
export const shuffledIndicesAtom = atom<number[]>([]);

// Queue operations
export const addToQueueAtom = atom(
  null,
  (get, set, songs: Song | Song[], position: "next" | "last" = "last") => {
    const queue = get(queueAtom);
    const currentIndex = get(queueIndexAtom);
    const songsArray = Array.isArray(songs) ? songs : [songs];
    const queueItems = createQueueItems(songsArray);

    if (position === "next" && currentIndex >= 0) {
      // Insert after current track
      const newQueue = [
        ...queue.slice(0, currentIndex + 1),
        ...queueItems,
        ...queue.slice(currentIndex + 1),
      ];
      set(queueAtom, newQueue);
    } else {
      // Add to end
      set(queueAtom, [...queue, ...queueItems]);
    }

    // Note: We no longer auto-start playback when adding to queue
    // Users should use playNow if they want immediate playback
  }
);

export const removeFromQueueAtom = atom(null, (get, set, index: number) => {
  const queue = get(queueAtom);
  const currentIndex = get(queueIndexAtom);

  if (index < 0 || index >= queue.length) return;

  const newQueue = queue.filter((_, i) => i !== index);
  set(queueAtom, newQueue);

  // Adjust current index if needed
  if (index < currentIndex) {
    set(queueIndexAtom, currentIndex - 1);
  } else if (index === currentIndex) {
    // Current track was removed
    if (newQueue.length === 0) {
      set(queueIndexAtom, -1);
    } else if (currentIndex >= newQueue.length) {
      set(queueIndexAtom, newQueue.length - 1);
    }
  }
});

export const clearQueueAtom = atom(null, (_get, set) => {
  set(queueAtom, []);
  set(queueIndexAtom, -1);
  set(shuffledIndicesAtom, []);
});

export const moveInQueueAtom = atom(
  null,
  (get, set, fromIndex: number, toIndex: number) => {
    const queue = get(queueAtom);
    const currentIndex = get(queueIndexAtom);

    if (fromIndex < 0 || fromIndex >= queue.length) return;
    if (toIndex < 0 || toIndex >= queue.length) return;

    const newQueue = [...queue];
    const [removed] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, removed);
    set(queueAtom, newQueue);

    // Adjust current index
    if (fromIndex === currentIndex) {
      set(queueIndexAtom, toIndex);
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      set(queueIndexAtom, currentIndex - 1);
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      set(queueIndexAtom, currentIndex + 1);
    }
  }
);

// Play a specific index in queue
export const playAtIndexAtom = atom(null, (get, set, index: number) => {
  const queue = get(queueAtom);
  if (index >= 0 && index < queue.length) {
    // Clear restore flag since user is explicitly starting playback
    set(isRestoringQueueAtom, false);
    set(queueIndexAtom, index);
  }
});

// Set queue index directly
export const setQueueIndexAtom = atom(null, (get, set, index: number) => {
  const queue = get(queueAtom);
  if (index >= 0 && index < queue.length) {
    set(queueIndexAtom, index);
  }
});

// Reorder the queue (for drag and drop) - accepts QueueItem[] to preserve IDs
export const reorderQueueAtom = atom(
  null,
  (get, set, newOrder: QueueItem[]) => {
    const currentQueueItem = get(currentQueueItemAtom);
    set(queueAtom, newOrder);
    
    // Update current index if current track is still in queue
    if (currentQueueItem) {
      const newIndex = newOrder.findIndex((item) => item.queueItemId === currentQueueItem.queueItemId);
      if (newIndex >= 0) {
        set(queueIndexAtom, newIndex);
      }
    }
  }
);

// Replace queue and start playing
export const playNowAtom = atom(
  null,
  (get, set, songs: Song | Song[], startIndex: number = 0) => {
    const songsArray = Array.isArray(songs) ? songs : [songs];
    const queueItems = createQueueItems(songsArray);
    // Clear restore flag since user is explicitly starting playback
    set(isRestoringQueueAtom, false);
    set(queueAtom, queueItems);
    set(queueIndexAtom, startIndex);
    set(shuffledIndicesAtom, []);
    set(playHistoryAtom, []);
    // Request immediate save by incrementing the counter
    set(queueSaveRequestAtom, get(queueSaveRequestAtom) + 1);
  }
);
