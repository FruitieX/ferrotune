"use client";

import { useCallback, useEffect } from "react";
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
import type { Song } from "@/lib/api/types";

/**
 * Generic hook for item selection.
 * Can be used with songs, albums, artists, or any item with an id.
 */
export function useItemSelection<T extends SelectableItem>(items: T[]) {
  const [selectionState] = useAtom(selectionStateAtom);
  const selectItem = useSetAtom(selectItemAtom);
  const clearSelection = useSetAtom(clearSelectionAtom);
  const selectAll = useSetAtom(selectAllAtom);
  const hasSelection = useAtomValue(hasSelectionAtom);
  const selectedCount = useAtomValue(selectedCountAtom);

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
        selectAll(items);
      }

      // Escape to clear selection
      if (e.key === "Escape" && hasSelection) {
        clearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectAll, clearSelection, items, hasSelection]);

  return {
    selectedIds: selectionState.selectedIds,
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll: () => selectAll(items),
    getSelectedItems,
  };
}

/**
 * Track (song) specific selection hook.
 * Provides song-specific actions like add to queue and star/unstar.
 */
export function useTrackSelection(songs: Song[]) {
  const {
    selectedIds,
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedItems,
  } = useItemSelection(songs);
  
  const addToQueue = useSetAtom(addToQueueAtom);

  // Get selected songs (type-safe alias)
  const getSelectedSongs = useCallback(() => {
    return getSelectedItems() as Song[];
  }, [getSelectedItems]);

  // Bulk action handlers
  const addSelectedToQueue = useCallback(
    (position: "next" | "end" = "end") => {
      const selected = getSelectedSongs();
      if (selected.length === 0) return;

      addToQueue({ songIds: selected.map(s => s.id), position });

      toast.success(
        position === "next"
          ? `Added ${selected.length} songs to play next`
          : `Added ${selected.length} songs to queue`
      );
      clearSelection();
    },
    [getSelectedSongs, addToQueue, clearSelection]
  );

  const starSelected = useCallback(
    async (star: boolean) => {
      const client = getClient();
      if (!client) return;

      const selected = getSelectedSongs();
      if (selected.length === 0) return;

      try {
        if (star) {
          await Promise.all(selected.map((s) => client.star({ id: s.id })));
          toast.success(`Added ${selected.length} songs to favorites`);
        } else {
          await Promise.all(selected.map((s) => client.unstar({ id: s.id })));
          toast.success(`Removed ${selected.length} songs from favorites`);
        }
        clearSelection();
      } catch (error) {
        toast.error("Failed to update favorites");
        console.error(error);
      }
    },
    [getSelectedSongs, clearSelection]
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
  };
}
