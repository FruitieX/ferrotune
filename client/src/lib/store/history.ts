import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Song } from "@/lib/api/types";

// Stored play history entry with timestamp
export interface PlayHistoryEntry {
  song: Song;
  playedAt: number; // Unix timestamp
}

// Maximum number of entries to keep
const MAX_HISTORY_ENTRIES = 100;

// Recently played songs (persisted to localStorage)
export const recentlyPlayedAtom = atomWithStorage<PlayHistoryEntry[]>(
  "ferrotune-recently-played",
  []
);

// Add song to recently played history
export const recordPlayAtom = atom(
  null,
  (get, set, song: Song) => {
    const history = get(recentlyPlayedAtom);
    
    // Create new entry
    const entry: PlayHistoryEntry = {
      song,
      playedAt: Date.now(),
    };
    
    // Remove duplicates of the same song (keep only latest play)
    const filteredHistory = history.filter((e) => e.song.id !== song.id);
    
    // Add new entry at the beginning
    const newHistory = [entry, ...filteredHistory];
    
    // Trim to max size
    if (newHistory.length > MAX_HISTORY_ENTRIES) {
      newHistory.length = MAX_HISTORY_ENTRIES;
    }
    
    set(recentlyPlayedAtom, newHistory);
  }
);

// Clear history
export const clearHistoryAtom = atom(
  null,
  (_get, set) => {
    set(recentlyPlayedAtom, []);
  }
);

// Get unique songs from history (for display)
export const recentSongsAtom = atom((get) => {
  const history = get(recentlyPlayedAtom);
  return history.map((entry) => entry.song);
});
