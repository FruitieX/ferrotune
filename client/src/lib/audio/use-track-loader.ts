"use client";

/**
 * Track loading hook: wraps loadTrackNative/loadTrackWeb with React effects,
 * plus ReplayGain live-update and queue window resync for native audio.
 *
 * Extracted from useAudioEngineInit — Effects 13, 14, 15.
 */

import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { isClientInitializedAtom } from "@/lib/store/auth";
import {
  playbackStateAtom,
  currentTimeAtom,
  durationAtom,
  bufferedAtom,
  hasScrobbledAtom,
  replayGainModeAtom,
  replayGainOffsetAtom,
  transcodingEnabledAtom,
  transcodingBitrateAtom,
} from "@/lib/store/player";
import {
  serverQueueStateAtom,
  currentSongAtom,
  isRestoringQueueAtom,
  trackChangeSignalAtom,
} from "@/lib/store/server-queue";
import { isRemoteControllingAtom } from "@/lib/store/session";
import { getClient } from "@/lib/api/client";
import { loadTrackNative, loadTrackWeb } from "@/lib/audio/track-loader";
import { usingNativeAudio } from "@/lib/audio/engine-state";
import { hasNativeAudio } from "@/lib/tauri";
import {
  activeIndex,
  getTrackReplayGain,
  setReplayGain,
  getGainNode,
} from "@/lib/audio/web-audio";
import type {
  EngineStateSnapshot,
  EngineSetters,
} from "@/lib/audio/engine-types";

interface UseTrackLoaderDeps {
  stateRef: React.RefObject<EngineStateSnapshot>;
  settersRef: React.RefObject<EngineSetters>;
  lastProcessedSignalRef: React.MutableRefObject<number>;
  lastStreamUrlRef: React.MutableRefObject<string | null>;
}

