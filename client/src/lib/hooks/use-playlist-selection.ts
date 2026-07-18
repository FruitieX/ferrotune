"use client";

import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useItemSelection } from "./use-track-selection";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import type { Playlist } from "@/lib/api/types";

/**
 * Playlist-specific selection hook.
 * Provides playlist-specific actions like play, shuffle, add to queue, delete.
 */
export function usePlaylistSelection(playlists: Playlist[]) {
  const {
    selectedIds,
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedItems,
  } = useItemSelection(playlists);

  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const queryClient = useQueryClient();

  // Get selected playlists (type-safe alias)
  const getSelectedPlaylists = () => {
    return getSelectedItems() as Playlist[];
  };

  const getSelectedSources = () =>
    getSelectedPlaylists().map((playlist) => ({
      sourceType: "playlist" as const,
      sourceId: playlist.id,
    }));

  // Play all songs from selected playlists
  const playSelectedNow = () => {
    const sources = getSelectedSources();
    if (sources.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }
    startQueue({
      sourceType: "playlist",
      sourceName: `${getSelectedPlaylists().length} playlists`,
      sources,
      shuffle: false,
    });
    toast.success(`Playing ${sources.length} playlists`);
    clearSelection();
  };

  // Shuffle play all songs from selected playlists
  const shuffleSelected = () => {
    const sources = getSelectedSources();
    if (sources.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }
    startQueue({
      sourceType: "playlist",
      sourceName: `${getSelectedPlaylists().length} playlists`,
      sources,
      shuffle: true,
    });
    toast.success(`Shuffling ${sources.length} playlists`);
    clearSelection();
  };

  // Add selected playlist songs to queue
  const addSelectedToQueue = async (position: "next" | "last" = "last") => {
    const sources = getSelectedSources();
    if (sources.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }

    const result = await addToQueue({
      sources,
      sourceName: `${sources.length} playlists`,
      position: position === "last" ? "end" : position,
    });

    if (!result.success || result.addedCount === 0) {
      toast.error("Selected playlists are empty");
      return;
    }
    toast.success(
      position === "next"
        ? `Added ${result.addedCount} songs to play next`
        : `Added ${result.addedCount} songs to queue`,
    );
    clearSelection();
  };

  // Delete selected playlists
  const deleteSelected = async () => {
    const client = getClient();
    if (!client) return;

    const selected = getSelectedPlaylists();
    if (selected.length === 0) return;

    try {
      for (const playlist of selected) {
        await client.deletePlaylist(playlist.id);
      }
      toast.success(
        `Deleted ${selected.length} playlist${selected.length > 1 ? "s" : ""}`,
      );
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      clearSelection();
    } catch (error) {
      console.error("Failed to delete playlists:", error);
      toast.error("Failed to delete playlists");
    }
  };

  // Merge selected playlists into a new one
  const mergeSelected = async (newPlaylistName: string) => {
    const client = getClient();
    if (!client) return;

    const sources = getSelectedSources();
    if (sources.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }

    try {
      const result = await client.createPlaylist({
        name: newPlaylistName,
        sources,
      });
      toast.success(
        `Created "${newPlaylistName}" with ${result.matchedCount} songs`,
      );
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      clearSelection();
    } catch (error) {
      console.error("Failed to merge playlists:", error);
      toast.error("Failed to merge playlists");
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
    getSelectedPlaylists,
    playSelectedNow,
    shuffleSelected,
    addSelectedToQueue,
    deleteSelected,
    mergeSelected,
  };
}
