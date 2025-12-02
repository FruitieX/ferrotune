"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { queueAtom, queueIndexAtom, isRestoringQueueAtom, queueSaveRequestAtom, createQueueItems } from "@/lib/store/queue";
import { currentTimeAtom } from "@/lib/store/player";
import { getClient } from "@/lib/api/client";
import { useAuth } from "./use-auth";

// Debounce time for saving queue (ms)
const SAVE_DEBOUNCE_MS = 2000;

/**
 * Hook to persist the play queue to the server.
 * - Saves the queue when it changes (debounced)
 * - Saves immediately when a new queue replaces the old one
 * - Restores the queue on mount (if server has one)
 */
export function useQueuePersistence() {
  const { isConnected, isLoading } = useAuth();
  const [queue, setQueue] = useAtom(queueAtom);
  const [queueIndex, setQueueIndex] = useAtom(queueIndexAtom);
  const setIsRestoringQueue = useSetAtom(isRestoringQueueAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const saveRequest = useAtomValue(queueSaveRequestAtom);
  
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRestoringRef = useRef(false);
  const lastSavedRef = useRef<string>("");
  const hasRestoredRef = useRef(false);
  
  // Use refs to avoid recreating the save function on every render
  const stateRef = useRef({ queue, queueIndex, currentTime, isConnected });
  stateRef.current = { queue, queueIndex, currentTime, isConnected };

  // Core save function - uses refs to avoid stale closures
  const saveQueueInternal = async (immediate: boolean = false) => {
    const { queue, queueIndex, currentTime, isConnected } = stateRef.current;
    
    if (!isConnected || isRestoringRef.current) return;
    
    const client = getClient();
    if (!client) return;
    
    const songIds = queue.map((item) => item.song.id);
    const currentSongId = queueIndex >= 0 && queueIndex < queue.length 
      ? queue[queueIndex].song.id 
      : undefined;
    
    // Create a signature to avoid redundant saves (but skip check for immediate saves)
    // Don't include position in signature - we only want to save on queue/index changes
    const signature = JSON.stringify({ songIds, currentSongId });
    if (!immediate && signature === lastSavedRef.current) return;
    
    try {
      await client.savePlayQueue({
        songIds,
        current: currentSongId,
        position: Math.floor(currentTime * 1000), // Convert to milliseconds
      });
      lastSavedRef.current = signature;
    } catch (error) {
      console.error("Failed to save play queue:", error);
    }
  };

  // Immediate save when saveRequest changes (triggered by playNowAtom)
  useEffect(() => {
    if (saveRequest > 0 && !isRestoringRef.current) {
      // Clear any pending debounced save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      // Save immediately
      saveQueueInternal(true);
    }
  }, [saveRequest]);

  // Debounced save when queue or index changes (NOT on currentTime changes)
  useEffect(() => {
    if (!isConnected || isRestoringRef.current) return;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      saveQueueInternal(false);
    }, SAVE_DEBOUNCE_MS);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [isConnected, queue, queueIndex]); // Removed saveQueue dependency - now uses refs

  // Restore queue on mount
  useEffect(() => {
    async function restoreQueue() {
      if (!isConnected || isLoading) return;
      
      // Only attempt restore once per session
      if (hasRestoredRef.current) return;
      hasRestoredRef.current = true;
      
      const client = getClient();
      if (!client) return;
      
      try {
        isRestoringRef.current = true;
        setIsRestoringQueue(true);
        const response = await client.getPlayQueue();
        
        const entries = response.playQueue?.entry;
        if (entries && entries.length > 0) {
          // Convert songs to queue items with unique IDs
          const queueItems = createQueueItems(entries);
          
          // Find the index of the current track
          let startIndex = 0;
          if (response.playQueue.current) {
            const currentIdx = entries.findIndex(
              (s) => s.id === response.playQueue.current
            );
            if (currentIdx >= 0) {
              startIndex = currentIdx;
            }
          }
          
          // Restore the queue (but don't auto-play)
          setQueue(queueItems);
          setQueueIndex(startIndex);
          
          // Store signature to avoid immediate re-save
          lastSavedRef.current = JSON.stringify({
            songIds: entries.map((s) => s.id),
            currentSongId: response.playQueue.current,
            position: response.playQueue.position ? Math.floor(response.playQueue.position / 1000) : 0,
          });
        }
      } catch (error) {
        // Queue not found or error - that's okay, start fresh
        console.debug("No saved play queue found:", error);
        setIsRestoringQueue(false);
      } finally {
        isRestoringRef.current = false;
        // Note: We don't clear isRestoringQueueAtom here - it stays true until
        // the user explicitly presses play. This prevents auto-play on page load
        // which violates browser autoplay policies.
      }
    }
    
    restoreQueue();
  }, [isConnected, isLoading, setIsRestoringQueue, setQueue, setQueueIndex]);
}
