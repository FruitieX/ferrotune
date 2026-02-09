"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  waveformCacheAtom,
  loadingWaveformIdAtom,
  lastChunkInfoAtom,
  waveformActualDurationAtom,
  WAVEFORM_BAR_COUNT,
  FLAT_BAR_HEIGHT,
} from "@/lib/store/waveform";
import { currentSongAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";

interface WaveformChunk {
  chunk_index: number;
  total_chunks: number;
  rms_values: number[]; // Raw RMS values, not normalized
  done: boolean;
  actual_duration_ms?: number | null; // Actual decoded duration in ms (final chunk only)
  corrected_rms_values?: number[] | null; // Accurately-scaled bars for the full audio (final chunk only)
}

/**
 * Normalize RMS values to visual heights using logarithmic scaling.
 */
function normalizeRmsToHeights(rmsValues: number[]): number[] {
  // Find peak RMS across all values
  let peakRms = 0;
  for (const rms of rmsValues) {
    if (rms > peakRms) peakRms = rms;
  }

  // Normalize each value
  return rmsValues.map((rms) => {
    if (rms <= 0 || peakRms <= 0) {
      return FLAT_BAR_HEIGHT;
    }

    // Linear normalization first (0-1)
    const normalized = rms / peakRms;

    // Apply dB-like logarithmic compression
    // -40dB to 0dB maps to 0-1, giving more visual space for quieter parts
    // and compressing loud sections to show more variation
    const dbMin = -10; // Adjust for compression strength (-30 = more, -60 = less)
    const db = 20 * Math.log10(Math.max(normalized, 1e-6));
    const dbNormalized = Math.max(0, (db - dbMin) / -dbMin);

    // Map to height range (FLAT_BAR_HEIGHT to 1.0)
    const height = FLAT_BAR_HEIGHT + dbNormalized * (1 - FLAT_BAR_HEIGHT);

    return Math.max(FLAT_BAR_HEIGHT, Math.min(1, height));
  });
}

/**
 * Hook to manage waveform data for the current track.
 * Fetches waveform data from the server using SSE streaming.
 */
export function useWaveform() {
  const currentTrack = useAtomValue(currentSongAtom);
  const [waveformCache, setWaveformCache] = useAtom(waveformCacheAtom);
  const [loadingId, setLoadingId] = useAtom(loadingWaveformIdAtom);
  const setLastChunkInfo = useSetAtom(lastChunkInfoAtom);
  const setWaveformActualDuration = useSetAtom(waveformActualDurationAtom);
  const [streamingHeights, setStreamingHeights] = useState<number[] | null>(
    null,
  );
  const abortControllerRef = useRef<AbortController | null>(null);

  const trackId = currentTrack?.id ?? null;

  // Immediately reset to flat bars when track changes
  // This effect runs ONLY when trackId changes, not when cache updates
  useEffect(() => {
    // Cancel any in-flight request first
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (!trackId) {
      setStreamingHeights(null);
      return;
    }

    // Always reset to flat bars when track changes
    // If cached, the return statement below will show cached data immediately
    // If not cached, streaming will progressively update
    setStreamingHeights(Array(WAVEFORM_BAR_COUNT).fill(FLAT_BAR_HEIGHT));
  }, [trackId]);

  // Fetch waveform when track changes
  useEffect(() => {
    if (!trackId) {
      return;
    }

    // Check if already cached - if so, show cached data
    const cached = waveformCache.get(trackId);
    if (cached?.isLoaded) {
      // Clear streaming heights to show cached data
      setStreamingHeights(null);
      return;
    }

    // Cancel any pending fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoadingId(trackId);

    // Streaming fetch with client-side normalization
    const fetchWaveformStreaming = async () => {
      const client = getClient();
      if (!client) return;

      // Accumulate raw RMS values across all chunks
      // We'll dynamically track where to place each chunk's RMS values
      const allRmsValues = new Array<number>(WAVEFORM_BAR_COUNT).fill(0);
      let currentBarIndex = 0;

      try {
        const streamUrl = client.getWaveformStreamUrl(
          trackId,
          WAVEFORM_BAR_COUNT,
        );

        const response = await fetch(streamUrl, {
          signal: abortController.signal,
          headers: client.getAuthHeaders(),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (abortController.signal.aborted) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE events
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;

            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const chunk: WaveformChunk = JSON.parse(jsonStr);

              // Track the start index before adding new bars
              const chunkStartIndex = currentBarIndex;

              // Store raw RMS values at current position (sequential append)
              // Server sends chunks sequentially, so we just append
              for (
                let i = 0;
                i < chunk.rms_values.length &&
                currentBarIndex < WAVEFORM_BAR_COUNT;
                i++
              ) {
                allRmsValues[currentBarIndex++] = chunk.rms_values[i];
              }

              // Emit chunk info for animation (before setting heights)
              // This tells the component which bars were just updated
              setLastChunkInfo({
                startIndex: chunkStartIndex,
                endIndex: currentBarIndex,
                timestamp: performance.now(),
              });

              // Re-normalize across ALL received data so far
              const normalizedHeights = normalizeRmsToHeights(allRmsValues);
              setStreamingHeights([...normalizedHeights]);

              if (chunk.done) {
                // Use corrected bars if available (accurately scaled to full audio)
                const finalRmsValues =
                  chunk.corrected_rms_values &&
                  chunk.corrected_rms_values.length > 0
                    ? chunk.corrected_rms_values
                    : allRmsValues;

                // If using corrected values, replace allRmsValues for normalization
                if (finalRmsValues !== allRmsValues) {
                  for (
                    let i = 0;
                    i < WAVEFORM_BAR_COUNT && i < finalRmsValues.length;
                    i++
                  ) {
                    allRmsValues[i] = finalRmsValues[i];
                  }
                }

                const finalNormalizedHeights =
                  normalizeRmsToHeights(allRmsValues);

                // Store actual decoded duration if available
                const actualDuration =
                  chunk.actual_duration_ms != null
                    ? chunk.actual_duration_ms / 1000
                    : null;

                if (actualDuration != null) {
                  setWaveformActualDuration((prev) => {
                    const next = new Map(prev);
                    next.set(trackId, actualDuration);
                    return next;
                  });
                }

                // Final chunk - save normalized data to cache
                setWaveformCache((prev) => {
                  const next = new Map(prev);
                  next.set(trackId, {
                    heights: finalNormalizedHeights,
                    isLoaded: true,
                    actualDuration,
                  });
                  return next;
                });
                setStreamingHeights(null);
                setLoadingId(null);
                return;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.warn("[Waveform] Failed to fetch waveform:", error);
        setLoadingId(null);
      }
    };

    fetchWaveformStreaming();

    return () => {
      abortController.abort();
    };
  }, [
    trackId,
    waveformCache,
    setWaveformCache,
    setWaveformActualDuration,
    setLoadingId,
    setLastChunkInfo,
  ]);

  // Get current waveform data
  const waveformData = trackId ? waveformCache.get(trackId) : null;
  const isLoading = loadingId === trackId && !waveformData?.isLoaded;

  // Priority: streaming > cached > flat
  const heights =
    streamingHeights ??
    waveformData?.heights ??
    Array(WAVEFORM_BAR_COUNT).fill(FLAT_BAR_HEIGHT);

  return {
    heights,
    isLoaded: waveformData?.isLoaded ?? false,
    isLoading,
    barCount: WAVEFORM_BAR_COUNT,
  };
}
