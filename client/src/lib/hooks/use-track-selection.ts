"use client";

import { useCallback, useEffect, useState } from "react";
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
}

/**
 * Generic hook for item selection.
 * Can be used with songs, albums, artists, or any item with an id.
 */
export function useItemSelection<T extends SelectableItem>(
  items: T[],
  options: UseItemSelectionOptions = {}
) {
  const { totalCount, searchParams } = options;
  const [selectionState] = useAtom(selectionStateAtom);
  const selectItem = useSetAtom(selectItemAtom);
  const clearSelection = useSetAtom(clearSelectionAtom);
  const selectAllItems = useSetAtom(selectAllAtom);
  const hasSelection = useAtomValue(hasSelectionAtom);
  const selectedCount = useAtomValue(selectedCountAtom);
  const [isSelectingAll, setIsSelectingAll] = useState(false);

  // Determine if all items are loaded
  const allItemsLoaded = totalCount === undefined || items.length >= totalCount;

  // Get selected items in order
  const getSelectedItems = useCallback(() => {
    return items.filter((item) => selectionState.selectedIds.has(item.id));
  }, [items, selectionState.selectedIds]);

  // Check if a specific item is selected
  const isSelected = useCallback(
    (id: string) => selectionState.selectedIds.has(id),
    [selectionState.selectedIds]
  );

  // Handle click with modifiers
  const handleSelect = useCallback(
    (id: string, event?: React.MouseEvent) => {
      selectItem({
        id,
        items,
        shiftKey: event?.shiftKey ?? false,
        ctrlKey: event?.ctrlKey ?? event?.metaKey ?? false,
      });
    },
    [selectItem, items]
  );

  // Select all - either from loaded items or fetch from backend
  const selectAll = useCallback(async () => {
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
      const allItems: SelectableItem[] = response.ids.map(id => ({ id }));
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
  }, [allItemsLoaded, items, searchParams, selectAllItems]);

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
        selectAll();
      }

      // Escape to clear selection
      if (e.key === "Escape" && hasSelection) {
        clearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectAll, clearSelection, hasSelection]);

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
  options: UseItemSelectionOptions = {}
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

  // Get selected songs (type-safe alias)
  // NOTE: This only returns songs that are currently loaded in memory.
  // For bulk actions after "select all", use selectedIds directly.
  const getSelectedSongs = useCallback(() => {
    return getSelectedItems() as Song[];
  }, [getSelectedItems]);

  // Bulk action handlers
  // Uses selectedIds directly for operations that work with IDs
  const addSelectedToQueue = useCallback(
    (position: "next" | "end" = "end") => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      addToQueue({ songIds: ids, position });

      toast.success(
        position === "next"
          ? `Added ${ids.length} songs to play next`
          : `Added ${ids.length} songs to queue`
      );
      clearSelection();
    },
    [selectedIds, addToQueue, clearSelection]
  );

  const starSelected = useCallback(
    async (star: boolean) => {
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
        clearSelection();
      } catch (error) {
        toast.error("Failed to update favorites");
        console.error(error);
      }
    },
    [selectedIds, clearSelection]
  );

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
