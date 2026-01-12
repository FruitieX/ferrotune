"use client";

import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { disabledSongsAtom } from "@/lib/store/disabled-songs";
import { getClient } from "@/lib/api/client";
import { useStar } from "./use-star";
import type { Artist, Song } from "@/lib/api/types";

interface UseArtistActionsReturn {
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
  artistSongs: Song[] | null;

  // Details dialog
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
}

/**
 * Helper function to fetch all songs from an artist.
 */
async function fetchArtistSongs(artistId: string): Promise<Song[]> {
  const client = getClient();
  if (!client) return [];

  try {
    const artistData = await client.getArtist(artistId);
    if (!artistData.artist.album?.length) return [];

    // Get songs from all albums
    const allSongs: Song[] = [];
    for (const album of artistData.artist.album) {
      const albumData = await client.getAlbum(album.id);
      if (albumData.album.song) {
        allSongs.push(...albumData.album.song);
      }
    }
    return allSongs;
  } catch (error) {
    console.error("Failed to fetch artist songs:", error);
    return [];
  }
}

/**
 * Hook encapsulating all artist context menu actions.
 * Eliminates duplication between ArtistContextMenu and ArtistDropdownMenu.
 */
export function useArtistActions(artist: Artist): UseArtistActionsReturn {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const disabledSongs = useAtomValue(disabledSongsAtom);

  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [artistSongs, setArtistSongs] = useState<Song[] | null>(null);

  const { isStarred, toggleStar } = useStar({
    itemType: "artist",
    itemId: artist.id,
    itemName: artist.name,
    initialStarred: !!artist.starred,
  });

  const handlePlay = () => {
    startQueue({
      sourceType: "artist",
      sourceId: artist.id,
      sourceName: artist.name,
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${artist.name}"`);
  };

  const handleShuffle = () => {
    startQueue({
      sourceType: "artist",
      sourceId: artist.id,
      sourceName: artist.name,
      startIndex: 0,
      shuffle: true,
    });
    toast.success(`Shuffling "${artist.name}"`);
  };

  const handlePlayNext = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position: "next" });
      toast.success(`Added "${artist.name}" songs to play next`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position: "end" });
      toast.success(`Added "${artist.name}" songs to queue`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleAddToPlaylist = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      // Filter out disabled songs when adding artist to playlist
      const enabledSongs = songs.filter((s) => !disabledSongs.has(s.id));
      if (enabledSongs.length > 0) {
        setArtistSongs(enabledSongs);
        setAddToPlaylistOpen(true);
      } else {
        toast.error("All songs from this artist are disabled");
      }
    } else {
      toast.error("No songs found for this artist");
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
    artistSongs,
    detailsOpen,
    setDetailsOpen,
  };
}
