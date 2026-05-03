/**
 * Track loading logic for native (ExoPlayer) and web (HTMLAudioElement) paths.
 *
 * Extracted from the massive track-load effect in hooks.ts. Each function
 * receives all needed dependencies as parameters rather than closing over
 * hook-scoped variables, making the logic testable and readable.
 */

import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import {
  nativeStop,
  nativeGetState,
  nativeUpdateSettings,
  nativeUpdateStarredState,
  nativeStartPlayback,
  nativeInvalidateQueue,
} from "@/lib/audio/native-engine";
import { pendingPlaybackPositionMs } from "@/lib/store/server-queue";
import { logListeningTimeAndReset } from "@/lib/audio/listening";
import { resetClippingPeak } from "@/lib/audio/clipping-detector";
import {
  getCurrentStreamTimeOffset,
  setCurrentStreamTimeOffset,
} from "./seeking-control";
import {
  activeIndex,
  getTrackReplayGain,
  resumeAudioContext,
  setReplayGain,
  getActiveAudio,
  getInactiveAudio,
  invalidatePreBuffer,
  getGainNode,
} from "@/lib/audio/web-audio";
import {
  currentLoadedTrackId,
  setCurrentLoadedTrackId,
  nativeAudioReady,
  nativeSessionReady,
  setLastNativeTranscodingEnabled,
  setLastNativeTranscodingBitrate,
  lastNativeTranscodingEnabled,
  lastNativeTranscodingBitrate,
  isGaplessHandoff,
  gaplessHandoffExpectedTrackId,
  setIsGaplessHandoff,
  setGaplessHandoffExpectedTrackId,
  setIsIntentionalStop,
  setIsEndingQueue,
  setIsLoadingNewTrack,
} from "@/lib/audio/engine-state";
import type { EngineStateSnapshot, EngineSetters } from "./engine-types";
import { getNativeStreamOptions } from "./engine-types";
import type { Song } from "@/lib/api/types";
import type { ServerQueueState } from "@/lib/store/server-queue";
import type { FerrotuneClient } from "@/lib/api/client";
import type { PlaybackState, ReplayGainMode } from "@/lib/store/player";

// ============================================================================
// Shared types
// ============================================================================

interface TrackLoadRefs {
  lastProcessedSignalRef: React.MutableRefObject<number>;
  lastStreamUrlRef: React.MutableRefObject<string | null>;
  stateRef: React.RefObject<EngineStateSnapshot>;
  settersRef: React.RefObject<EngineSetters>;
}

interface TrackLoadParams {
  currentSong: Song | null;
  trackChangeSignal: number;
  isRestoringQueue: boolean;
  transcodingEnabled: boolean;
  transcodingBitrate: number;
  replayGainMode: ReplayGainMode;
  replayGainOffset: number;
  queueState: ServerQueueState | null;
}

/** Atom setters needed directly (not via settersRef). */
interface DirectSetters {
  setPlaybackState: (state: PlaybackState) => void;
  setHasScrobbled: (v: boolean) => void;
  setCurrentTime: (time: number) => void;
  setBuffered: (buffered: number) => void;
  setDuration: (duration: number) => void;
}

// ============================================================================
// Native track loader
// ============================================================================

/**
 * Handle track loading for native audio (ExoPlayer via Tauri bridge).
 * Returns `true` if the effect was handled (native path), `false` to
 * fall through to web audio.
 */
