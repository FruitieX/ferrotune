"use client";

/**
 * Audio engine hooks — thin orchestrator.
 *
 * `useAudioEngineInit()` wires up shared refs and delegates to focused
 * sub-hooks, each responsible for a well-defined slice of audio behaviour.
 *
 * `useAudioEngine()` provides playback controls (play/pause/seek/next/prev)
 * and can be called from any component.
 */

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSeekControl,
  getCurrentStreamTimeOffset,
  setCurrentStreamTimeOffset,
} from "./seeking-control";
import {
  playbackStateAtom,
  playbackErrorAtom,
  currentTimeAtom,
  durationAtom,
  bufferedAtom,
  hasScrobbledAtom,
  scrobbleThresholdAtom,
  audioElementAtom,
  transcodingEnabledAtom,
  transcodingBitrateAtom,
  transcodingSeekModeAtom,
  replayGainModeAtom,
  replayGainOffsetAtom,
  clippingStateAtom,
  clippingDetectionEnabledAtom,
} from "@/lib/store/player";
import {
  serverQueueStateAtom,
  currentSongAtom,
  nextSongAtom,
  isRestoringQueueAtom,
  trackChangeSignalAtom,
  goToNextAtom,
  goToPreviousAtom,
  queueWindowAtom,
  playAtIndexAtom,
} from "@/lib/store/server-queue";
import { serverConnectionAtom } from "@/lib/store/auth";
import { getClient } from "@/lib/api/client";
import { invalidatePlayCountQueries as invalidatePlayCounts } from "@/lib/api/cache-invalidation";
import { starredItemsAtom } from "@/lib/store/starred";
import {
  nativePlay,
  nativePause,
  nativeSeek,
  nativeNextTrack,
  nativePreviousTrack,
} from "@/lib/audio/native-engine";
import {
  isRemoteControllingAtom,
  remotePlaybackStateAtom,
  currentSessionIdAtom,
  effectiveSessionIdAtom,
} from "@/lib/store/session";
import { logListeningTimeAndReset } from "@/lib/audio/listening";
import {
  resumeAudioContext,
  getActiveAudio,
  invalidatePreBuffer,
} from "@/lib/audio/web-audio";
import {
  usingNativeAudio,
  setCurrentLoadedTrackId,
  setIsGaplessHandoff,
  setGaplessHandoffExpectedTrackId,
  setIsLoadingNewTrack,
} from "@/lib/audio/engine-state";
import type { EngineStateSnapshot, EngineSetters } from "./engine-types";

// Sub-hooks
import { useAudioLifecycle } from "./use-audio-lifecycle";
import { useAudioInit } from "./use-audio-init";
import { useNativeSessionInit } from "./use-native-session-init";
import { useSettingsSync } from "./use-settings-sync";
import { usePlaybackStateEffects } from "./use-playback-state-effects";
import { useTrackLoader } from "./use-track-loader";

// Re-export hooks from extracted modules
export { useMediaSession } from "@/lib/audio/media-session";
export {
  useVolumeControl,
  useRepeatMode,
  useShuffle,
} from "@/lib/audio/playback-controls";
// Re-export for external consumers
export { getGlobalAudio } from "@/lib/audio/web-audio";

// ============================================================================
// useAudioEngineInit — call ONCE in a top-level component
// ============================================================================

/**
 * Hook to initialize the audio engine. Should be called ONCE in a top-level component.
 * Sets up audio elements, event listeners, and all reactive effects.
 */
