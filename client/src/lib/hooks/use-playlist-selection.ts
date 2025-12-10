"use client";

import { useSetAtom, useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useItemSelection } from "./use-track-selection";
import {
  startQueueAtom,
  addToQueueAtom,
  toggleShuffleAtom,
  serverQueueStateAtom,
} from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import type { Playlist, Song } from "@/lib/api/types";

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
  const toggleShuffle = useSetAtom(toggleShuffleAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const queryClient = useQueryClient();

  // Get selected playlists (type-safe alias)
  const getSelectedPlaylists = () => {
    return getSelectedItems() as Playlist[];
  };

  // Fetch all songs from selected playlists
  const fetchPlaylistSongs = async (): Promise<Song[]> => {
    const client = getClient();
    if (!client) return [];

    const selected = getSelectedPlaylists();
    if (selected.length === 0) return [];

    try {
      const allSongs: Song[] = [];
      for (const playlist of selected) {
        const response = await client.getPlaylist(playlist.id);
        if (response.playlist.entry?.length > 0) {
          allSongs.push(...response.playlist.entry);
        }
      }
      return allSongs;
    } catch (error) {
      console.error("Failed to fetch playlist songs:", error);
      return [];
    }
  };

  // Play all songs from selected playlists
  const playSelectedNow = async () => {
    const songs = await fetchPlaylistSongs();
    if (songs.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }
    // Turn off shuffle if currently shuffled
    if (queueState?.isShuffled) {
      toggleShuffle();
    }
    startQueue({
      sourceType: "playlist",
      sourceName: `${getSelectedPlaylists().length} playlists`,
      songIds: songs.map((s: Song) => s.id),
    });
    toast.success(
      `Playing ${songs.length} songs from ${getSelectedPlaylists().length} playlists`,
    );
    clearSelection();
  };

  // Shuffle play all songs from selected playlists
  const shuffleSelected = async () => {
    const songs = await fetchPlaylistSongs();
    if (songs.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }
    startQueue({
      sourceType: "playlist",
      sourceName: `${getSelectedPlaylists().length} playlists`,
      songIds: songs.map((s: Song) => s.id),
      shuffle: true,
    });
    toast.success(
      `Shuffling ${songs.length} songs from ${getSelectedPlaylists().length} playlists`,
    );
    clearSelection();
  };

  // Add selected playlist songs to queue
  const addSelectedToQueue = async (position: "next" | "last" = "last") => {
    const songs = await fetchPlaylistSongs();
    if (songs.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }

    addToQueue({
      songIds: songs.map((s: Song) => s.id),
      position: position === "last" ? "end" : position,
    });

    toast.success(
      position === "next"
        ? `Added ${songs.length} songs to play next`
        : `Added ${songs.length} songs to queue`,
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

    const songs = await fetchPlaylistSongs();
    if (songs.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }

    try {
      // Create new playlist with all songs
      await client.createPlaylist({
        name: newPlaylistName,
        songId: songs.map((s: Song) => s.id),
      });
      toast.success(`Created "${newPlaylistName}" with ${songs.length} songs`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
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
