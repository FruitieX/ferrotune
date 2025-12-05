"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  serverQueueStateAtom,
  queueWindowAtom,
  fetchQueueAtom,
  fetchQueueRangeAtom,
  isRestoringQueueAtom,
} from "@/lib/store/server-queue";
import { useAuth } from "./use-auth";

// Size of the buffer around the current position
const BUFFER_RADIUS = 20;
// Threshold for pre-fetching (when within N items of buffer edge)
const PREFETCH_THRESHOLD = 5;

/**
 * Hook to manage the playback buffer for server-side queue.
 * 
 * Maintains a window of ±BUFFER_RADIUS songs around the current position,
 * pre-fetching the next window when approaching the buffer edge.
 */
export function useQueueBuffer() {
  const { isConnected, isLoading: authLoading } = useAuth();
  
  const queueState = useAtomValue(serverQueueStateAtom);
  const queueWindow = useAtomValue(queueWindowAtom);
  
  const fetchQueue = useSetAtom(fetchQueueAtom);
  const fetchQueueRange = useSetAtom(fetchQueueRangeAtom);
  const setIsRestoring = useSetAtom(isRestoringQueueAtom);
  
  // Track if we've done initial fetch
  const hasInitializedRef = useRef(false);
  const lastFetchedIndexRef = useRef<number>(-1);
  const isFetchingRef = useRef(false);

  // Initial queue fetch on mount
  useEffect(() => {
    if (!isConnected || authLoading || hasInitializedRef.current) return;
    
    hasInitializedRef.current = true;
    setIsRestoring(true);
    
    fetchQueue().then(() => {
      // Keep restoring flag true until user explicitly plays
    });
  }, [isConnected, authLoading, fetchQueue, setIsRestoring]);

  // Pre-fetch buffer when approaching edges
  const checkAndPrefetch = useCallback(async () => {
    if (!queueState || !queueWindow || isFetchingRef.current) return;
    
    const currentIndex = queueState.currentIndex;
    const totalCount = queueState.totalCount;
    
    // Don't refetch if we're at the same position
    if (lastFetchedIndexRef.current === currentIndex) return;
    
    // Calculate current window bounds
    const windowStart = queueWindow.offset;
    const windowEnd = windowStart + queueWindow.songs.length - 1;
    
    // Check if current position is near the edge of the buffer
    const distanceToStart = currentIndex - windowStart;
    const distanceToEnd = windowEnd - currentIndex;
    
    let needsFetch = false;
    let fetchOffset = 0;
    let fetchLimit = 0;
    
    // Near start of buffer - need to fetch backwards
    if (distanceToStart < PREFETCH_THRESHOLD && windowStart > 0) {
      fetchOffset = Math.max(0, windowStart - BUFFER_RADIUS);
      fetchLimit = windowStart - fetchOffset;
      needsFetch = true;
    }
    // Near end of buffer - need to fetch forwards
    else if (distanceToEnd < PREFETCH_THRESHOLD && windowEnd < totalCount - 1) {
      fetchOffset = windowEnd + 1;
      fetchLimit = Math.min(BUFFER_RADIUS, totalCount - fetchOffset);
      needsFetch = true;
    }
    // Current position outside loaded window entirely
    else if (currentIndex < windowStart || currentIndex > windowEnd) {
      fetchOffset = Math.max(0, currentIndex - BUFFER_RADIUS);
      fetchLimit = Math.min(BUFFER_RADIUS * 2 + 1, totalCount - fetchOffset);
      needsFetch = true;
    }
    
    if (needsFetch && fetchLimit > 0) {
      isFetchingRef.current = true;
      lastFetchedIndexRef.current = currentIndex;
      
      try {
        await fetchQueueRange({ offset: fetchOffset, limit: fetchLimit });
      } finally {
        isFetchingRef.current = false;
      }
    }
  }, [queueState, queueWindow, fetchQueueRange]);

  // Check buffer on position changes
  useEffect(() => {
    checkAndPrefetch();
  }, [queueState?.currentIndex, checkAndPrefetch]);

  // Return current state for external use
  return {
    isBufferReady: queueWindow !== null && queueWindow.songs.length > 0,
    bufferStart: queueWindow?.offset ?? 0,
    bufferEnd: queueWindow ? queueWindow.offset + queueWindow.songs.length - 1 : 0,
    totalCount: queueState?.totalCount ?? 0,
    currentIndex: queueState?.currentIndex ?? 0,
  };
}

/**
 * Hook to initialize the server-side queue on app start.
 * Should be used once at the app level.
 */
export function useServerQueueInit() {
  const { isConnected, isLoading } = useAuth();
  const fetchQueue = useSetAtom(fetchQueueAtom);
  const setIsRestoring = useSetAtom(isRestoringQueueAtom);
  
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (!isConnected || isLoading || hasInitializedRef.current) return;
    
    hasInitializedRef.current = true;
    setIsRestoring(true);
    
    fetchQueue().catch((error) => {
      console.debug("No queue to restore:", error);
    });
  }, [isConnected, isLoading, fetchQueue, setIsRestoring]);
}
