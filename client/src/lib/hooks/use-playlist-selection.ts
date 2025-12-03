"use client";

import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useItemSelection } from "./use-track-selection";
import { playNowAtom, addToQueueAtom, isShuffledAtom } from "@/lib/store/queue";
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
  
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const queryClient = useQueryClient();

  // Get selected playlists (type-safe alias)
  const getSelectedPlaylists = useCallback(() => {
    return getSelectedItems() as Playlist[];
  }, [getSelectedItems]);

  // Fetch all songs from selected playlists
  const fetchPlaylistSongs = useCallback(async (): Promise<Song[]> => {
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
  }, [getSelectedPlaylists]);

  // Play all songs from selected playlists
  const playSelectedNow = useCallback(async () => {
    const songs = await fetchPlaylistSongs();
    if (songs.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }
    setIsShuffled(false);
    playNow(songs);
    toast.success(`Playing ${songs.length} songs from ${getSelectedPlaylists().length} playlists`);
    clearSelection();
  }, [fetchPlaylistSongs, playNow, setIsShuffled, clearSelection, getSelectedPlaylists]);

  // Shuffle play all songs from selected playlists
  const shuffleSelected = useCallback(async () => {
    const songs = await fetchPlaylistSongs();
    if (songs.length === 0) {
      toast.error("Selected playlists are empty");
      return;
    }
    setIsShuffled(true);
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    playNow(shuffled);
    toast.success(`Shuffling ${songs.length} songs from ${getSelectedPlaylists().length} playlists`);
    clearSelection();
  }, [fetchPlaylistSongs, playNow, setIsShuffled, clearSelection, getSelectedPlaylists]);

  // Add selected playlist songs to queue
  const addSelectedToQueue = useCallback(
    async (position: "next" | "last" = "last") => {
      const songs = await fetchPlaylistSongs();
      if (songs.length === 0) {
        toast.error("Selected playlists are empty");
        return;
      }

      songs.forEach((song) => {
        addToQueue(song, position);
      });

      toast.success(
        position === "next"
          ? `Added ${songs.length} songs to play next`
          : `Added ${songs.length} songs to queue`
      );
      clearSelection();
    },
    [fetchPlaylistSongs, addToQueue, clearSelection]
  );

  // Delete selected playlists
  const deleteSelected = useCallback(async () => {
    const client = getClient();
    if (!client) return;

    const selected = getSelectedPlaylists();
    if (selected.length === 0) return;

    try {
      for (const playlist of selected) {
        await client.deletePlaylist(playlist.id);
      }
      toast.success(`Deleted ${selected.length} playlist${selected.length > 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      clearSelection();
    } catch (error) {
      console.error("Failed to delete playlists:", error);
      toast.error("Failed to delete playlists");
    }
  }, [getSelectedPlaylists, queryClient, clearSelection]);

  // Merge selected playlists into a new one
  const mergeSelected = useCallback(async (newPlaylistName: string) => {
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
        songId: songs.map(s => s.id),
      });
      toast.success(`Created "${newPlaylistName}" with ${songs.length} songs`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      clearSelection();
    } catch (error) {
      console.error("Failed to merge playlists:", error);
      toast.error("Failed to merge playlists");
    }
  }, [fetchPlaylistSongs, queryClient, clearSelection]);

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
