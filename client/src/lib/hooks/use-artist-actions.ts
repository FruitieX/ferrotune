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
import type { Artist } from "@/lib/api/types";
import { isTauriMobile } from "@/lib/tauri";
import { useDownloadActions } from "@/lib/hooks/use-download-actions";
import {
  useContainerDownloaded,
  downloadedContainersAtom,
} from "@/lib/store/downloads";

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
  artistSongIds: string[] | null;

  // Details dialog
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;

  // Offline download actions (mobile-only; undefined on desktop so menu
  // items don't render).
  handleDownload?: () => void;
  handleRemoveDownload?: () => void;
  isDownloaded?: boolean;
}

async function fetchArtistSongIds(artistId: string): Promise<string[]> {
  const client = getClient();
  if (!client) return [];

  try {
    const response = await client.getSourceSongIds([
      { sourceType: "artist", sourceId: artistId },
    ]);
    return response.ids;
  } catch (error) {
    console.error("Failed to fetch artist song IDs:", error);
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
  const [artistSongIds, setArtistSongIds] = useState<string[] | null>(null);

  const { isStarred, toggleStar } = useStar({
    itemType: "artist",
    itemId: artist.id,
    itemName: artist.name,
    initialStarred: !!artist.starred,
  });

  // Offline downloads — no-op on desktop; the hook returns `undefined`,
  // which causes menu items to be hidden.
  const downloadActions = useDownloadActions();
  const isContainerDownloaded = useContainerDownloaded(`artist:${artist.id}`);
  const containers = useAtomValue(downloadedContainersAtom);
  const isDownloaded = isTauriMobile() && isContainerDownloaded;

  const handleDownload = () => {
    void downloadActions.downloadArtist(artist.id);
  };
  const handleRemoveDownload = () => {
    const songIds = containers.get(`artist:${artist.id}`) ?? [];
    void downloadActions.removeContainerDownload(
      `artist:${artist.id}`,
      songIds,
    );
  };

  const handlePlay = () => {
    hapticConfirm();
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
    hapticDouble();
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
    const result = await addToQueue({
      sourceType: "artist",
      sourceId: artist.id,
      sourceName: artist.name,
      position: "next",
    });
    if (result.success && result.addedCount > 0) {
      hapticSelection();
      toast.success(`Added "${artist.name}" songs to play next`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleAddToQueue = async () => {
    const result = await addToQueue({
      sourceType: "artist",
      sourceId: artist.id,
      sourceName: artist.name,
      position: "end",
    });
    if (result.success && result.addedCount > 0) {
      hapticSelection();
      toast.success(`Added "${artist.name}" songs to queue`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleAddToPlaylist = async () => {
    const songIds = await fetchArtistSongIds(artist.id);
    if (songIds.length > 0) {
      // Filter out disabled songs when adding artist to playlist
      const enabledSongIds = songIds.filter((id) => !disabledSongs.has(id));
      if (enabledSongIds.length > 0) {
        setArtistSongIds(enabledSongIds);
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
    artistSongIds,
    detailsOpen,
    setDetailsOpen,
    handleDownload: isTauriMobile() ? handleDownload : undefined,
    handleRemoveDownload: isTauriMobile() ? handleRemoveDownload : undefined,
    isDownloaded,
  };
}
