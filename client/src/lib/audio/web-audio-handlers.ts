/**
 * Factory for web audio event handlers (HTMLAudioElement events).
 *
 * Extracted from hooks.ts — creates the event handler functions attached
 * to both audio elements. Follows the same factory pattern as
 * `createNetworkErrorHandlers()`.
 */

import {
  checkAndScrobble,
  updateListeningSession,
  startListeningUpdateInterval,
  stopListeningUpdateInterval,
  logListeningTimeAndReset,
  playbackStartTime,
  playbackStartSongId,
  accumulatedPlayTime,
  setPlaybackStartTime,
  setPlaybackStartSongId,
  setAccumulatedPlayTime,
  setCurrentListeningSessionId,
} from "@/lib/audio/listening";
import {
  startClippingDetection,
  stopClippingDetection,
} from "@/lib/audio/clipping-detector";
import {
  performGaplessHandoff,
  checkAndStartPreBuffering,
} from "@/lib/audio/gapless-playback";
import {
  audioElements,
  activeIndex,
  analyserNode,
  preBufferedTrackId,
  resumeAudioContext,
  invalidatePreBuffer,
  setPreBufferReady,
} from "@/lib/audio/web-audio";
import {
  getCurrentStreamTimeOffset,
  setCurrentStreamTimeOffset,
} from "./seeking-control";
import { createNetworkErrorHandlers } from "./network-error-recovery";
import {
  isEndingQueue,
  setIsEndingQueue,
  isLoadingNewTrack,
  setIsLoadingNewTrack,
  isIntentionalStop,
  setIsGaplessHandoff,
  setGaplessHandoffExpectedTrackId,
  setCurrentLoadedTrackId,
} from "@/lib/audio/engine-state";
import type { EngineStateSnapshot, EngineSetters } from "./engine-types";

export interface WebAudioHandlerDeps {
  stateRef: React.RefObject<EngineStateSnapshot>;
  settersRef: React.RefObject<EngineSetters>;
  lastStreamUrlRef: React.RefObject<string | null>;
}

export interface WebAudioHandlers {
  /** All [eventName, handler] pairs to attach to both audio elements. */
  events: Array<[string, (e: Event) => void]>;
  /** Clear the stall recovery timer (exposed for cleanup). */
  clearStallTimer: () => void;
}

