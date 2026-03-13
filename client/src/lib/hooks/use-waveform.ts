"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue } from "jotai";
import { waveformCacheAtom, loadingWaveformIdAtom } from "@/lib/store/waveform";
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
  const abortControllerRef = useRef<AbortController | null>(null);

  const trackId = currentTrack?.id ?? null;

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (!trackId) return;

    const cached = waveformCache.get(trackId);
    if (cached) return;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setLoadingId(trackId);

    const fetchWaveform = async () => {
      const client = getClient();
      if (!client) return;

      try {
        const response = await client.getWaveform(trackId);
        if (abortController.signal.aborted) return;

        if (response?.heights && response.heights.length > 0) {
          setWaveformCache((prev) => {
            const next = new Map(prev);
            next.set(trackId, {
              heights: response.heights,
              isLoaded: true,
            });
            return next;
          });
        } else {
          setWaveformCache((prev) => {
            const next = new Map(prev);
            next.set(trackId, { heights: [], isLoaded: false });
            return next;
          });
        }
      } catch {
        if (!abortController.signal.aborted) {
          setWaveformCache((prev) => {
            const next = new Map(prev);
            next.set(trackId, { heights: [], isLoaded: false });
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
  }, [trackId, waveformCache, setWaveformCache, setLoadingId]);

  const waveformData = trackId ? waveformCache.get(trackId) : null;
  const isLoading = loadingId === trackId && !waveformData;
  const isAvailable = waveformData?.isLoaded === true;
  const heights = isAvailable ? waveformData.heights : [];

  return {
    heights,
    isLoaded: isAvailable,
    isLoading,
    isAvailable,
  };
}
