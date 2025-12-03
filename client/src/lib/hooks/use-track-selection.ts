"use client";

import { useCallback, useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  selectionStateAtom,
  selectTrackAtom,
  clearSelectionAtom,
  selectAllAtom,
  hasSelectionAtom,
  selectedCountAtom,
} from "@/lib/store/selection";
import { addToQueueAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";

export function useTrackSelection(songs: Song[]) {
  const [selectionState] = useAtom(selectionStateAtom);
  const selectTrack = useSetAtom(selectTrackAtom);
  const clearSelection = useSetAtom(clearSelectionAtom);
  const selectAll = useSetAtom(selectAllAtom);
  const hasSelection = useAtomValue(hasSelectionAtom);
  const selectedCount = useAtomValue(selectedCountAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  // Get selected songs in order
  const getSelectedSongs = useCallback(() => {
    return songs.filter((s) => selectionState.selectedIds.has(s.id));
  }, [songs, selectionState.selectedIds]);

  // Check if a specific song is selected
  const isSelected = useCallback(
    (id: string) => selectionState.selectedIds.has(id),
    [selectionState.selectedIds]
  );

  // Handle click with modifiers
  const handleSelect = useCallback(
    (id: string, event?: React.MouseEvent) => {
      selectTrack({
        id,
        songs,
        shiftKey: event?.shiftKey ?? false,
        ctrlKey: event?.ctrlKey ?? event?.metaKey ?? false,
      });
    },
    [selectTrack, songs]
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
        selectAll(songs);
      }

      // Escape to clear selection
      if (e.key === "Escape" && hasSelection) {
        clearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectAll, clearSelection, songs, hasSelection]);

  // Bulk action handlers
  const addSelectedToQueue = useCallback(
    (position: "next" | "last" = "last") => {
      const selected = getSelectedSongs();
      if (selected.length === 0) return;

      selected.forEach((song) => {
        addToQueue(song, position);
      });

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
    selectedIds: selectionState.selectedIds,
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll: () => selectAll(songs),
    getSelectedSongs,
    addSelectedToQueue,
    starSelected,
  };
}
