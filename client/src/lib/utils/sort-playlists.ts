import type { Playlist } from "@/lib/api/types";

/**
 * Filter an array of playlists by the specified query string.
 * Searches in playlist name and comment.
 */
export function filterPlaylists(playlists: Playlist[], query: string): Playlist[] {
  if (!query.trim()) {
    return playlists;
  }
  
  const lowerQuery = query.toLowerCase();
  return playlists.filter(playlist =>
    playlist.name?.toLowerCase().includes(lowerQuery) ||
    playlist.comment?.toLowerCase().includes(lowerQuery) ||
    playlist.owner?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Sort an array of playlists by the specified field and direction.
 */
export function sortPlaylists(
  playlists: Playlist[],
  field: string,
  direction: "asc" | "desc"
): Playlist[] {
  const sorted = [...playlists].sort((a, b) => {
    let aVal: string | number = "";
    let bVal: string | number = "";

    switch (field) {
      case "name":
        aVal = a.name?.toLowerCase() ?? "";
        bVal = b.name?.toLowerCase() ?? "";
        break;
      case "songCount":
        aVal = a.songCount ?? 0;
        bVal = b.songCount ?? 0;
        break;
      case "duration":
        aVal = a.duration ?? 0;
        bVal = b.duration ?? 0;
        break;
      case "dateAdded":
      case "created":
        aVal = a.created ?? "";
        bVal = b.created ?? "";
        break;
      case "changed":
        aVal = a.changed ?? a.created ?? "";
        bVal = b.changed ?? b.created ?? "";
        break;
      default:
        aVal = a.name?.toLowerCase() ?? "";
        bVal = b.name?.toLowerCase() ?? "";
    }

    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}