export function loadTrackNative(
  params: TrackLoadParams,
  refs: TrackLoadRefs,
  setters: DirectSetters,
  _client: FerrotuneClient,
): boolean {
  const { currentSong, trackChangeSignal, isRestoringQueue } = params;

  console.log(
    "[Audio] Native audio effect triggered, currentSong:",
    currentSong?.id,
    (currentSong as Song | null)?.title,
  );
  console.log(
    "[Audio] currentLoadedTrackId:",
    currentLoadedTrackId,
    "isRestoringQueue:",
    isRestoringQueue,
  );

  if (!currentSong) {
    if (currentSong === null && currentLoadedTrackId !== null) {
      // Queue cleared
      console.log("[Audio] Queue cleared, stopping native audio");
      nativeStop().catch(console.error);
      setters.setPlaybackState("idle");
      setCurrentLoadedTrackId(null);
    }
    return true;
  }

  // Check if signal changed (new queue started, shuffle, playAtIndex, etc.)
  const signalChanged =
    trackChangeSignal !== refs.lastProcessedSignalRef.current;

  // Check if transcoding settings changed (need to reload with new stream URLs)
  const nativeOpts = getNativeStreamOptions(refs.stateRef.current);
  const transcodingChanged =
    currentLoadedTrackId !== null &&
    (lastNativeTranscodingEnabled !== nativeOpts.transcodingEnabled ||
      lastNativeTranscodingBitrate !== nativeOpts.transcodingBitrate);

  console.log(
    "[Audio] signalChanged:",
    signalChanged,
    "trackChangeSignal:",
    trackChangeSignal,
    "lastProcessedSignal:",
    refs.lastProcessedSignalRef.current,
    "transcodingChanged:",
    transcodingChanged,
  );

  // Skip if same track is already loaded AND there's no forced reload.
  if (
    currentSong.id === currentLoadedTrackId &&
    !signalChanged &&
    (!transcodingChanged || isRestoringQueue)
  ) {
    console.log("[Audio] Skipping - same track already loaded");
    refs.lastProcessedSignalRef.current = trackChangeSignal;
    return true;
  }
  refs.lastProcessedSignalRef.current = trackChangeSignal;

  // Log listening time for the track we're leaving
  if (currentLoadedTrackId && currentSong.id !== currentLoadedTrackId) {
    logListeningTimeAndReset();
  }

  setLastNativeTranscodingEnabled(nativeOpts.transcodingEnabled);
  setLastNativeTranscodingBitrate(nativeOpts.transcodingBitrate);

  // Determine whether playback should start automatically.
  const shouldPlay =
    (signalChanged && !isRestoringQueue) ||
    (transcodingChanged && refs.stateRef.current.playbackState === "playing");
  pendingPlaybackPositionMs.value = 0;

  console.log(
    "[Audio] shouldPlay:",
    shouldPlay,
    "signalChanged:",
    signalChanged,
    "isRestoringQueue:",
    isRestoringQueue,
  );

  // Async native load logic
  const doNativeLoad = async () => {
    if (nativeAudioReady) {
      await nativeAudioReady;
    }

    // Wait for session init (API credentials) before making any API calls
    if (nativeSessionReady) {
      await nativeSessionReady;
    }

    // Kotlin manages the queue itself — tell it to fetch & play
    const qs = params.queueState ?? refs.stateRef.current.queueState;
    if (!qs) {
      console.warn(
        "[NativeAudio] Skipping native load because queueState is missing",
      );
      return;
    }

    // Send latest settings before starting/restarting playback
    const s = refs.stateRef.current;
    await nativeUpdateSettings({
      replayGainMode: s.replayGainMode,
      replayGainOffset: s.replayGainOffset,
      scrobbleThreshold: s.scrobbleThreshold,
      transcodingEnabled: s.transcodingEnabled,
      transcodingBitrate: s.transcodingBitrate,
    });

    // If only transcoding settings changed (not a new queue), just
    // invalidate so Kotlin refetches with new stream URLs
    if (transcodingChanged && !signalChanged) {
      await nativeInvalidateQueue();
      return;
    }

    // Check if the native player already has this track loaded
    if (isRestoringQueue) {
      try {
        const nativeState = await nativeGetState();
        if (
          nativeState.trackId === currentSong.id &&
          (nativeState.state === "playing" ||
            nativeState.state === "paused" ||
            nativeState.state === "loading")
        ) {
          console.log(
            "[NativeAudio] Native player already has track loaded, syncing state without reloading",
          );
          setCurrentLoadedTrackId(currentSong.id);
          refs.settersRef.current.setPlaybackState(nativeState.state);
          refs.settersRef.current.setCurrentTime(nativeState.positionSeconds);
          refs.settersRef.current.setDuration(nativeState.durationSeconds);

          const isStarred =
            refs.stateRef.current.starredItems.get(currentSong.id) ?? false;
          await nativeUpdateStarredState(isStarred);
          return;
        }

        // Safety net: if native is actively playing a *different* track than
        // what the frontend thinks is current (e.g. server returned a stale
        // currentIndex after app resume), trust the native player instead of
        // restarting playback at the wrong position.
        if (
          nativeState.trackId &&
          nativeState.trackId !== currentSong.id &&
          (nativeState.state === "playing" ||
            nativeState.state === "paused" ||
            nativeState.state === "loading")
        ) {
          console.log(
            "[NativeAudio] Native player has different track than frontend expects " +
              `(native: ${nativeState.trackId}, frontend: ${currentSong.id}). ` +
              "Trusting native player — updating frontend state to match.",
          );
          refs.settersRef.current.setServerQueueState((prev) =>
            prev
              ? {
                  ...prev,
                  currentIndex: nativeState.queueIndex,
                  positionMs: nativeState.positionSeconds * 1000,
                }
              : prev,
          );
          refs.settersRef.current.setPlaybackState(nativeState.state);
          refs.settersRef.current.setCurrentTime(nativeState.positionSeconds);
          refs.settersRef.current.setDuration(nativeState.durationSeconds);
          return;
        }
      } catch (err) {
        console.warn(
          "[NativeAudio] Failed to check native state, proceeding with queue send:",
          err,
        );
      }
    }

    setters.setHasScrobbled(false);
    setters.setCurrentTime(isRestoringQueue ? qs.positionMs / 1000 : 0);
    setters.setDuration(currentSong.duration || 0);

    await nativeStartPlayback({
      totalCount: qs.totalCount,
      currentIndex: qs.currentIndex,
      isShuffled: qs.isShuffled,
      repeatMode: qs.repeatMode,
      playWhenReady: shouldPlay,
      startPositionMs: qs.positionMs,
      sessionId: refs.stateRef.current.currentSessionId ?? undefined,
      sourceType: qs.source?.type,
      sourceId: qs.source?.id ?? undefined,
    });

    setCurrentLoadedTrackId(currentSong.id);

    if (!shouldPlay) {
      setters.setPlaybackState("paused");
    } else {
      setters.setPlaybackState("loading");
    }

    const isStarred =
      refs.stateRef.current.starredItems.get(currentSong.id) ?? false;
    await nativeUpdateStarredState(isStarred);
  };

  doNativeLoad().catch((err) => {
    console.error("[Audio] Failed to load/play native track:", err);
    setters.setPlaybackState("paused");
  });
  return true;
}