export function useTrackLoader({
  stateRef,
  settersRef,
  lastProcessedSignalRef,
  lastStreamUrlRef,
}: UseTrackLoaderDeps) {
  const setPlaybackState = useSetAtom(playbackStateAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setBuffered = useSetAtom(bufferedAtom);
  const setHasScrobbled = useSetAtom(hasScrobbledAtom);
  const isClientInitialized = useAtomValue(isClientInitializedAtom);

  const currentSong = useAtomValue(currentSongAtom);
  const trackChangeSignal = useAtomValue(trackChangeSignalAtom);
  const isRestoringQueue = useAtomValue(isRestoringQueueAtom);
  const isRemoteControlling = useAtomValue(isRemoteControllingAtom);
  const transcodingEnabled = useAtomValue(transcodingEnabledAtom);
  const transcodingBitrate = useAtomValue(transcodingBitrateAtom);
  const replayGainMode = useAtomValue(replayGainModeAtom);
  const replayGainOffset = useAtomValue(replayGainOffsetAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const isNativePlatform = hasNativeAudio() || usingNativeAudio;

  // Load new track when current song changes (triggered by trackChangeSignal or currentSong)
  // Also reload when transcoding settings change
  useEffect(() => {
    // Don't load audio when remote-controlling another session
    if (isRemoteControlling) return;
    if (!isClientInitialized) return;

    // Restored native queues are handled by the dedicated preload effect below.
    // That path waits for the native engine/session and materializes the queue
    // eagerly on startup without relying on a later user play press.
    if (isNativePlatform && isRestoringQueue && currentSong && queueState) {
      return;
    }

    const client = getClient();

    if (isNativePlatform) {
      if (!client) {
        // loadTrackNative handles the null-song case internally
        loadTrackNative(
          {
            currentSong,
            trackChangeSignal,
            isRestoringQueue,
            transcodingEnabled,
            transcodingBitrate,
            replayGainMode,
            replayGainOffset,
            queueState,
          },
          { lastProcessedSignalRef, lastStreamUrlRef, stateRef, settersRef },
          {
            setPlaybackState,
            setHasScrobbled,
            setCurrentTime,
            setBuffered,
            setDuration,
          },
          client!,
        );
      } else {
        loadTrackNative(
          {
            currentSong,
            trackChangeSignal,
            isRestoringQueue,
            transcodingEnabled,
            transcodingBitrate,
            replayGainMode,
            replayGainOffset,
            queueState,
          },
          { lastProcessedSignalRef, lastStreamUrlRef, stateRef, settersRef },
          {
            setPlaybackState,
            setHasScrobbled,
            setCurrentTime,
            setBuffered,
            setDuration,
          },
          client,
        );
      }
      return;
    }

    // Web audio path
    if (!client) return;
    loadTrackWeb(
      {
        currentSong,
        trackChangeSignal,
        isRestoringQueue,
        transcodingEnabled,
        transcodingBitrate,
        replayGainMode,
        replayGainOffset,
        queueState,
      },
      { lastProcessedSignalRef, lastStreamUrlRef, stateRef, settersRef },
      {
        setPlaybackState,
        setHasScrobbled,
        setCurrentTime,
        setBuffered,
        setDuration,
      },
      client,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replayGainMode/replayGainOffset handled by separate effect; isRestoringQueue excluded because play() handles the restore→playing transition directly
  }, [
    currentSong,
    trackChangeSignal,
    isNativePlatform,
    isClientInitialized,
    isRestoringQueue,
    isRemoteControlling,
    queueState,
    transcodingEnabled,
    transcodingBitrate,
    setPlaybackState,
    setHasScrobbled,
    setCurrentTime,
    setBuffered,
    setDuration,
  ]);

  // Eagerly materialize a restored queue into the native player on startup.
  // This covers the cold-start case where queue state exists (cache/server)
  // before the user presses play, so nativePlay() has media ready immediately.
  useEffect(() => {
    if (!isNativePlatform || isRemoteControlling) return;
    if (!isClientInitialized) return;
    if (!isRestoringQueue || !currentSong || !queueState) return;

    const client = getClient();
    if (!client) return;

    loadTrackNative(
      {
        currentSong,
        trackChangeSignal,
        isRestoringQueue,
        transcodingEnabled,
        transcodingBitrate,
        replayGainMode,
        replayGainOffset,
        queueState,
      },
      { lastProcessedSignalRef, lastStreamUrlRef, stateRef, settersRef },
      {
        setPlaybackState,
        setHasScrobbled,
        setCurrentTime,
        setBuffered,
        setDuration,
      },
      client,
    );
  }, [
    currentSong,
    trackChangeSignal,
    isNativePlatform,
    isClientInitialized,
    isRestoringQueue,
    isRemoteControlling,
    queueState,
    transcodingEnabled,
    transcodingBitrate,
    replayGainMode,
    replayGainOffset,
    setPlaybackState,
    setHasScrobbled,
    setCurrentTime,
    setBuffered,
    setDuration,
    stateRef,
    settersRef,
    lastProcessedSignalRef,
    lastStreamUrlRef,
  ]);

  // Separate effect for ReplayGain settings - updates gain immediately without reloading track
  useEffect(() => {
    if (!currentSong) return;

    // Native audio: ReplayGain is handled entirely by Kotlin (PlaybackService)
    if (isNativePlatform) return;

    if (!getGainNode(activeIndex)) return;

    if (replayGainMode !== "disabled") {
      const trackGain = getTrackReplayGain(currentSong, replayGainMode);
      const totalGain = trackGain + replayGainOffset;
      console.log(
        `[Audio] ReplayGain settings changed: track=${trackGain.toFixed(2)} dB, offset=${replayGainOffset.toFixed(2)} dB, total=${totalGain.toFixed(2)} dB`,
      );
      setReplayGain(totalGain, activeIndex);
    } else {
      const node = getGainNode(activeIndex);
      if (node) {
        console.log("[Audio] ReplayGain disabled, setting gain to unity");
        node.gain.value = 1;
      }
    }
  }, [replayGainMode, replayGainOffset, currentSong, isNativePlatform]);
}
