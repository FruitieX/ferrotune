"use client";

import { atom, useAtom } from "jotai";
import { useCallback, useEffect } from "react";
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

type StarType = "song" | "album" | "artist";
export type { StarType };

/**
 * Invalidate all favorites-related queries to ensure the favorites view
 * is updated when items are starred/unstarred elsewhere.
 */
function invalidateFavoritesQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  type: StarType
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
  return useCallback((type: StarType) => {
    invalidateFavoritesQueries(queryClient, type);
  }, [queryClient]);
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
 */
function useStarredItem(id: string, initialStarred: boolean, type: StarType) {
  const [starredItems, setStarredItems] = useAtom(starredItemsAtom);
  const queryClient = useQueryClient();
  
  // Create a unique key that includes the type to avoid collisions
  const key = `${type}:${id}`;
  
  // Initialize from server data on mount (only if not already in cache)
  useEffect(() => {
    if (!starredItems.has(key)) {
      setStarredItems((current) => {
        if (current.has(key)) return current;
        const updated = new Map(current);
        updated.set(key, initialStarred);
        return updated;
      });
    }
  }, [key, initialStarred, starredItems, setStarredItems]);
  
  // Get current value (fall back to initial if not in cache yet)
  const isStarred = starredItems.get(key) ?? initialStarred;

  const toggleStar = useCallback(async () => {
    const client = getClient();
    if (!client) return;

    // Optimistic update
    const newStarred = !isStarred;
    setStarredItems((current) => {
      const updated = new Map(current);
      updated.set(key, newStarred);
      return updated;
    });

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
              setStarredItems((current) => {
                const updated = new Map(current);
                updated.set(key, false);
                return updated;
              });
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
                setStarredItems((current) => {
                  const updated = new Map(current);
                  updated.set(key, true);
                  return updated;
                });
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
              setStarredItems((current) => {
                const updated = new Map(current);
                updated.set(key, true);
                return updated;
              });
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
                setStarredItems((current) => {
                  const updated = new Map(current);
                  updated.set(key, false);
                  return updated;
                });
                toast.error("Failed to update favorites");
              }
            },
          },
          duration: 5000,
        });
      }
    } catch (error) {
      // Revert on error
      setStarredItems((current) => {
        const updated = new Map(current);
        updated.set(key, isStarred);
        return updated;
      });
      toast.error("Failed to update favorites");
      console.error(error);
    }
  }, [key, id, type, isStarred, setStarredItems, queryClient]);

  return { isStarred, toggleStar };
}
