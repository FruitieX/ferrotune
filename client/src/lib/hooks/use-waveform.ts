"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  waveformCacheAtom,
  loadingWaveformIdAtom,
  lastChunkInfoAtom,
  WAVEFORM_BAR_COUNT,
  FLAT_BAR_HEIGHT,
} from "@/lib/store/waveform";
import { currentSongAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";

/**
 * Hook to manage waveform data for the current track.
 * Fetches pre-computed waveform data from the server.
 * If no pre-computed waveform is available, returns isAvailable: false
 * so the UI can fall back to a simple progress bar.
 */
export function useWaveform() {
  const currentTrack = useAtomValue(currentSongAtom);
  const [waveformCache, setWaveformCache] = useAtom(waveformCacheAtom);
  const [loadingId, setLoadingId] = useAtom(loadingWaveformIdAtom);
  const setLastChunkInfo = useSetAtom(lastChunkInfoAtom);
  const abortControllerRef = useRef<AbortController | null>(null);

  const trackId = currentTrack?.id ?? null;

  // Fetch waveform when track changes
  useEffect(() => {
    // Cancel any in-flight request first
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (!trackId) {
      return;
    }

    // Check if already cached
    const cached = waveformCache.get(trackId);
    if (cached) {
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoadingId(trackId);

    const fetchWaveform = async () => {
      const client = getClient();
      if (!client) return;

      try {
        const precomputed = await client.getWaveform(trackId);
        if (abortController.signal.aborted) return;

        if (precomputed?.heights && precomputed.heights.length > 0) {
          // Signal a full-range chunk for animation
          setLastChunkInfo({
            startIndex: 0,
            endIndex: precomputed.heights.length,
            timestamp: performance.now(),
          });

          setWaveformCache((prev) => {
            const next = new Map(prev);
            next.set(trackId, {
              heights: precomputed.heights,
              isLoaded: true,
            });
            return next;
          });
        } else {
          // No waveform available - cache as unavailable
          setWaveformCache((prev) => {
            const next = new Map(prev);
            next.set(trackId, {
              heights: [],
              isLoaded: false,
            });
            return next;
          });
        }
      } catch {
        // On error, mark as unavailable
        if (!abortController.signal.aborted) {
          setWaveformCache((prev) => {
            const next = new Map(prev);
            next.set(trackId, {
              heights: [],
              isLoaded: false,
            });
            return next;
          });
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoadingId(null);
        }
      }
    };

    fetchWaveform();

    return () => {
      abortController.abort();
    };
  }, [
    trackId,
    waveformCache,
    setWaveformCache,
    setLoadingId,
    setLastChunkInfo,
  ]);

  // Get current waveform data
  const waveformData = trackId ? waveformCache.get(trackId) : null;
  const isLoading = loadingId === trackId && !waveformData;
  const isAvailable = waveformData?.isLoaded === true;

  const heights =
    waveformData?.heights && waveformData.heights.length > 0
      ? waveformData.heights
      : Array(WAVEFORM_BAR_COUNT).fill(FLAT_BAR_HEIGHT);

  return {
    heights,
    isLoaded: isAvailable,
    isLoading,
    isAvailable,
    barCount: WAVEFORM_BAR_COUNT,
  };
}
