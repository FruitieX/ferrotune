"use client";

/**
 * Bridges Jotai queue atoms ↔ React Query cache so that queue/now-playing
 * data is persisted to IndexedDB via the existing per-account persister.
 *
 * On startup: restores cached queue data into Jotai atoms immediately
 * (before the server fetch completes), giving the player bar instant data.
 *
 * During use: keeps the React Query cache entries in sync with Jotai atoms
 * so that subsequent persists write the latest queue state to IndexedDB.
 */

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  serverQueueStateAtom,
  queueWindowAtom,
  isRestoringQueueAtom,
  type ServerQueueState,
} from "@/lib/store/server-queue";
import { playbackStateAtom } from "@/lib/store/player";
import type { QueueWindow } from "@/lib/api/types";

const QUEUE_STATE_KEY = ["queue", "state"] as const;
const QUEUE_WINDOW_KEY = ["queue", "window"] as const;

/**
 * Restores queue data from React Query cache (IndexedDB) into Jotai atoms
 * on initial mount, and keeps the cache in sync as atoms change.
 */
export function useQueueCacheSync(isCacheRestored: boolean) {
  const queryClient = useQueryClient();
  const queueState = useAtomValue(serverQueueStateAtom);
  const queueWindow = useAtomValue(queueWindowAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const playbackStateRef = useRef(playbackState);
  const setServerQueueState = useSetAtom(serverQueueStateAtom);
  const setQueueWindow = useSetAtom(queueWindowAtom);
  const setIsRestoring = useSetAtom(isRestoringQueueAtom);

  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  // Restore: cache → atoms (once, when IndexedDB cache is restored)
  useEffect(() => {
    if (!isCacheRestored) return;

    const cachedState = queryClient.getQueryData<ServerQueueState>(
      QUEUE_STATE_KEY as unknown as readonly string[],
    );
    const cachedWindow = queryClient.getQueryData<QueueWindow>(
      QUEUE_WINDOW_KEY as unknown as readonly string[],
    );

    if (cachedState && cachedWindow) {
      setServerQueueState((current) => {
        // Only restore if atoms haven't been populated by a server fetch yet
        if (current !== null) return current;
        return cachedState;
      });
      setQueueWindow((current) => {
        if (current !== null) return current;
        return cachedWindow;
      });

      const currentPlaybackState = playbackStateRef.current;
      if (
        currentPlaybackState !== "loading" &&
        currentPlaybackState !== "playing"
      ) {
        // Prevent autoplay from cached data, but never let late cache hydration
        // override an explicit playback request that already reached the audio engine.
        setIsRestoring(true);
      }
    }
  }, [
    isCacheRestored,
    queryClient,
    setServerQueueState,
    setQueueWindow,
    setIsRestoring,
  ]);

  // Sync: atoms → cache (keep IndexedDB up to date)
  useEffect(() => {
    if (!isCacheRestored) return;

    if (queueState) {
      queryClient.setQueryData(QUEUE_STATE_KEY, queueState);
    } else {
      queryClient.removeQueries({
        queryKey: QUEUE_STATE_KEY as unknown as readonly string[],
      });
    }
  }, [isCacheRestored, queueState, queryClient]);

  useEffect(() => {
    if (!isCacheRestored) return;

    if (queueWindow) {
      queryClient.setQueryData(QUEUE_WINDOW_KEY, queueWindow);
    } else {
      queryClient.removeQueries({
        queryKey: QUEUE_WINDOW_KEY as unknown as readonly string[],
      });
    }
  }, [isCacheRestored, queueWindow, queryClient]);
}