export function createWebAudioHandlers({
  stateRef,
  settersRef,
  lastStreamUrlRef,
}: WebAudioHandlerDeps): WebAudioHandlers {
  /** Returns true if the event came from the currently active element */
  const isFromActive = (e: Event): boolean => {
    return e.target === audioElements[activeIndex];
  };

  const handlePlay = (e: Event) => {
    if (!isFromActive(e)) return;
    console.log("[Audio] play event fired on active element", activeIndex);
    settersRef.current.setPlaybackState("playing");

    // Start real-time clipping detection
    if (analyserNode && stateRef.current.clippingDetectionEnabled) {
      startClippingDetection(
        analyserNode,
        settersRef.current.setClippingState,
        () => audioElements[activeIndex]?.volume ?? 1,
      );
    }

    // Start tracking listening time
    const currentSongId = stateRef.current.currentSong?.id;
    if (currentSongId) {
      // If this is a new song, reset tracking
      if (currentSongId !== playbackStartSongId) {
        setPlaybackStartSongId(currentSongId);
        setAccumulatedPlayTime(0);
        setCurrentListeningSessionId(null);
      }
      // Record when playback started
      setPlaybackStartTime(Date.now());
      // Start periodic updates
      startListeningUpdateInterval();
    }
  };

  const handlePause = (e: Event) => {
    if (!isFromActive(e)) return;
    console.log("[Audio] pause event fired on active element", activeIndex);
    // Don't overwrite "ended" state - that's intentional when queue finishes
    if (isEndingQueue) {
      setIsEndingQueue(false);
      return;
    }
    settersRef.current.setPlaybackState("paused");

    // Stop clipping detection while paused
    stopClippingDetection();

    // Stop periodic updates
    stopListeningUpdateInterval();

    // Accumulate listening time when paused and update the session
    if (playbackStartTime !== null) {
      setAccumulatedPlayTime(
        accumulatedPlayTime + (Date.now() - playbackStartTime) / 1000,
      );
      setPlaybackStartTime(null);
      // Update the session with current accumulated time
      updateListeningSession();
    }
  };

  const handleEnded = (e: Event) => {
    if (!isFromActive(e)) return;
    console.log("[Audio] ended event fired on active element", activeIndex);
    // Stop clipping detection
    stopClippingDetection();
    // Log listening time before moving to next track
    logListeningTimeAndReset();

    // Handle repeat-one mode: just restart the track
    const state = stateRef.current;
    const currentActive = audioElements[activeIndex]!;
    if (state.queueState?.repeatMode === "one") {
      currentActive.currentTime = 0;
      resumeAudioContext().then(() => {
        currentActive.play().catch(console.error);
      });
      return;
    }

    // Check if we're at the end of the queue with no repeat
    if (state.queueState) {
      const isLastTrack =
        state.queueState.currentIndex >= state.queueState.totalCount - 1;
      if (isLastTrack && state.queueState.repeatMode !== "all") {
        // End of queue - mark as ended
        setIsEndingQueue(true);
        settersRef.current.setCurrentTime(0);
        settersRef.current.setPlaybackState("ended");
        invalidatePreBuffer();
        return;
      }
    }

    // =====================================================================
    // GAPLESS HANDOFF: if pre-buffer is ready, swap immediately
    // =====================================================================
    if (
      performGaplessHandoff(
        stateRef.current,
        {
          setAudioElement: settersRef.current.setAudioElement,
          setHasScrobbled: settersRef.current.setHasScrobbled,
          setCurrentTime: settersRef.current.setCurrentTime,
          setBuffered: settersRef.current.setBuffered,
          setDuration: settersRef.current.setDuration,
          goToNext: settersRef.current.goToNext,
        },
        lastStreamUrlRef,
        {
          setCurrentLoadedTrackId: (id) => {
            setCurrentLoadedTrackId(id);
          },
          setIsGaplessHandoff: (v) => {
            setIsGaplessHandoff(v);
          },
          setGaplessHandoffExpectedTrackId: (id) => {
            setGaplessHandoffExpectedTrackId(id);
          },
        },
      )
    ) {
      return;
    }

    // No pre-buffer ready, fall back to standard next track
    settersRef.current.goToNext();
  };

  const handleTimeUpdate = (e: Event) => {
    if (!isFromActive(e)) return;
    const activeAudio = audioElements[activeIndex]!;
    // timeupdate proves playback is progressing — clear any stall timer
    clearStallTimer();
    // Add the stream time offset to get the real position in the song
    const realTime = activeAudio.currentTime + getCurrentStreamTimeOffset();
    settersRef.current.setCurrentTime(realTime);

    // Also update buffered during timeupdate as a fallback
    if (activeAudio.buffered.length > 0) {
      const rawBuffered = activeAudio.buffered.end(
        activeAudio.buffered.length - 1,
      );
      settersRef.current.setBuffered(
        rawBuffered + getCurrentStreamTimeOffset(),
      );
    }

    const state = stateRef.current;
    const duration = activeAudio.duration || 0;
    checkAndScrobble(
      state,
      duration,
      settersRef.current.setHasScrobbled,
      settersRef.current.invalidatePlayCountQueries,
    );

    // Pre-buffer logic: start loading next track when near the end
    checkAndStartPreBuffering(activeAudio, duration, state);
  };

  const handleDurationChange = (e: Event) => {
    if (!isFromActive(e)) return;
    const activeAudio = audioElements[activeIndex]!;
    const state = stateRef.current;
    const songDuration = state.currentSong?.duration;

    if (state.transcodingEnabled && songDuration && songDuration > 0) {
      settersRef.current.setDuration(songDuration);
    } else {
      settersRef.current.setDuration(activeAudio.duration || 0);
    }
  };

  const handleProgress = (e: Event) => {
    if (!isFromActive(e)) return;
    // progress proves buffering is advancing — clear any stall timer
    clearStallTimer();
    const activeAudio = audioElements[activeIndex]!;
    if (activeAudio.buffered.length > 0) {
      settersRef.current.setBuffered(
        activeAudio.buffered.end(activeAudio.buffered.length - 1) +
          getCurrentStreamTimeOffset(),
      );
    }
  };

  const handleLoadStart = (e: Event) => {
    if (!isFromActive(e)) return;
    console.log("[Audio] loadstart event on active element");
    if (!stateRef.current.isRestoringQueue && !isIntentionalStop) {
      settersRef.current.setPlaybackState("loading");
    }
  };

  const handleCanPlay = (e: Event) => {
    const audioElement = e.target as HTMLAudioElement;

    // Check if this is from the pre-buffer (inactive) element
    if (!isFromActive(e)) {
      if (
        audioElement === audioElements[activeIndex === 0 ? 1 : 0] &&
        preBufferedTrackId
      ) {
        console.log(
          "[Audio] Pre-buffer element is ready to play:",
          preBufferedTrackId,
        );
        setPreBufferReady(true);
      }
      return;
    }

    console.log("[Audio] canplay event on active element");
    clearStallTimer();
    const state = stateRef.current;

    if (
      !audioElement.src ||
      audioElement.src === "" ||
      audioElement.src === window.location.href
    ) {
      console.log("[Audio] Skipping auto-play because src is empty");
      return;
    }

    if (state.isRestoringQueue) {
      console.log("[Audio] Skipping auto-play because queue is being restored");
      setIsLoadingNewTrack(false);
      settersRef.current.setPlaybackState("paused");
      return;
    }

    if (state.playbackState === "paused" && !isLoadingNewTrack) {
      console.log("[Audio] Skipping auto-play because playback is paused");
      return;
    }

    if (state.playbackState === "ended" && !isLoadingNewTrack) {
      console.log("[Audio] Skipping auto-play because queue has ended");
      settersRef.current.setPlaybackState("ended");
      return;
    }
    setIsLoadingNewTrack(false);
    resumeAudioContext().then(() => {
      audioElement.play().catch((err) => {
        console.error("[Audio] Failed to play on canplay:", err);
      });
    });
  };

  // --- Stall/waiting recovery and network error retry ---
  // Delegates to network-error-recovery.ts for stall detection, error
  // classification, and automatic retry with exponential backoff.
  const errorRecovery = createNetworkErrorHandlers({
    stateRef,
    settersRef,
    isFromActive,
    getIsIntentionalStop: () => isIntentionalStop,
    setIsLoadingNewTrack: (v) => {
      setIsLoadingNewTrack(v);
    },
    getCurrentStreamTimeOffset,
    setCurrentStreamTimeOffset,
  });
  const { clearStallTimer } = errorRecovery;

  const events: Array<[string, (e: Event) => void]> = [
    ["play", handlePlay],
    ["pause", handlePause],
    ["ended", handleEnded],
    ["timeupdate", handleTimeUpdate],
    ["durationchange", handleDurationChange],
    ["progress", handleProgress],
    ["loadstart", handleLoadStart],
    ["canplay", handleCanPlay],
    ["waiting", errorRecovery.handleWaiting],
    ["stalled", errorRecovery.handleStalled],
    ["playing", errorRecovery.handlePlaying],
    ["error", errorRecovery.handleError],
  ];

  return { events, clearStallTimer };
}
