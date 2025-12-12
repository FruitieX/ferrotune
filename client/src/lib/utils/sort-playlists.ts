import type { Playlist } from "@/lib/api/types";
import { createSortFunction } from "./create-sort-function";

/**
 * Filter an array of playlists by the specified query string.
 * Searches in playlist name, comment, and owner.
 */
export function filterPlaylists(
  playlists: Playlist[],
  query: string,
): Playlist[] {
  if (!query.trim()) {
    return playlists;
  }

  const lowerQuery = query.toLowerCase();
  return playlists.filter(
    (playlist) =>
      playlist.name?.toLowerCase().includes(lowerQuery) ||
      playlist.comment?.toLowerCase().includes(lowerQuery) ||
      playlist.owner?.toLowerCase().includes(lowerQuery),
  );
}

/**
 * Sort an array of playlists by the specified field and direction.
 */
export const sortPlaylists = createSortFunction<Playlist>({
  extractors: {
    name: (p) => p.name?.toLowerCase() ?? "",
    songCount: (p) => p.songCount ?? 0,
    duration: (p) => p.duration ?? 0,
    dateAdded: (p) => p.created ?? "",
    created: (p) => p.created ?? "",
    changed: (p) => p.changed ?? p.created ?? "",
  },
  defaultField: "name",
});
