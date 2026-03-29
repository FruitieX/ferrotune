"use client";

/**
 * Track loading hook: wraps loadTrackNative/loadTrackWeb with React effects,
 * plus ReplayGain live-update and queue window resync for native audio.
 *
 * Extracted from useAudioEngineInit — Effects 13, 14, 15.
 */

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
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
  queueWindowAtom,
} from "@/lib/store/server-queue";
import { isRemoteControllingAtom } from "@/lib/store/session";
import { getClient } from "@/lib/api/client";
import { loadTrackNative, loadTrackWeb } from "@/lib/audio/track-loader";
import {
  usingNativeAudio,
  setNativeQueueOffset,
  setNativeQueueLength,
  suppressQueueWindowSync,
  setSuppressQueueWindowSync,
} from "@/lib/audio/engine-state";
import { nativeSetQueue, nativeGetState } from "@/lib/audio/native-engine";
import { nativeAutonomousMode } from "@/lib/store/server-queue";
import {
  activeIndex,
  getTrackReplayGain,
  setReplayGain,
  getGainNode,
} from "@/lib/audio/web-audio";
import { getNativeStreamOptions } from "@/lib/audio/engine-types";
import type {
  EngineStateSnapshot,
  EngineSetters,
} from "@/lib/audio/engine-types";
import type { QueueWindow } from "@/lib/api/generated/QueueWindow";

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

  const currentSong = useAtomValue(currentSongAtom);
  const trackChangeSignal = useAtomValue(trackChangeSignalAtom);
  const isRestoringQueue = useAtomValue(isRestoringQueueAtom);
  const isRemoteControlling = useAtomValue(isRemoteControllingAtom);
  const transcodingEnabled = useAtomValue(transcodingEnabledAtom);
  const transcodingBitrate = useAtomValue(transcodingBitrateAtom);
  const replayGainMode = useAtomValue(replayGainModeAtom);
  const replayGainOffset = useAtomValue(replayGainOffsetAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const queueWindow = useAtomValue(queueWindowAtom);

  // Load new track when current song changes (triggered by trackChangeSignal or currentSong)
  // Also reload when transcoding settings change
  useEffect(() => {
    // Don't load audio when remote-controlling another session
    if (isRemoteControlling) return;

    const client = getClient();

    if (usingNativeAudio) {
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
    isRemoteControlling,
    transcodingEnabled,
    transcodingBitrate,
    setPlaybackState,
    setHasScrobbled,
    setCurrentTime,
    setBuffered,
    setDuration,
  ]);

  // Separate effect for ReplayGain settings - updates gain immediately without reloading track
  useEffect(() => {
    if (!currentSong) return;

    // Native audio: ReplayGain is handled entirely by Kotlin (PlaybackService)
    if (usingNativeAudio) return;

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
  }, [replayGainMode, replayGainOffset, currentSong]);

  // Re-sync the native queue when the queue window changes (e.g., shuffle toggle,
  // queue reorder) while the current track stays the same.
  const prevQueueWindowRef = useRef<QueueWindow | null>(queueWindow);
  useEffect(() => {
    if (!usingNativeAudio || !queueWindow || !currentSong) {
      prevQueueWindowRef.current = queueWindow;
      return;
    }

    // In autonomous mode, Kotlin manages ExoPlayer's queue directly.
    if (nativeAutonomousMode.value) {
      prevQueueWindowRef.current = queueWindow;
      return;
    }

    // Skip if the window update came from onTrackChange (auto-advance)
    if (suppressQueueWindowSync) {
      setSuppressQueueWindowSync(false);
      prevQueueWindowRef.current = queueWindow;
      return;
    }

    const prevWindow = prevQueueWindowRef.current;
    prevQueueWindowRef.current = queueWindow;

    // Skip the first mount (initial send is done by track-loading effect)
    if (!prevWindow) return;

    // Check if the window content actually changed
    const prevIds = prevWindow.songs
      .sort((a, b) => a.position - b.position)
      .map((s) => s.song.id)
      .join(",");
    const newIds = queueWindow.songs
      .sort((a, b) => a.position - b.position)
      .map((s) => s.song.id)
      .join(",");

    if (prevIds === newIds) return;

    // Window content changed — re-send the queue to ExoPlayer
    const client = getClient();
    if (!client) return;

    const windowSongs = [...queueWindow.songs].sort(
      (a, b) => a.position - b.position,
    );
    const startIdx = windowSongs.findIndex((s) => s.song.id === currentSong.id);
    if (startIdx < 0) return;

    const songs = windowSongs.map((s) => s.song);
    const offset = windowSongs[0].position;

    console.log(
      "[Audio] Queue window changed (shuffle/reorder), re-syncing native queue:",
      songs.length,
      "songs, startIdx:",
      startIdx,
    );

    // Get current playback position to resume seamlessly
    nativeGetState()
      .then((state) => {
        const positionMs = Math.round((state?.positionSeconds ?? 0) * 1000);
        const shouldPlay =
          state?.state === "playing" || state?.state === "loading";
        setNativeQueueOffset(offset);
        setNativeQueueLength(songs.length);
        return nativeSetQueue(
          songs,
          startIdx,
          client,
          offset,
          positionMs,
          getNativeStreamOptions(stateRef.current),
          shouldPlay,
        );
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stateRef is a stable ref
  }, [queueWindow, currentSong]);
}
