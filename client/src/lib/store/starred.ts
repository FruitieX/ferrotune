"use client";

import { atom, useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";

/**
 * Global store for tracking starred (favorited) items.
 * This ensures starring an item in one place (e.g., player bar) 
 * updates the UI everywhere (e.g., library view).
 */

// Map of item ID to starred status - shared across all item types
const starredItemsAtom = atom<Map<string, boolean>>(new Map());

type StarType = "song" | "album" | "artist";

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
        toast.success("Added to favorites");
      } else {
        // Use the appropriate unstar method based on type
        if (type === "song") {
          await client.unstar({ id });
        } else if (type === "album") {
          await client.unstar({ albumId: id });
        } else if (type === "artist") {
          await client.unstar({ artistId: id });
        }
        toast.success("Removed from favorites");
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
  }, [key, id, type, isStarred, setStarredItems]);

  return { isStarred, toggleStar };
}
