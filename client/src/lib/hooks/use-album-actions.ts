"use client";

import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { disabledSongsAtom } from "@/lib/store/disabled-songs";
import { getClient } from "@/lib/api/client";
import { useStar } from "./use-star";
import {
  hapticConfirm,
  hapticDouble,
  hapticSelection,
} from "@/lib/utils/haptic";
import type { Album, Song } from "@/lib/api/types";
import { isTauriMobile } from "@/lib/tauri";
import { useDownloadActions } from "@/lib/hooks/use-download-actions";
import {
  useContainerDownloaded,
  downloadedContainersAtom,
} from "@/lib/store/downloads";

type AlbumLike = Omit<Album, "played"> & { played?: string | null };

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

  // Offline download actions (mobile-only; undefined on desktop so menu
  // items don't render).
  handleDownload?: () => void;
  handleRemoveDownload?: () => void;
  isDownloaded?: boolean;
}

/**
 * Hook encapsulating all album context menu actions.
 * Eliminates duplication between AlbumContextMenu and AlbumDropdownMenu.
 */
export function useAlbumActions(album: AlbumLike): UseAlbumActionsReturn {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const disabledSongs = useAtomValue(disabledSongsAtom);

  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [albumSongs, setAlbumSongs] = useState<Song[] | null>(null);

  const { isStarred, toggleStar } = useStar({
    itemType: "album",
    itemId: album.id,
    itemName: album.name,
    initialStarred: !!album.starred,
  });

  // Offline downloads — no-op on desktop; the hook returns `undefined`,
  // which causes menu items to be hidden.
  const downloadActions = useDownloadActions();
  const isContainerDownloaded = useContainerDownloaded(`album:${album.id}`);
  const containers = useAtomValue(downloadedContainersAtom);
  const isDownloaded = isTauriMobile() && isContainerDownloaded;

  const handleDownload = () => {
    void downloadActions.downloadAlbum(album.id);
  };
  const handleRemoveDownload = () => {
    const songIds = containers.get(`album:${album.id}`) ?? [];
    void downloadActions.removeContainerDownload(`album:${album.id}`, songIds);
  };

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
    hapticConfirm();
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
    hapticDouble();
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
      hapticSelection();
      addToQueue({ songIds: songs.map((s) => s.id), position: "next" });
      toast.success(`Added "${album.name}" to play next`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      hapticSelection();
      addToQueue({ songIds: songs.map((s) => s.id), position: "end" });
      toast.success(`Added "${album.name}" to queue`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleAddToPlaylist = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      // Filter out disabled songs when adding album to playlist
      const enabledSongs = songs.filter((s) => !disabledSongs.has(s.id));
      if (enabledSongs.length > 0) {
        setAlbumSongs(enabledSongs);
        setAddToPlaylistOpen(true);
      } else {
        toast.error("All songs in this album are disabled");
      }
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
    handleDownload: isTauriMobile() ? handleDownload : undefined,
    handleRemoveDownload: isTauriMobile() ? handleRemoveDownload : undefined,
    isDownloaded,
  };
}
