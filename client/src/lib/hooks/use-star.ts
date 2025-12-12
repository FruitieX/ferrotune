"use client";

import { useState } from "react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import { useInvalidateFavorites } from "@/lib/store/starred";

export type StarItemType = "song" | "album" | "artist";

interface UseStarOptions {
  itemType: StarItemType;
  itemId: string;
  itemName: string;
  initialStarred: boolean;
}

interface UseStarReturn {
  isStarred: boolean;
  toggleStar: () => Promise<void>;
  setIsStarred: (starred: boolean) => void;
}

/**
 * Unified hook for managing star/favorite state across songs, albums, and artists.
 * Handles API calls, state management, toast notifications, and cache invalidation.
 */
export function useStar({
  itemType,
  itemId,
  itemName,
  initialStarred,
}: UseStarOptions): UseStarReturn {
  const [isStarred, setIsStarred] = useState(initialStarred);
  const invalidateFavorites = useInvalidateFavorites();

  const toggleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        // Unstar based on item type
        switch (itemType) {
          case "song":
            await client.unstar({ id: itemId });
            break;
          case "album":
            await client.unstar({ albumId: itemId });
            break;
          case "artist":
            await client.unstar({ artistId: itemId });
            break;
        }
        setIsStarred(false);
        invalidateFavorites(itemType);
        toast.success(`Removed "${itemName}" from favorites`);
      } else {
        // Star based on item type
        switch (itemType) {
          case "song":
            await client.star({ id: itemId });
            break;
          case "album":
            await client.star({ albumId: itemId });
            break;
          case "artist":
            await client.star({ artistId: itemId });
            break;
        }
        setIsStarred(true);
        invalidateFavorites(itemType);
        toast.success(`Added "${itemName}" to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  return { isStarred, toggleStar, setIsStarred };
}
