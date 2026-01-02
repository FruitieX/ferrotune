"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  selectionStateAtom,
  selectItemAtom,
  clearSelectionAtom,
  selectAllAtom,
  hasSelectionAtom,
  selectedCountAtom,
  type SelectableItem,
} from "@/lib/store/selection";
import { addToQueueAtom } from "@/lib/store/server-queue";
import { starredItemsAtom, useInvalidateFavorites } from "@/lib/store/starred";
import { getClient } from "@/lib/api/client";
import type { Song, SearchParams } from "@/lib/api/types";

/**
 * Options for item selection hook.
 */
interface UseItemSelectionOptions {
  /**
   * Total count of items in the full dataset.
   * When provided, enables "select all" to fetch all IDs from backend.
   */
  totalCount?: number;
  /**
   * Search params for fetching all IDs when selecting all.
   * Required when totalCount is provided.
   */
  searchParams?: Partial<SearchParams>;
  /**
   * Callback invoked when selection is cleared (e.g., via Escape key).
   * Useful for clearing related state that's not managed by the hook.
   */
  onClear?: () => void;
}

/**
 * Generic hook for item selection.
 * Can be used with songs, albums, artists, or any item with an id.
 */
export function useItemSelection<T extends SelectableItem>(
  items: T[],
  options: UseItemSelectionOptions = {},
) {
  const { totalCount, searchParams, onClear } = options;
  const [selectionState] = useAtom(selectionStateAtom);
  const selectItem = useSetAtom(selectItemAtom);
  const clearSelection = useSetAtom(clearSelectionAtom);
  const selectAllItems = useSetAtom(selectAllAtom);
  const hasSelection = useAtomValue(hasSelectionAtom);
  const selectedCount = useAtomValue(selectedCountAtom);
  const [isSelectingAll, setIsSelectingAll] = useState(false);

  // Use a ref to track items for shift-click range selection
  // This avoids handleSelect changing identity when items change
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Determine if all items are loaded
  const allItemsLoaded = totalCount === undefined || items.length >= totalCount;

  // Get selected items in order
  const getSelectedItems = () => {
    return items.filter((item) => selectionState.selectedIds.has(item.id));
  };

  // Check if a specific item is selected
  const isSelected = (id: string) => selectionState.selectedIds.has(id);

  // Handle click with modifiers - stable callback using ref for items
  const handleSelect = (id: string, event?: React.MouseEvent) => {
    selectItem({
      id,
      items: itemsRef.current,
      shiftKey: event?.shiftKey ?? false,
      ctrlKey: event?.ctrlKey ?? event?.metaKey ?? false,
    });
  };

  // Select all - either from loaded items or fetch from backend
  const selectAll = async () => {
    // If all items are loaded locally, use them directly
    if (allItemsLoaded) {
      selectAllItems(items);
      return;
    }

    // Otherwise, fetch all IDs from backend
    const client = getClient();
    if (!client || !searchParams) {
      // Fallback to local items if no backend support
      selectAllItems(items);
      return;
    }

    setIsSelectingAll(true);
    try {
      const response = await client.getSongIds(searchParams);
      // Create fake selectable items with just IDs
      const allItems: SelectableItem[] = response.ids.map((id) => ({ id }));
      selectAllItems(allItems);

      if (response.total > items.length) {
        toast.success(`Selected all ${response.total} matching songs`);
      }
    } catch (error) {
      console.error("Failed to fetch all song IDs:", error);
      // Fallback to local items
      selectAllItems(items);
      toast.error("Could not select all - using visible items only");
    } finally {
      setIsSelectingAll(false);
    }
  };

  // Use a ref for selectAll to avoid recreating the effect on every render
  const selectAllRef = useRef(selectAll);
  selectAllRef.current = selectAll;

  // Keyboard shortcuts for selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + A to select all (only when not in an input)
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        e.preventDefault();
        selectAllRef.current();
      }

      // Escape to clear selection
      if (e.key === "Escape" && hasSelection) {
        clearSelection();
        onClear?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection, hasSelection, onClear]);

  return {
    selectedIds: selectionState.selectedIds,
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedItems,
    isSelectingAll,
  };
}

/**
 * Track (song) specific selection hook.
 * Provides song-specific actions like add to queue and star/unstar.
 */
export function useTrackSelection(
  songs: Song[],
  options: UseItemSelectionOptions = {},
) {
  const {
    selectedIds,
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedItems,
    isSelectingAll,
  } = useItemSelection(songs, options);

  const addToQueue = useSetAtom(addToQueueAtom);
  const setStarredItems = useSetAtom(starredItemsAtom);
  const invalidateFavorites = useInvalidateFavorites();

  // Get selected songs (type-safe alias)
  // NOTE: This only returns songs that are currently loaded in memory.
  // For bulk actions after "select all", use selectedIds directly.
  const getSelectedSongs = () => {
    return getSelectedItems() as Song[];
  };

  // Bulk action handlers
  // Uses selectedIds directly for operations that work with IDs
  const addSelectedToQueue = async (position: "next" | "end" = "end") => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const result = await addToQueue({ songIds: ids, position });

    if (result.success) {
      toast.success(
        position === "next"
          ? `Added ${ids.length} songs to play next`
          : `Added ${ids.length} songs to queue`,
      );
    } else {
      toast.error("Failed to add songs to queue");
    }
    clearSelection();
  };

  const starSelected = async (star: boolean) => {
    const client = getClient();
    if (!client) return;

    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    try {
      // Star/unstar works with IDs
      if (star) {
        // Star in batches to avoid overwhelming the server
        const batchSize = 50;
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize);
          await Promise.all(batch.map((id) => client.star({ id })));
        }
        toast.success(`Added ${ids.length} songs to favorites`);
      } else {
        const batchSize = 50;
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize);
          await Promise.all(batch.map((id) => client.unstar({ id })));
        }
        toast.success(`Removed ${ids.length} songs from favorites`);
      }

      // Update the global starred state so UI reflects the change immediately
      setStarredItems((current) => {
        const updated = new Map(current);
        for (const id of ids) {
          // Use song: prefix to match the starred store key format
          updated.set(`song:${id}`, star);
        }
        return updated;
      });

      // Invalidate favorites queries so the favorites view updates
      invalidateFavorites("song");

      clearSelection();
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  return {
    selectedIds,
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedSongs,
    addSelectedToQueue,
    starSelected,
    isSelectingAll,
  };
}
