"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { currentSongAtom } from "@/lib/store/server-queue";

const BASE_TITLE = "Ferrotune";

/**
 * Updates the browser tab title to show the currently playing track.
 * Format: "Artist - Title | Ferrotune" when playing/paused, "Ferrotune" when no track.
 */
export function useDocumentTitle() {
  const currentTrack = useAtomValue(currentSongAtom);

  useEffect(() => {
    if (currentTrack) {
      const artist = currentTrack.artist || "Unknown Artist";
      const title = currentTrack.title || "Unknown Track";
      document.title = `${artist} - ${title} | ${BASE_TITLE}`;
    } else {
      document.title = BASE_TITLE;
    }

    // Cleanup on unmount
    return () => {
      document.title = BASE_TITLE;
    };
  }, [currentTrack]);
}