export function useAudioEngineInit() {
  const queryClient = useQueryClient();

  // --- Atom subscriptions needed for the shared refs ---
  const [playbackState, setPlaybackState] = useAtom(playbackStateAtom);
  const setPlaybackError = useSetAtom(playbackErrorAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setBuffered = useSetAtom(bufferedAtom);
  const [hasScrobbled, setHasScrobbled] = useAtom(hasScrobbledAtom);
  const scrobbleThreshold = useAtomValue(scrobbleThresholdAtom);
  const setAudioElement = useSetAtom(audioElementAtom);
  const setClippingState = useSetAtom(clippingStateAtom);
  const clippingDetectionEnabled = useAtomValue(clippingDetectionEnabledAtom);
  const setStarredItems = useSetAtom(starredItemsAtom);
  const starredItems = useAtomValue(starredItemsAtom);

  const transcodingEnabled = useAtomValue(transcodingEnabledAtom);
  const transcodingBitrate = useAtomValue(transcodingBitrateAtom);
  const replayGainMode = useAtomValue(replayGainModeAtom);
  const replayGainOffset = useAtomValue(replayGainOffsetAtom);

  const [queueState, setServerQueueState] = useAtom(serverQueueStateAtom);
  const [queueWindow, setQueueWindow] = useAtom(queueWindowAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const nextSong = useAtomValue(nextSongAtom);
  const isRestoringQueue = useAtomValue(isRestoringQueueAtom);
  const goToNext = useSetAtom(goToNextAtom);
  const goToPrevious = useSetAtom(goToPreviousAtom);

  const serverConnection = useAtomValue(serverConnectionAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);

  // --- Shared refs (single source of truth for callbacks & sub-hooks) ---

  const invalidatePlayCountQueries = () => {
    invalidatePlayCounts(queryClient);
  };

  const settersRef = useRef<EngineSetters>({
    setPlaybackState,
    setPlaybackError,
    setCurrentTime,
    setDuration,
    setBuffered,
    setHasScrobbled,
    setAudioElement,
    setClippingState,
    invalidatePlayCountQueries,
    goToNext,
    goToPrevious,
    setServerQueueState,
    setQueueWindow,
    setStarredItems,
  });

  useEffect(() => {
    settersRef.current = {
      setPlaybackState,
      setPlaybackError,
      setCurrentTime,
      setDuration,
      setBuffered,
      setHasScrobbled,
      setAudioElement,
      setClippingState,
      invalidatePlayCountQueries,
      goToNext,
      goToPrevious,
      setServerQueueState,
      setQueueWindow,
      setStarredItems,
    };
  });

  const stateRef = useRef<EngineStateSnapshot>({
    playbackState,
    hasScrobbled,
    scrobbleThreshold,
    currentSong,
    nextSong,
    queueState,
    queueWindow,
    isRestoringQueue,
    transcodingEnabled,
    transcodingBitrate,
    replayGainMode,
    replayGainOffset,
    clippingDetectionEnabled,
    starredItems,
    serverConnection,
    currentSessionId,
  });

  useEffect(() => {
    stateRef.current = {
      playbackState,
      hasScrobbled,
      scrobbleThreshold,
      currentSong,
      nextSong,
      queueState,
      queueWindow,
      isRestoringQueue,
      transcodingEnabled,
      transcodingBitrate,
      replayGainMode,
      replayGainOffset,
      clippingDetectionEnabled,
      starredItems,
      serverConnection,
      currentSessionId,
    };
  });

  const lastProcessedSignalRef = useRef<number>(-1);
  const lastStreamUrlRef = useRef<string | null>(null);

  // --- Delegate to sub-hooks ---

  useAudioLifecycle({ settersRef, lastProcessedSignalRef });
  useAudioInit({ stateRef, settersRef, lastStreamUrlRef });
  useNativeSessionInit({ stateRef });
  useSettingsSync();
  usePlaybackStateEffects();
  useTrackLoader({
    stateRef,
    settersRef,
    lastProcessedSignalRef,
    lastStreamUrlRef,
  });
}

// ============================================================================
// useAudioEngine — playback controls, usable from any component
// ============================================================================

/**
 * Hook for playback controls. Can be used in any component.
 * Does NOT set up audio - that's done by useAudioEngineInit.
 */
export function useAudioEngine() {
  const [playbackState, setPlaybackState] = useAtom(playbackStateAtom);
  const setPlaybackError = useSetAtom(playbackErrorAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setBuffered = useSetAtom(bufferedAtom);
  const duration = useAtomValue(durationAtom);

  const currentSong = useAtomValue(currentSongAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const goToNextAction = useSetAtom(goToNextAtom);
  const goToPreviousAction = useSetAtom(goToPreviousAtom);
  const playAtIndex = useSetAtom(playAtIndexAtom);
  const setIsRestoring = useSetAtom(isRestoringQueueAtom);
  const setTrackChangeSignal = useSetAtom(trackChangeSignalAtom);

  // Remote control awareness
  const isRemoteControlling = useAtomValue(isRemoteControllingAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const effectiveSessionId = useAtomValue(effectiveSessionIdAtom);
  const remotePlaybackState = useAtomValue(remotePlaybackStateAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);

  // Transcoding settings (needed for time-offset seeking)
  const transcodingEnabled = useAtomValue(transcodingEnabledAtom);
  const transcodingBitrate = useAtomValue(transcodingBitrateAtom);
  const transcodingSeekMode = useAtomValue(transcodingSeekModeAtom);

  // Retry playback by forcing a fresh load of the current track
  const retryPlayback = () => {
    if (!currentSong) return;

    const client = getClient();
    if (!client) return;

    // Clear error state
    setPlaybackError(null);
    setPlaybackState("loading");

    // Force reload by clearing cached state
    setCurrentLoadedTrackId(null);
    invalidatePreBuffer();

    if (usingNativeAudio) {
      setTrackChangeSignal((prev) => prev + 1);
    } else {
      const audio = getActiveAudio();
      if (audio) {
        const streamUrl = client.getStreamUrl(currentSong.id);
        audio.src = streamUrl;
        setCurrentStreamTimeOffset(0);
        setIsLoadingNewTrack(true);
        resumeAudioContext().then((contextRunning) => {
          if (!contextRunning) {
            console.error("[Audio] Cannot retry: AudioContext not running");
          }
          audio.play().catch((err) => {
            console.error("[Audio] Retry playback failed:", err);
            setPlaybackState("error");
          });
        });
      }
    }
  };

  // Helper: send a remote command to the controlled/followed session
  const sendRemoteCommand = async (action: string, positionMs?: number) => {
    const targetSessionId = effectiveSessionId;
    if (!targetSessionId) return;
    const client = getClient();
    if (!client) return;
    try {
      await client.sendSessionCommand(targetSessionId, action, positionMs);
    } catch (error) {
      console.error(`Failed to send remote command '${action}':`, error);
    }
  };

  const play = async () => {
    if (isRemoteControlling) {
      setRemotePlaybackState((prev) =>
        prev ? { ...prev, isPlaying: true } : prev,
      );
      await sendRemoteCommand("play");
      return;
    }
    setIsRestoring(false);
    if (usingNativeAudio) {
      nativePlay().catch(console.error);
    } else {
      const contextRunning = await resumeAudioContext();
      if (!contextRunning) {
        console.error("[Audio] Cannot play: AudioContext not running");
      }
      getActiveAudio()?.play().catch(console.error);
    }
    broadcastPlaybackState({ isPlaying: true });
  };

  const pause = () => {
    if (isRemoteControlling) {
      setRemotePlaybackState((prev) =>
        prev ? { ...prev, isPlaying: false } : prev,
      );
      sendRemoteCommand("pause");
      return;
    }
    if (usingNativeAudio) {
      nativePause().catch(console.error);
    } else {
      getActiveAudio()?.pause();
    }
    broadcastPlaybackState({ isPlaying: false });
  };

  const restartQueue = () => {
    if (!queueState || queueState.totalCount === 0) return;
    setCurrentLoadedTrackId(null);
    setIsRestoring(false);
    playAtIndex(0);
  };

  const togglePlayPause = () => {
    if (isRemoteControlling) {
      if (remotePlaybackState?.isPlaying) {
        setRemotePlaybackState((prev) =>
          prev ? { ...prev, isPlaying: false } : prev,
        );
        sendRemoteCommand("pause");
      } else {
        setRemotePlaybackState((prev) =>
          prev ? { ...prev, isPlaying: true } : prev,
        );
        sendRemoteCommand("play");
      }
      return;
    }
    if (!usingNativeAudio && !getActiveAudio()) return;

    if (playbackState === "playing" || playbackState === "loading") {
      pause();
    } else if (playbackState === "ended") {
      restartQueue();
    } else if (playbackState === "error") {
      retryPlayback();
    } else {
      play();
    }
  };

  const { seek, seekPercent, broadcastPlaybackState } = useSeekControl({
    currentSong,
    duration,
    transcodingEnabled,
    transcodingBitrate,
    transcodingSeekMode,
    queueState,
    playbackState,
    currentSessionId,
    isRemoteControlling,
    usingNativeAudio,
    setCurrentTime,
    setBuffered,
    sendRemoteCommand,
    nativeSeek,
  });

  const next = () => {
    if (isRemoteControlling) {
      sendRemoteCommand("next");
      return;
    }
    logListeningTimeAndReset(true);
    setIsRestoring(false);
    invalidatePreBuffer();
    setIsGaplessHandoff(false);
    setGaplessHandoffExpectedTrackId(null);
    if (usingNativeAudio) {
      nativeNextTrack().catch(console.error);
      return;
    }
    goToNextAction();
  };

  const previousInternal = (force: boolean) => {
    if (isRemoteControlling) {
      sendRemoteCommand("previous");
      return;
    }
    setIsRestoring(false);

    if (usingNativeAudio) {
      logListeningTimeAndReset(true);
      if (force) {
        nativeSeek(0)
          .then(() => nativePreviousTrack())
          .catch(console.error);
      } else {
        nativePreviousTrack().catch(console.error);
      }
      return;
    }

    if (!force) {
      const audio = getActiveAudio();
      const realTime = audio
        ? audio.currentTime + getCurrentStreamTimeOffset()
        : 0;
      if (audio && realTime > 3) {
        seek(0);
        return;
      }

      if (
        queueState &&
        queueState.currentIndex === 0 &&
        queueState.repeatMode !== "all"
      ) {
        if (audio) seek(0);
        return;
      }
    }

    logListeningTimeAndReset(true);
    invalidatePreBuffer();
    setIsGaplessHandoff(false);
    setGaplessHandoffExpectedTrackId(null);
    goToPreviousAction();
  };

  return {
    play,
    pause,
    togglePlayPause,
    seek,
    seekPercent,
    next,
    previous: () => previousInternal(false),
    previousForce: () => previousInternal(true),
    retryPlayback,
    playbackState,
  };
}
