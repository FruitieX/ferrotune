import type { Song } from "@/lib/api/types";

/**
 * Sort an array of songs by the specified field and direction.
 * This function is excluded from React Compiler optimization to avoid
 * hook-related issues when called inside useMemo or other hooks.
 */
export function sortSongs(
  songs: Song[],
  field: string,
  direction: "asc" | "desc"
): Song[] {
  // "custom" means preserve original order (no sorting)
  if (field === "custom") {
    return direction === "desc" ? [...songs].reverse() : songs;
  }

  const sorted = [...songs].sort((a, b) => {
    let aVal: string | number = "";
    let bVal: string | number = "";

    switch (field) {
      case "name":
        aVal = a.title?.toLowerCase() ?? "";
        bVal = b.title?.toLowerCase() ?? "";
        break;
      case "artist":
        aVal = a.artist?.toLowerCase() ?? "";
        bVal = b.artist?.toLowerCase() ?? "";
        break;
      case "year":
        aVal = a.year ?? 0;
        bVal = b.year ?? 0;
        break;
      case "dateAdded":
        aVal = a.created ?? "";
        bVal = b.created ?? "";
        break;
      case "playCount":
        aVal = a.playCount ?? 0;
        bVal = b.playCount ?? 0;
        break;
      case "duration":
        aVal = a.duration ?? 0;
        bVal = b.duration ?? 0;
        break;
      default:
        aVal = a.title?.toLowerCase() ?? "";
        bVal = b.title?.toLowerCase() ?? "";
    }

    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}
