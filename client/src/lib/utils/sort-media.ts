import type { Album, Artist } from "@/lib/api/types";
import { createSortFunction } from "./create-sort-function";

/**
 * Sort an array of albums by the specified field and direction.
 */
export const sortAlbums = createSortFunction<Album>({
  extractors: {
    name: (a) => a.name?.toLowerCase() ?? "",
    artist: (a) => a.artist?.toLowerCase() ?? "",
    year: (a) => a.year ?? 0,
    dateAdded: (a) => a.created ?? "",
  },
  defaultField: "name",
});

/**
 * Sort an array of artists by the specified field and direction.
 */
export const sortArtists = createSortFunction<Artist>({
  extractors: {
    name: (a) => a.name?.toLowerCase() ?? "",
    albumCount: (a) => a.albumCount ?? 0,
  },
  defaultField: "name",
});

/**
 * Generic sort function for media (albums or artists).
 * Determines type by checking for Album-specific property.
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
