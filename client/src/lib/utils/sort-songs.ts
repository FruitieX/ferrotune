import type { Song } from "@/lib/api/types";
import { createSortFunction } from "./create-sort-function";

/**
 * Sort an array of songs by the specified field and direction.
 * Uses server-side sorting configuration.
 */
export const sortSongs = createSortFunction<Song>({
  extractors: {
    name: (s) => s.title?.toLowerCase() ?? "",
    artist: (s) => s.artist?.toLowerCase() ?? "",
    year: (s) => s.year ?? 0,
    dateAdded: (s) => s.created ?? "",
    playCount: (s) => s.playCount ?? 0,
    lastPlayed: (s) => s.lastPlayed ?? "",
    duration: (s) => s.duration ?? 0,
  },
  defaultField: "name",
});
