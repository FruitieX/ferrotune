"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { queueAtom, queueIndexAtom, isRestoringQueueAtom } from "@/lib/store/queue";
import { currentTimeAtom } from "@/lib/store/player";
import { getClient } from "@/lib/api/client";
import { useAuth } from "./use-auth";

// Debounce time for saving queue (ms)
const SAVE_DEBOUNCE_MS = 2000;

/**
 * Hook to persist the play queue to the server.
 * - Saves the queue when it changes (debounced)
 * - Restores the queue on mount (if server has one)
 */
export function useQueuePersistence() {
  const { isConnected, isLoading } = useAuth();
  const [queue, setQueue] = useAtom(queueAtom);
  const [queueIndex, setQueueIndex] = useAtom(queueIndexAtom);
  const setIsRestoringQueue = useSetAtom(isRestoringQueueAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRestoringRef = useRef(false);
  const lastSavedRef = useRef<string>("");

  // Save queue to server (debounced)
  const saveQueue = useCallback(async () => {
    if (!isConnected || isRestoringRef.current) return;
    
    const client = getClient();
    if (!client) return;
    
    const songIds = queue.map((s) => s.id);
    const currentSongId = queueIndex >= 0 && queueIndex < queue.length 
      ? queue[queueIndex].id 
      : undefined;
    
    // Create a signature to avoid redundant saves
    const signature = JSON.stringify({ songIds, currentSongId, position: Math.floor(currentTime) });
    if (signature === lastSavedRef.current) return;
    
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
  }, [isConnected, queue, queueIndex, currentTime]);

  // Debounced save when queue or index changes
  useEffect(() => {
    if (!isConnected || isRestoringRef.current) return;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      saveQueue();
    }, SAVE_DEBOUNCE_MS);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [isConnected, queue, queueIndex, saveQueue]);

  // Restore queue on mount
  useEffect(() => {
    async function restoreQueue() {
      if (!isConnected || isLoading) return;
      
      const client = getClient();
      if (!client) return;
      
      // Don't restore if we already have a queue
      if (queue.length > 0) return;
      
      try {
        isRestoringRef.current = true;
        setIsRestoringQueue(true);
        const response = await client.getPlayQueue();
        
        const entries = response.playQueue?.entry;
        if (entries && entries.length > 0) {
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
          setQueue(entries);
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
      } finally {
        isRestoringRef.current = false;
        // Clear restoring flag after a short delay to ensure the audio hook has processed
        setTimeout(() => setIsRestoringQueue(false), 100);
      }
    }
    
    restoreQueue();
  }, [isConnected, isLoading, setIsRestoringQueue]); // Only run on connection change
}
