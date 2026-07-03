"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { currentSongAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { isClientInitializedAtom } from "@/lib/store/auth";
import { isOfflineModeAtom } from "@/lib/store/downloads";
import {
  cacheOfflineWaveform,
  getCachedOfflineWaveform,
} from "@/lib/offline/download-assets";

const WAVEFORM_DEBUG_STORAGE_KEY = "ferrotune-debug-waveform";

function debugWaveform(message: string, details?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(WAVEFORM_DEBUG_STORAGE_KEY) !== "true") {
    return;
  }

  console.debug(`[Waveform] ${message}`, details ?? {});
}

/**
 * Hook to manage waveform data for the current track.
 * Fetches pre-computed waveform data from the server.
 * If no pre-computed waveform is available, returns isAvailable: false
 * so the UI can fall back to a simple progress bar.
 */
export function useWaveform() {
  const currentTrack = useAtomValue(currentSongAtom);
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const isOfflineMode = useAtomValue(isOfflineModeAtom);
  const lastLoggedTrackIdRef = useRef<string | null>(null);

  const trackId = currentTrack?.id ?? null;
  const trackTitle = currentTrack?.title ?? null;

  useEffect(() => {
    if (!trackId || isClientInitialized) return;
    if (lastLoggedTrackIdRef.current === trackId) return;
    lastLoggedTrackIdRef.current = trackId;
    debugWaveform("waiting for API client", { trackId, trackTitle });
  }, [trackId, trackTitle, isClientInitialized]);

  const waveformQuery = useQuery({
    queryKey: ["waveform", trackId],
    enabled: trackId !== null && (isClientInitialized || isOfflineMode),
    retry: isOfflineMode ? false : 3,
    retryDelay: 500,
    queryFn: async () => {
      if (!trackId) {
        throw new Error("No current track");
      }

      const cached = await getCachedOfflineWaveform(trackId);
      if (cached?.heights?.length) {
        debugWaveform("cache hit", { trackId, trackTitle });
        return cached;
      }

      if (isOfflineMode) {
        debugWaveform("offline cache miss", { trackId, trackTitle });
        return null;
      }

      const client = getClient();
      if (!client) {
        throw new Error("API client is not initialized");
      }

      debugWaveform("fetch start", { trackId, trackTitle });
      const response = await client.getWaveform(trackId);

      if (response?.heights && response.heights.length > 0) {
        void cacheOfflineWaveform(trackId, response);
        debugWaveform("fetch success", {
          trackId,
          trackTitle,
          heights: response.heights.length,
        });
      } else {
        debugWaveform("no waveform data", { trackId, trackTitle });
      }

      return response;
    },
  });

  useEffect(() => {
    if (!trackId || !waveformQuery.error) return;
    debugWaveform("fetch failed", {
      trackId,
      trackTitle,
      error: waveformQuery.error.message,
    });
  }, [trackId, trackTitle, waveformQuery.error]);

  const waveformData = waveformQuery.data ?? null;
  const isAvailable =
    !!waveformData?.heights && waveformData.heights.length > 0;
  const isLoading =
    isClientInitialized &&
    trackId !== null &&
    waveformQuery.isFetching &&
    !waveformData;
  const heights = isAvailable ? waveformData.heights : [];

  return {
    heights,
    isLoaded: isAvailable,
    isLoading,
    isAvailable,
  };
}
