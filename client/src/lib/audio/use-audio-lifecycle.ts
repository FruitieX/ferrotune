"use client";

/**
 * Audio lifecycle effects: initial queue fetch, Android resume sync,
 * and user account change reset.
 *
 * Extracted from useAudioEngineInit — Effects 3, 4, 5.
 */

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  playbackStateAtom,
  currentTimeAtom,
  durationAtom,
  bufferedAtom,
  hasScrobbledAtom,
} from "@/lib/store/player";
import {
  serverQueueStateAtom,
  fetchQueueAtom,
  queueWindowAtom,
} from "@/lib/store/server-queue";
import {
  serverConnectionAtom,
  isHydratedAtom,
  accountKey,
} from "@/lib/store/auth";
import { currentSessionIdAtom } from "@/lib/store/session";
import { getClient } from "@/lib/api/client";
import { nativeStop, nativeGetState } from "@/lib/audio/native-engine";
import {
  appResumeRepaintEvent,
  isAndroidTauriWebView,
} from "@/lib/utils/app-resume-repaint";
import { getActiveAudio } from "@/lib/audio/web-audio";
import {
  usingNativeAudio,
  setIsIntentionalStop,
  resetEngineState,
} from "@/lib/audio/engine-state";
import type { EngineSetters } from "./engine-types";

interface LifecycleDeps {
  settersRef: React.RefObject<EngineSetters>;
  lastProcessedSignalRef: React.MutableRefObject<number>;
}

export function useAudioLifecycle({
  settersRef,
  lastProcessedSignalRef,
}: LifecycleDeps) {
  const serverConnection = useAtomValue(serverConnectionAtom);
  const isHydrated = useAtomValue(isHydratedAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const fetchQueue = useSetAtom(fetchQueueAtom);

  // Ref to avoid stale closure in event listeners
  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  });

  // Direct atom setters for account-change reset
  const setPlaybackState = useSetAtom(playbackStateAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setBuffered = useSetAtom(bufferedAtom);
  const setHasScrobbled = useSetAtom(hasScrobbledAtom);
  const setServerQueueState = useSetAtom(serverQueueStateAtom);
  const setQueueWindow = useSetAtom(queueWindowAtom);

  // Track if we've fetched the initial queue
  const hasInitialFetchRef = useRef(false);

  // Fetch initial queue on mount - wait for hydration and client to be ready
  useEffect(() => {
    if (!isHydrated) return;
    if (!serverConnection) return;
    if (!currentSessionId) return;
    if (hasInitialFetchRef.current) return;
    const client = getClient();
    if (!client) return;
    hasInitialFetchRef.current = true;
    fetchQueue();
  }, [isHydrated, serverConnection, currentSessionId, fetchQueue]);

  // Re-fetch queue state when the app resumes from background on Android
  useEffect(() => {
    if (!isAndroidTauriWebView()) return;

    const handleResume = async () => {
      if (usingNativeAudio) {
        try {
          const nativeState = await nativeGetState();
          settersRef.current.setPlaybackState(nativeState.state);
          settersRef.current.setCurrentTime(nativeState.positionSeconds);
          settersRef.current.setDuration(nativeState.durationSeconds);
          settersRef.current.setServerQueueState((prev) =>
            prev
              ? {
                  ...prev,
                  currentIndex: nativeState.queueIndex,
                  positionMs: nativeState.positionSeconds * 1000,
                }
              : prev,
          );

          // The native player is the source of truth.
          // Sync its position to the server *before* fetchQueue() so the
          // server response won't contain a stale currentIndex that
          // overwrites the correct native position and causes a track jump.
          if (nativeState.state !== "idle") {
            const client = getClient();
            const sessionId = currentSessionIdRef.current;
            if (client && sessionId) {
              try {
                await client.updateServerQueuePosition(
                  nativeState.queueIndex,
                  Math.round(nativeState.positionSeconds * 1000),
                  false,
                  sessionId,
                );
              } catch (e) {
                console.warn(
                  "[Audio] Failed to sync native position to server on resume:",
                  e,
                );
              }
            }
          }
        } catch (e) {
          console.warn("[Audio] Failed to sync native state on resume:", e);
        }
      }
      fetchQueue();
    };

    window.addEventListener(appResumeRepaintEvent, handleResume);
    return () => {
      window.removeEventListener(appResumeRepaintEvent, handleResume);
    };
  }, [fetchQueue, settersRef]);

  // Reset playback and queue when user account changes (user switch)
  const previousAccountKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentKey = serverConnection ? accountKey(serverConnection) : null;

    // Skip on initial mount
    if (previousAccountKeyRef.current === undefined) {
      previousAccountKeyRef.current = currentKey;
      return;
    }

    // Skip if same account
    if (previousAccountKeyRef.current === currentKey) {
      return;
    }

    previousAccountKeyRef.current = currentKey;

    // Stop playback and reset all audio state
    if (usingNativeAudio) {
      nativeStop().catch(console.error);
    } else {
      const audio = getActiveAudio();
      if (audio) {
        setIsIntentionalStop(true);
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    }

    // Reset module-level state
    resetEngineState();
    lastProcessedSignalRef.current = -1;

    // Reset atoms
    setPlaybackState("idle");
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setHasScrobbled(false);
    setServerQueueState(null);
    setQueueWindow(null);

    // Re-fetch queue for new user
    if (currentKey) {
      fetchQueue();
    }
  }, [
    serverConnection,
    fetchQueue,
    setPlaybackState,
    setCurrentTime,
    setDuration,
    setBuffered,
    setHasScrobbled,
    setServerQueueState,
    setQueueWindow,
    lastProcessedSignalRef,
  ]);
}
