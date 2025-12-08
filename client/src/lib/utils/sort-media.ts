import type { Album, Artist } from "@/lib/api/types";

/**
 * Sort an array of albums by the specified field and direction.
 */
export function sortAlbums(
  albums: Album[],
  field: string,
  direction: "asc" | "desc",
): Album[] {
  // "custom" means preserve original order (no sorting)
  if (field === "custom") {
    return direction === "desc" ? [...albums].reverse() : albums;
  }

  const sorted = [...albums].sort((a, b) => {
    let aVal: string | number = "";
    let bVal: string | number = "";

    switch (field) {
      case "name":
        aVal = a.name?.toLowerCase() ?? "";
        bVal = b.name?.toLowerCase() ?? "";
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

/**
 * Sort an array of artists by the specified field and direction.
 */
export function sortArtists(
  artists: Artist[],
  field: string,
  direction: "asc" | "desc",
): Artist[] {
  // "custom" means preserve original order (no sorting)
  if (field === "custom") {
    return direction === "desc" ? [...artists].reverse() : artists;
  }

  const sorted = [...artists].sort((a, b) => {
    let aVal: string | number = "";
    let bVal: string | number = "";

    switch (field) {
      case "name":
        aVal = a.name?.toLowerCase() ?? "";
        bVal = b.name?.toLowerCase() ?? "";
        break;
      case "albumCount":
        aVal = a.albumCount ?? 0;
        bVal = b.albumCount ?? 0;
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

/**
 * Generic sort function for media (albums or artists).
 */
export function sortMedia<T extends Album | Artist>(
  items: T[],
  field: string,
  direction: "asc" | "desc",
): T[] {
  // Determine if it's an Album or Artist array by checking for Album-specific property
  if (items.length > 0 && "songCount" in items[0]) {
    return sortAlbums(items as Album[], field, direction) as T[];
  }
  return sortArtists(items as Artist[], field, direction) as T[];
}