// ============================================================================
// Web track loader
// ============================================================================

/**
 * Handle track loading for web audio (HTMLAudioElement).
 */
export function loadTrackWeb(
  params: TrackLoadParams,
  refs: TrackLoadRefs,
  setters: DirectSetters,
  client: FerrotuneClient,
): void {
  const {
    currentSong,
    trackChangeSignal,
    isRestoringQueue,
    transcodingEnabled,
    transcodingBitrate,
    replayGainMode,
    replayGainOffset,
    queueState,
  } = params;
  const audio = getActiveAudio();

  if (!audio || !currentSong) {
    if (audio && audio.src && !currentSong) {
      console.log(
        "[Audio] Track-load effect: currentSong is null, clearing audio. currentLoadedTrackId=%s",
        currentLoadedTrackId,
      );
      // Set flag BEFORE any audio operation to prevent error toasts
      setIsIntentionalStop(true);
      setIsEndingQueue(false);
      setIsLoadingNewTrack(false);

      audio.pause();

      try {
        audio.removeAttribute("src");
        audio.load();
      } catch (_e) {
        audio.src = "";
      }

      // Also clear the inactive element
      const inactiveAudio = getInactiveAudio();
      if (inactiveAudio) {
        inactiveAudio.pause();
        try {
          inactiveAudio.removeAttribute("src");
          inactiveAudio.load();
        } catch (_e) {
          inactiveAudio.src = "";
        }
      }

      setters.setPlaybackState("idle");
      setCurrentLoadedTrackId(null);
      refs.lastStreamUrlRef.current = null;
      invalidatePreBuffer();

      setTimeout(() => {
        setIsIntentionalStop(false);
      }, 200);
    }
    return;
  }

  // Build the stream URL with current transcoding settings
  const streamUrl = client.getStreamUrl(currentSong.id, {
    maxBitRate: transcodingEnabled ? transcodingBitrate : undefined,
    format: transcodingEnabled ? "opus" : undefined,
  });

  // Skip if same track is already loaded with same settings AND signal hasn't changed
  const signalChanged =
    trackChangeSignal !== refs.lastProcessedSignalRef.current;
  const urlChanged = streamUrl !== refs.lastStreamUrlRef.current;

  console.log(
    "[Audio] Track-load effect: song=%s loaded=%s signal=%d lastSignal=%d signalChanged=%s urlChanged=%s isRestoringQueue=%s",
    currentSong.id,
    currentLoadedTrackId,
    trackChangeSignal,
    refs.lastProcessedSignalRef.current,
    signalChanged,
    urlChanged,
    isRestoringQueue,
  );

  // During gapless handoff, queue advances after playback already switched.
  if (
    isGaplessHandoff &&
    gaplessHandoffExpectedTrackId &&
    currentSong.id === gaplessHandoffExpectedTrackId &&
    currentSong.id === currentLoadedTrackId &&
    signalChanged
  ) {
    console.log(
      "[Audio] Gapless handoff synchronized with queue; skipping redundant reload",
    );
    pendingPlaybackPositionMs.value = 0;
    refs.lastProcessedSignalRef.current = trackChangeSignal;
    refs.lastStreamUrlRef.current = streamUrl;
    setIsGaplessHandoff(false);
    setGaplessHandoffExpectedTrackId(null);

    // Broadcast new track position to followers immediately
    const sessionId = refs.stateRef.current.currentSessionId;
    if (sessionId && queueState) {
      getClient()
        ?.sessionHeartbeat(sessionId, {
          clientId: refs.stateRef.current.clientId || undefined,
          positionMs: 0,
          isPlaying: true,
          currentIndex: queueState.currentIndex,
          currentSongId: currentSong.id,
          currentSongTitle: currentSong.title,
          currentSongArtist: currentSong.artist,
        })
        .catch((err) =>
          console.warn("[Session] Failed to broadcast gapless handoff:", err),
        );
    }
    return;
  }

  // Queue selected a different next song than the pre-buffered handoff target
  if (
    isGaplessHandoff &&
    gaplessHandoffExpectedTrackId &&
    currentSong.id !== gaplessHandoffExpectedTrackId &&
    signalChanged
  ) {
    console.warn(
      "[Audio] Gapless handoff mismatch with queue state; reloading queue-selected track",
    );
    setIsGaplessHandoff(false);
    setGaplessHandoffExpectedTrackId(null);
  }

  if (
    currentSong.id === currentLoadedTrackId &&
    !signalChanged &&
    (!urlChanged || isRestoringQueue)
  ) {
    console.log(
      "[Audio] Track-load effect: SKIPPING (same track, no forced reload)",
    );
    refs.lastProcessedSignalRef.current = trackChangeSignal;
    refs.lastStreamUrlRef.current = streamUrl;
    return;
  }

  // Consume the pending position flag
  const resumePositionSec = pendingPlaybackPositionMs.value / 1000;
  pendingPlaybackPositionMs.value = 0;
  refs.lastProcessedSignalRef.current = trackChangeSignal;
  refs.lastStreamUrlRef.current = streamUrl;

  // Log listening time for the track we're leaving
  if (currentLoadedTrackId && currentSong.id !== currentLoadedTrackId) {
    logListeningTimeAndReset();
    resetClippingPeak();
  }

  // Save previous track ID before overwriting
  const previousLoadedTrackId = currentLoadedTrackId;
  setCurrentLoadedTrackId(currentSong.id);

  // Invalidate any pre-buffer since we're loading a new track explicitly
  invalidatePreBuffer();

  // Resume AudioContext if suspended (required after user interaction)
  resumeAudioContext();

  // Apply client-side ReplayGain on the active element
  if (replayGainMode !== "disabled") {
    const trackGain = getTrackReplayGain(currentSong, replayGainMode);
    const totalGain = trackGain + replayGainOffset;
    console.log(
      `[Audio] Applying ReplayGain: track=${trackGain.toFixed(2)} dB, offset=${replayGainOffset.toFixed(2)} dB, total=${totalGain.toFixed(2)} dB`,
    );
    setReplayGain(totalGain, activeIndex);
  } else {
    const activeNode = getGainNode(activeIndex);
    if (activeNode) {
      console.log("[Audio] ReplayGain disabled, setting gain to unity");
      activeNode.gain.value = 1;
    }
  }

  // Ensure inactive element gain is 0
  const inactiveIdx = activeIndex === 0 ? 1 : 0;
  const inactiveNode = getGainNode(inactiveIdx);
  if (inactiveNode) {
    inactiveNode.gain.value = 0;
  }

  // Check if this is just a transcoding settings change
  const isTranscodingSettingsChange =
    currentSong.id === previousLoadedTrackId && urlChanged && !signalChanged;

  // Save current playback position if this is a settings change
  const savedPosition = isTranscodingSettingsChange
    ? audio.currentTime + getCurrentStreamTimeOffset()
    : 0;
  const wasPlaying = isTranscodingSettingsChange && !audio.paused;

  // Stop current playback
  audio.pause();

  // Reset stream time offset (no seeking when loading fresh track)
  setCurrentStreamTimeOffset(0);

  if (isRestoringQueue) {
    // During restore: load the track but don't play, set to paused state
    setters.setPlaybackState("paused");
    setters.setHasScrobbled(false);
    setters.setCurrentTime(resumePositionSec);
    setters.setBuffered(0);
    setters.setDuration(currentSong.duration || 0);

    if (resumePositionSec > 0 && transcodingEnabled) {
      setCurrentStreamTimeOffset(resumePositionSec);
      const offsetUrl = getClient()?.getStreamUrl(currentSong.id, {
        maxBitRate: transcodingBitrate,
        format: "opus",
        timeOffset: resumePositionSec,
      });
      audio.src = offsetUrl ?? streamUrl;
      audio.load();
    } else if (resumePositionSec > 0) {
      audio.src = streamUrl;
      const handleCanPlayForRestore = () => {
        audio.removeEventListener("canplay", handleCanPlayForRestore);
        audio.currentTime = resumePositionSec;
      };
      audio.addEventListener("canplay", handleCanPlayForRestore);
      audio.load();
    } else {
      audio.src = streamUrl;
      audio.load();
    }
  } else if (isTranscodingSettingsChange && savedPosition > 0) {
    console.log(
      `[Audio] Transcoding settings changed, resuming from ${savedPosition.toFixed(1)}s`,
    );
    setIsLoadingNewTrack(true);
    setters.setPlaybackState("loading");

    const handleCanPlayForSeek = () => {
      audio.removeEventListener("canplay", handleCanPlayForSeek);

      if (transcodingEnabled && savedPosition > 0) {
        setCurrentStreamTimeOffset(savedPosition);
        const offsetUrl = getClient()?.getStreamUrl(currentSong.id, {
          maxBitRate: transcodingEnabled ? transcodingBitrate : undefined,
          format: transcodingEnabled ? "opus" : undefined,
          timeOffset: savedPosition,
        });
        if (offsetUrl) {
          audio.src = offsetUrl;
          setters.setCurrentTime(savedPosition);
          if (wasPlaying) {
            resumeAudioContext().then(() => {
              audio.play().catch(console.error);
            });
          }
        }
      } else {
        audio.currentTime = savedPosition;
        setters.setCurrentTime(savedPosition);
        if (wasPlaying) {
          resumeAudioContext().then(() => {
            audio.play().catch(console.error);
          });
        }
      }
      setIsLoadingNewTrack(false);
    };
    audio.src = streamUrl;
    audio.addEventListener("canplay", handleCanPlayForSeek);
    audio.load();
  } else {
    // Normal playback: load and play
    audio.src = streamUrl;
    setIsLoadingNewTrack(true);
    setters.setPlaybackState("loading");
    setters.setHasScrobbled(false);
    setters.setCurrentTime(resumePositionSec);
    setters.setBuffered(resumePositionSec);
    setters.setDuration(currentSong.duration || 0);

    // Broadcast new track position to followers immediately
    const sessionId = refs.stateRef.current.currentSessionId;
    if (sessionId && queueState) {
      getClient()
        ?.sessionHeartbeat(sessionId, {
          clientId: refs.stateRef.current.clientId || undefined,
          positionMs: Math.round(resumePositionSec * 1000),
          isPlaying: true,
          currentIndex: queueState.currentIndex,
          currentSongId: currentSong.id,
          currentSongTitle: currentSong.title,
          currentSongArtist: currentSong.artist,
        })
        .catch((err) =>
          console.warn("[Session] Failed to broadcast track change:", err),
        );
    }

    // If resuming mid-track with transcoding, use timeOffset
    if (resumePositionSec > 0 && transcodingEnabled) {
      setCurrentStreamTimeOffset(resumePositionSec);
      const offsetUrl = getClient()?.getStreamUrl(currentSong.id, {
        maxBitRate: transcodingBitrate,
        format: "opus",
        timeOffset: resumePositionSec,
      });
      if (offsetUrl) {
        audio.src = offsetUrl;
      }
    }

    resumeAudioContext().then((contextRunning) => {
      if (!contextRunning) {
        console.warn(
          "[Audio] Autoplay blocked — user gesture required to start playback",
        );
        if (resumePositionSec > 0 && !transcodingEnabled) {
          const handleCanPlayForPosition = () => {
            audio.removeEventListener("canplay", handleCanPlayForPosition);
            audio.currentTime = resumePositionSec;
          };
          audio.addEventListener("canplay", handleCanPlayForPosition);
          audio.load();
        }
        setIsLoadingNewTrack(false);
        setters.setPlaybackState("paused");
        toast.info("Press play to start playback");
        return;
      }

      // For non-transcoded streams, seek within the loaded file
      if (resumePositionSec > 0 && !transcodingEnabled) {
        const handleCanPlayForResume = () => {
          audio.removeEventListener("canplay", handleCanPlayForResume);
          audio.currentTime = resumePositionSec;
          audio.play().catch((err) => {
            console.error("Failed to play:", err);
            setIsLoadingNewTrack(false);
            setters.setPlaybackState("paused");
          });
        };
        audio.addEventListener("canplay", handleCanPlayForResume);
        audio.load();
      } else {
        audio.play().catch((err) => {
          console.error("Failed to play:", err);
          setIsLoadingNewTrack(false);
          setters.setPlaybackState("paused");
        });
      }
    });
  }
}
