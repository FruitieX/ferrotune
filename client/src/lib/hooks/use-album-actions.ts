"use client";

import { useState } from "react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { useStar } from "./use-star";
import type { Album, Song } from "@/lib/api/types";

interface UseAlbumActionsReturn {
  // Star state
  isStarred: boolean;
  toggleStar: () => Promise<void>;

  // Playback actions
  handlePlay: () => void;
  handleShuffle: () => void;
  handlePlayNext: () => Promise<void>;
  handleAddToQueue: () => Promise<void>;

  // Playlist actions
  handleAddToPlaylist: () => Promise<void>;
  addToPlaylistOpen: boolean;
  setAddToPlaylistOpen: (open: boolean) => void;
  albumSongs: Song[] | null;

  // Details dialog
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
}

/**
 * Hook encapsulating all album context menu actions.
 * Eliminates duplication between AlbumContextMenu and AlbumDropdownMenu.
 */
export function useAlbumActions(album: Album): UseAlbumActionsReturn {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [albumSongs, setAlbumSongs] = useState<Song[] | null>(null);

  const { isStarred, toggleStar } = useStar({
    itemType: "album",
    itemId: album.id,
    itemName: album.name,
    initialStarred: !!album.starred,
  });

  const fetchSongs = async (): Promise<Song[] | null> => {
    const client = getClient();
    if (!client) return null;
    try {
      const response = await client.getAlbum(album.id);
      return response.album.song ?? [];
    } catch (error) {
      console.error("Failed to fetch album songs:", error);
      return null;
    }
  };

  const handlePlay = () => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${album.name}"`);
  };

  const handleShuffle = () => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
      startIndex: 0,
      shuffle: true,
    });
    toast.success(`Shuffling "${album.name}"`);
  };

  const handlePlayNext = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position: "next" });
      toast.success(`Added "${album.name}" to play next`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position: "end" });
      toast.success(`Added "${album.name}" to queue`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleAddToPlaylist = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      setAlbumSongs(songs);
      setAddToPlaylistOpen(true);
    } else {
      toast.error("No songs in this album");
    }
  };

  return {
    isStarred,
    toggleStar,
    handlePlay,
    handleShuffle,
    handlePlayNext,
    handleAddToQueue,
    handleAddToPlaylist,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    albumSongs,
    detailsOpen,
    setDetailsOpen,
  };
}
