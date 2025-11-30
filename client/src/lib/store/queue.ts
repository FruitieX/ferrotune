import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Song } from "@/lib/api/types";

// Queue state
export const queueAtom = atom<Song[]>([]);
export const queueIndexAtom = atom<number>(-1);

// Current track derived from queue
export const currentTrackAtom = atom((get) => {
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

    if (position === "next" && currentIndex >= 0) {
      // Insert after current track
      const newQueue = [
        ...queue.slice(0, currentIndex + 1),
        ...songsArray,
        ...queue.slice(currentIndex + 1),
      ];
      set(queueAtom, newQueue);
    } else {
      // Add to end
      set(queueAtom, [...queue, ...songsArray]);
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

// Reorder the queue (for drag and drop)
export const reorderQueueAtom = atom(
  null,
  (get, set, newOrder: Song[]) => {
    const currentTrack = get(currentTrackAtom);
    set(queueAtom, newOrder);
    
    // Update current index if current track is still in queue
    if (currentTrack) {
      const newIndex = newOrder.findIndex((s) => s.id === currentTrack.id);
      if (newIndex >= 0) {
        set(queueIndexAtom, newIndex);
      }
    }
  }
);

// Replace queue and start playing
export const playNowAtom = atom(
  null,
  (_get, set, songs: Song | Song[], startIndex: number = 0) => {
    const songsArray = Array.isArray(songs) ? songs : [songs];
    set(queueAtom, songsArray);
    set(queueIndexAtom, startIndex);
    set(shuffledIndicesAtom, []);
    set(playHistoryAtom, []);
  }
);
