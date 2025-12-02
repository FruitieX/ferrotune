"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { currentTrackAtom } from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";

const BASE_TITLE = "Ferrotune";

/**
 * Updates the browser tab title to show the currently playing track.
 * Format: "Artist - Title | Ferrotune" when playing, "Ferrotune" when paused/stopped.
 */
export function useDocumentTitle() {
  const currentTrack = useAtomValue(currentTrackAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const isPlaying = playbackState === "playing";

  useEffect(() => {
    if (currentTrack && isPlaying) {
      const artist = currentTrack.artist || "Unknown Artist";
      const title = currentTrack.title || "Unknown Track";
      document.title = `${artist} - ${title} | ${BASE_TITLE}`;
    } else if (currentTrack) {
      // Paused - show track info with paused indicator
      const artist = currentTrack.artist || "Unknown Artist";
      const title = currentTrack.title || "Unknown Track";
      document.title = `⏸ ${artist} - ${title} | ${BASE_TITLE}`;
    } else {
      document.title = BASE_TITLE;
    }

    // Cleanup on unmount
    return () => {
      document.title = BASE_TITLE;
    };
  }, [currentTrack, isPlaying]);
}
