"use client";

import { atom, useAtom } from "jotai";
import { atomFamily } from "jotai/utils";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";

/**
 * Global store for tracking starred (favorited) items.
 * This ensures starring an item in one place (e.g., player bar)
 * updates the UI everywhere (e.g., library view).
 */

// Map of item ID to starred status - shared across all item types
// Exported for bulk operations (e.g., bulk star/unstar from selection)
export const starredItemsAtom = atom<Map<string, boolean>>(new Map());

// Atom family for individual item starred state - prevents unnecessary re-renders
// when other items' starred state changes
const starredItemAtomFamily = atomFamily((key: string) =>
  atom(
    (get) => get(starredItemsAtom).get(key),
    (get, set, newValue: boolean) => {
      set(starredItemsAtom, (current) => {
        const updated = new Map(current);
        updated.set(key, newValue);
        return updated;
      });
    },
  ),
);

type StarType = "song" | "album" | "artist";
export type { StarType };

/**
 * Invalidate all favorites-related queries to ensure the favorites view
 * is updated when items are starred/unstarred elsewhere.
 */
function invalidateFavoritesQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  type: StarType,
) {
  // Invalidate the specific type's starred query
  if (type === "song") {
    queryClient.invalidateQueries({ queryKey: ["starred-songs"] });
  } else if (type === "album") {
    queryClient.invalidateQueries({ queryKey: ["starred-albums"] });
  } else if (type === "artist") {
    queryClient.invalidateQueries({ queryKey: ["starred-artists"] });
  }
}

/**
 * Hook that returns a function to invalidate favorites queries.
 * Use this when starring/unstarring outside of the useStarred hooks.
 */
export function useInvalidateFavorites() {
  const queryClient = useQueryClient();
  return (type: StarType) => {
    invalidateFavoritesQueries(queryClient, type);
  };
}

/**
 * Hook to manage starred state for a song.
 * Returns the current starred status and a toggle function.
 */
export function useStarred(id: string, initialStarred: boolean) {
  return useStarredItem(id, initialStarred, "song");
}

/**
 * Hook to manage starred state for an album.
 * Returns the current starred status and a toggle function.
 */
export function useStarredAlbum(id: string, initialStarred: boolean) {
  return useStarredItem(id, initialStarred, "album");
}

/**
 * Hook to manage starred state for an artist.
 * Returns the current starred status and a toggle function.
 */
export function useStarredArtist(id: string, initialStarred: boolean) {
  return useStarredItem(id, initialStarred, "artist");
}

/**
 * Generic hook to manage starred state for any item type.
 * Returns the current starred status and a toggle function.
 *
 * Uses atomFamily to ensure each item only re-renders when its own
 * starred state changes, not when other items change.
 */
function useStarredItem(id: string, initialStarred: boolean, type: StarType) {
  const queryClient = useQueryClient();

  // Create a unique key that includes the type to avoid collisions
  const key = `${type}:${id}`;

  // Get the atom for this specific item
  const itemAtom = starredItemAtomFamily(key);
  const [starredValue, setStarredValue] = useAtom(itemAtom);

  // Initialize lazily - only set if undefined (not yet in the map)
  // This avoids the useEffect that was causing cascading re-renders
  const isStarred = starredValue ?? initialStarred;

  // If we haven't stored this value yet and it differs from undefined,
  // store it on first access (during render is fine for initialization)
  if (starredValue === undefined) {
    // Use queueMicrotask to avoid setting state during render
    queueMicrotask(() => {
      setStarredValue(initialStarred);
    });
  }

  const toggleStar = async () => {
    const client = getClient();
    if (!client) return;

    // Optimistic update
    const newStarred = !isStarred;
    setStarredValue(newStarred);

    try {
      if (newStarred) {
        // Use the appropriate star method based on type
        if (type === "song") {
          await client.star({ id });
        } else if (type === "album") {
          await client.star({ albumId: id });
        } else if (type === "artist") {
          await client.star({ artistId: id });
        }
        // Invalidate favorites queries so the favorites view updates
        invalidateFavoritesQueries(queryClient, type);
        toast.success("Added to favorites", {
          action: {
            label: "Undo",
            onClick: async () => {
              setStarredValue(false);
              try {
                if (type === "song") {
                  await client.unstar({ id });
                } else if (type === "album") {
                  await client.unstar({ albumId: id });
                } else if (type === "artist") {
                  await client.unstar({ artistId: id });
                }
                invalidateFavoritesQueries(queryClient, type);
                toast.success("Removed from favorites");
              } catch {
                // Revert on error
                setStarredValue(true);
                toast.error("Failed to update favorites");
              }
            },
          },
          duration: 5000,
        });
      } else {
        // Use the appropriate unstar method based on type
        if (type === "song") {
          await client.unstar({ id });
        } else if (type === "album") {
          await client.unstar({ albumId: id });
        } else if (type === "artist") {
          await client.unstar({ artistId: id });
        }
        // Invalidate favorites queries so the favorites view updates
        invalidateFavoritesQueries(queryClient, type);
        toast.success("Removed from favorites", {
          action: {
            label: "Undo",
            onClick: async () => {
              setStarredValue(true);
              try {
                if (type === "song") {
                  await client.star({ id });
                } else if (type === "album") {
                  await client.star({ albumId: id });
                } else if (type === "artist") {
                  await client.star({ artistId: id });
                }
                invalidateFavoritesQueries(queryClient, type);
                toast.success("Added to favorites");
              } catch {
                // Revert on error
                setStarredValue(false);
                toast.error("Failed to update favorites");
              }
            },
          },
          duration: 5000,
        });
      }
    } catch (error) {
      // Revert on error
      setStarredValue(isStarred);
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  return { isStarred, toggleStar };
}
