"use client";

/**
 * Playback state effects: pause on "ended", pause on remote control, repeat mode sync.
 *
 * Extracted from useAudioEngineInit — Effects 11, 12, 16.
 */

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { playbackStateAtom } from "@/lib/store/player";
import { serverQueueStateAtom } from "@/lib/store/server-queue";
import { isRemoteControllingAtom } from "@/lib/store/session";
import { nativePause, nativeSetRepeatMode } from "@/lib/audio/native-engine";
import {
  audioElements,
  activeIndex,
  getActiveAudio,
} from "@/lib/audio/web-audio";
import {
  usingNativeAudio,
  setIsEndingQueue,
  setIsIntentionalStop,
} from "@/lib/audio/engine-state";
import { nativeAutonomousMode } from "@/lib/store/server-queue";

export function usePlaybackStateEffects() {
  const playbackState = useAtomValue(playbackStateAtom);
  const isRemoteControlling = useAtomValue(isRemoteControllingAtom);
  const queueState = useAtomValue(serverQueueStateAtom);

  // Pause audio when playback state becomes "ended" (e.g., when queue ends via goToNext)
  useEffect(() => {
    if (
      playbackState === "ended" &&
      audioElements[activeIndex] &&
      !audioElements[activeIndex]!.paused
    ) {
      // Set flag to prevent handlePause from overwriting "ended" state with "paused"
      setIsEndingQueue(true);
      audioElements[activeIndex]!.pause();
    }
  }, [playbackState]);

  // Pause local audio when switching to remote control mode.
  // This prevents the local audio from continuing to play while
  // we're controlling another session, and ensures the progress bar
  // uses atom-based values (driven by SSE) instead of audio element state.
  useEffect(() => {
    if (!isRemoteControlling) return;
    if (usingNativeAudio) {
      nativePause().catch(console.error);
    } else {
      const audio = getActiveAudio();
      if (audio && !audio.paused) {
        setIsIntentionalStop(true);
        audio.pause();
        setTimeout(() => {
          setIsIntentionalStop(false);
        }, 200);
      }
    }
  }, [isRemoteControlling]);

  // Sync repeat mode to native player when it changes
  useEffect(() => {
    if (!usingNativeAudio || !queueState?.repeatMode) return;
    // In autonomous mode, Kotlin handles repeat mode changes via its own SSE handler.
    if (nativeAutonomousMode.value) return;
    nativeSetRepeatMode(queueState.repeatMode).catch(console.error);
  }, [queueState?.repeatMode]);
}
