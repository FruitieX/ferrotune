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

// Map of item ID to starred status
const starredItemsAtom = atom<Map<string, boolean>>(new Map());

/**
 * Hook to manage starred state for an item.
 * Returns the current starred status and a toggle function.
 */
export function useStarred(id: string, initialStarred: boolean) {
  const [starredItems, setStarredItems] = useAtom(starredItemsAtom);
  
  // Initialize from server data on mount (only if not already in cache)
  useEffect(() => {
    if (!starredItems.has(id)) {
      setStarredItems((current) => {
        if (current.has(id)) return current;
        const updated = new Map(current);
        updated.set(id, initialStarred);
        return updated;
      });
    }
  }, [id, initialStarred, starredItems, setStarredItems]);
  
  // Get current value (fall back to initial if not in cache yet)
  const isStarred = starredItems.get(id) ?? initialStarred;

  const toggleStar = useCallback(async () => {
    const client = getClient();
    if (!client) return;

    // Optimistic update
    const newStarred = !isStarred;
    setStarredItems((current) => {
      const updated = new Map(current);
      updated.set(id, newStarred);
      return updated;
    });

    try {
      if (newStarred) {
        await client.star({ id });
        toast.success("Added to favorites");
      } else {
        await client.unstar({ id });
        toast.success("Removed from favorites");
      }
    } catch (error) {
      // Revert on error
      setStarredItems((current) => {
        const updated = new Map(current);
        updated.set(id, isStarred);
        return updated;
      });
      toast.error("Failed to update favorites");
      console.error(error);
    }
  }, [id, isStarred, setStarredItems]);

  return { isStarred, toggleStar };
}
