"use client";

import { useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  startQueueAtom,
  addToQueueAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import { useStarred } from "@/lib/store/starred";
import { shuffleExcludesAtom } from "@/lib/store/shuffle-excludes";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";

export interface QueueSource {
  type: string;
  id?: string | null;
  name?: string | null;
  filters?: Record<string, unknown>;
  sort?: { field: string; direction: string };
}

interface UseSongActionsOptions {
  song: Song;
  queueSongs?: Song[];
  songIndex?: number;
  queueSource?: QueueSource;
}

interface UseSongActionsReturn {
  // Star state
  isStarred: boolean;
  toggleStar: () => Promise<void>;

  // Shuffle exclude state
  isExcludedFromShuffle: boolean;
  handleToggleShuffleExclude: () => Promise<void>;

  // Rating state
  currentRating: number;
  handleRate: (rating: number) => Promise<void>;

  // Playback actions
  handlePlay: () => void;
  handlePlayNext: () => void;
  handleAddToQueue: () => void;
  handleDownload: () => void;

  // Dialog state
  addToPlaylistOpen: boolean;
  setAddToPlaylistOpen: (open: boolean) => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
}

/**
 * Hook that encapsulates all song context menu actions.
 * Eliminates duplication between SongContextMenu and SongDropdownMenu.
 */
export function useSongActions({
  song,
  queueSongs,
  songIndex,
  queueSource,
}: UseSongActionsOptions): UseSongActionsReturn {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);
  const [shuffleExcludes, setShuffleExcludes] = useAtom(shuffleExcludesAtom);
  const [currentRating, setCurrentRating] = useState(song.userRating ?? 0);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isExcludedFromShuffle = shuffleExcludes.has(song.id);

  const handleToggleShuffleExclude = async () => {
    const client = getClient();
    if (!client) return;

    const newExcluded = !isExcludedFromShuffle;
    try {
      await client.setShuffleExclude(song.id, newExcluded);
      setShuffleExcludes((prev: Set<string>) => {
        const next = new Set(prev);
        if (newExcluded) {
          next.add(song.id);
        } else {
          next.delete(song.id);
        }
        return next;
      });
      toast.success(
        newExcluded
          ? `"${song.title}" excluded from shuffle`
          : `"${song.title}" included in shuffle`,
      );
    } catch (error) {
      toast.error("Failed to update shuffle setting");
      console.error(error);
    }
  };

  const handlePlay = () => {
    if (queueSource?.type && queueSource.type !== "other") {
      // Use server-side queue materialization for known sources
      const index =
        songIndex ?? queueSongs?.findIndex((s) => s.id === song.id) ?? 0;
      startQueue({
        sourceType: queueSource.type as QueueSourceType,
        sourceId: queueSource.id ?? undefined,
        sourceName: queueSource.name ?? undefined,
        startIndex: index >= 0 ? index : 0,
        startSongId: song.id,
        filters: queueSource.filters,
        sort: queueSource.sort,
      });
    } else if (queueSongs && queueSongs.length > 0) {
      // Fallback to explicit song IDs for custom lists
      const index = songIndex ?? queueSongs.findIndex((s) => s.id === song.id);
      startQueue({
        sourceType: (queueSource?.type as QueueSourceType) || "other",
        sourceName: queueSource?.name ?? undefined,
        startIndex: index >= 0 ? index : 0,
        startSongId: song.id,
        songIds: queueSongs.map((s) => s.id),
      });
    } else {
      // Single song
      startQueue({
        sourceType: "other",
        startIndex: 0,
        startSongId: song.id,
        songIds: [song.id],
      });
    }
  };

  const handlePlayNext = () => {
    addToQueue({ songIds: [song.id], position: "next" });
    toast.success(`Added "${song.title}" to play next`);
  };

  const handleAddToQueue = () => {
    addToQueue({ songIds: [song.id], position: "end" });
    toast.success(`Added "${song.title}" to queue`);
  };

  const handleRate = async (rating: number) => {
    const client = getClient();
    if (!client) return;

    try {
      await client.setRating(song.id, rating);
      setCurrentRating(rating);
      toast.success(
        rating > 0
          ? `Rated "${song.title}" ${rating} stars`
          : `Removed rating from "${song.title}"`,
      );
    } catch (error) {
      toast.error("Failed to set rating");
      console.error(error);
    }
  };

  const handleDownload = () => {
    const client = getClient();
    if (!client) return;

    const downloadUrl = client.getDownloadUrl(song.id);
    window.open(downloadUrl, "_blank");
  };

  return {
    isStarred,
    toggleStar,
    isExcludedFromShuffle,
    handleToggleShuffleExclude,
    currentRating,
    handleRate,
    handlePlay,
    handlePlayNext,
    handleAddToQueue,
    handleDownload,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    detailsOpen,
    setDetailsOpen,
  };
}
