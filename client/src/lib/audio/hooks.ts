"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  playbackStateAtom,
  playbackErrorAtom,
  currentTimeAtom,
  durationAtom,
  bufferedAtom,
  effectiveVolumeAtom,
  volumeAtom,
  isMutedAtom,
  hasScrobbledAtom,
  scrobbleThresholdAtom,
  audioElementAtom,
  transcodingEnabledAtom,
  transcodingBitrateAtom,
  transcodingSeekModeAtom,
  replayGainModeAtom,
  replayGainOffsetAtom,
} from "@/lib/store/player";
import {
  serverQueueStateAtom,
  currentSongAtom,
  isRestoringQueueAtom,
  trackChangeSignalAtom,
  goToNextAtom,
  goToPreviousAtom,
  toggleShuffleAtom,
  setRepeatModeAtom,
  fetchQueueAtom,
  playAtIndexAtom,
  type RepeatMode,
} from "@/lib/store/server-queue";
import { serverConnectionAtom, isHydratedAtom } from "@/lib/store/auth";
import { getClient } from "@/lib/api/client";
import { invalidatePlayCountQueries as invalidatePlayCounts } from "@/lib/api/cache-invalidation";

// Singleton audio element - only one instance across the entire app
let globalAudio: HTMLAudioElement | null = null;

// Web Audio API for ReplayGain volume adjustment
let audioContext: AudioContext | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let gainNode: GainNode | null = null;

// Track the currently loaded track ID to avoid unnecessary reloads when queue changes
let currentLoadedTrackId: string | null = null;
// Flag to prevent handlePause from overwriting "ended" state
let isEndingQueue: boolean = false;
// Flag to indicate we're intentionally loading a new track (overrides "ended" state check)
let isLoadingNewTrack: boolean = false;
// Flag to indicate we're intentionally stopping/clearing (prevents error toasts)
let isIntentionalStop: boolean = false;
// Track when playback started for listening time logging
let playbackStartTime: number | null = null;
let playbackStartSongId: string | null = null;
let accumulatedPlayTime: number = 0; // Accumulated time for pauses
// Session-based listening tracking
let currentListeningSessionId: number | null = null;
let listeningUpdateInterval: ReturnType<typeof setInterval> | null = null;
// Track the time offset of the current stream (for transcoded seeking)
// When we reload a transcoded stream with timeOffset, audio.currentTime starts at 0
// but the real position is timeOffset + audio.currentTime
let currentStreamTimeOffset: number = 0;

const LISTENING_UPDATE_INTERVAL_MS = 60000; // Update every 60 seconds

/**
 * Convert ReplayGain dB value to linear gain factor.
 * ReplayGain values are typically negative (e.g., -6.5 dB).
 */
function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Initialize Web Audio API for ReplayGain processing.
 * This creates an AudioContext and routes the audio through a GainNode.
 */
function initializeWebAudio(audio: HTMLAudioElement): void {
  if (audioContext) return; // Already initialized

  try {
    console.log("[Audio] Initializing Web Audio API for ReplayGain");
    audioContext = new AudioContext();
    sourceNode = audioContext.createMediaElementSource(audio);
    gainNode = audioContext.createGain();

    // Connect: audio element -> gain node -> speakers
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    console.log(
      "[Audio] Web Audio API initialized, AudioContext state:",
      audioContext.state,
    );
  } catch (err) {
    console.error("[Audio] Failed to initialize Web Audio API:", err);
  }
}

/**
 * Resume the AudioContext if it's suspended.
 * Must be called from a user gesture handler (like clicking play).
 * Returns true if the context is running after this call.
 */
async function resumeAudioContext(): Promise<boolean> {
  if (!audioContext) {
    console.warn("[Audio] Cannot resume: AudioContext not initialized");
    return false;
  }

  console.log("[Audio] AudioContext state before resume:", audioContext.state);

  if (audioContext.state === "suspended") {
    console.log("[Audio] Resuming suspended AudioContext...");
    try {
      await audioContext.resume();
      console.log("[Audio] AudioContext resumed, state:", audioContext.state);
    } catch (err) {
      console.error("[Audio] Failed to resume AudioContext:", err);
      return false;
    }
  } else if (audioContext.state === "closed") {
    console.error("[Audio] AudioContext is closed, cannot resume");
    return false;
  }

  return audioContext.state === "running";
}

/**
 * Update the ReplayGain volume adjustment.
 * @param gainDb - The gain in dB to apply (can be negative)
 */
function setReplayGain(gainDb: number): void {
  if (!gainNode) {
    console.warn("[Audio] Cannot set ReplayGain: gainNode not initialized");
    return;
  }

  const linearGain = dbToLinear(gainDb);
  // Clamp to prevent extreme values (max +12dB boost)
  const clampedGain = Math.min(linearGain, dbToLinear(12));
  gainNode.gain.value = clampedGain;
  console.log(
    `[Audio] ReplayGain set: ${gainDb.toFixed(2)} dB -> linear gain ${clampedGain.toFixed(4)}`,
  );
}

/**
 * Gets or creates the singleton audio element for playback.
 *
 * Uses `preload="auto"` which instructs the browser to buffer the entire track
 * if possible. This helps with battery life on mobile devices since the modem
 * can go to sleep after downloading is complete. The actual buffering behavior
 * is browser-dependent and may be throttled based on network conditions and
 * available memory.
 *
 * The audio element is attached to the DOM for better browser compatibility,
 * especially on mobile devices where non-DOM audio elements may be handled
 * differently.
 */
export function getGlobalAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (!globalAudio) {
    globalAudio = document.createElement("audio");
    // Buffer the entire track if possible - helps with battery life on mobile
    // as the modem can sleep when there's no network activity
    globalAudio.preload = "auto";
    // Enable CORS - required for Web Audio API to process cross-origin audio
    globalAudio.crossOrigin = "anonymous";
    // Attach to DOM for better browser compatibility
    // Hidden from screen readers and invisible
    globalAudio.setAttribute("aria-hidden", "true");
    globalAudio.style.display = "none";
    document.body.appendChild(globalAudio);
  }
  return globalAudio;
}

/**
 * Calculates the total listening time for the current session.
 */
function calculateTotalListeningSeconds(): number {
  let totalSeconds = accumulatedPlayTime;
  if (playbackStartTime !== null) {
    totalSeconds += (Date.now() - playbackStartTime) / 1000;
  }
  return totalSeconds;
}

/**
 * Updates the listening session with current accumulated time.
 * Called periodically during playback and on pause.
 */
async function updateListeningSession(): Promise<void> {
  if (!playbackStartSongId) return;

  const totalSeconds = calculateTotalListeningSeconds();

  // Only update if listened for at least 5 seconds
  if (totalSeconds < 5) return;

  try {
    const client = getClient();
    if (client) {
      const response = await client.logListening(
        playbackStartSongId,
        Math.round(totalSeconds),
        currentListeningSessionId ?? undefined,
      );
      // Store the session ID for subsequent updates
      currentListeningSessionId = response.sessionId;
    }
  } catch (err) {
    console.warn("[Audio] Failed to update listening session:", err);
  }
}

/**
 * Starts the periodic listening update interval.
 */
function startListeningUpdateInterval(): void {
  // Clear any existing interval
  stopListeningUpdateInterval();

  listeningUpdateInterval = setInterval(() => {
    updateListeningSession();
  }, LISTENING_UPDATE_INTERVAL_MS);
}

/**
 * Stops the periodic listening update interval.
 */
function stopListeningUpdateInterval(): void {
  if (listeningUpdateInterval) {
    clearInterval(listeningUpdateInterval);
    listeningUpdateInterval = null;
  }
}

/**
 * Logs the listening time for the current song and resets tracking.
 * Should be called when:
 * - A track ends naturally
 * - User skips to next/previous track
 * - Track changes for any other reason
 *
 * Only logs if the user has listened for at least 5 seconds.
 */
async function logListeningTimeAndReset(): Promise<void> {
  // Stop the periodic update interval
  stopListeningUpdateInterval();

  if (!playbackStartSongId) return;

  const totalSeconds = calculateTotalListeningSeconds();

  // Only log if listened for at least 5 seconds
  if (totalSeconds >= 5) {
    try {
      const client = getClient();
      if (client) {
        // Final update with the session ID
        await client.logListening(
          playbackStartSongId,
          Math.round(totalSeconds),
          currentListeningSessionId ?? undefined,
        );
      }
    } catch (err) {
      console.warn("[Audio] Failed to log listening time:", err);
    }
  }

  // Reset tracking
  playbackStartTime = null;
  playbackStartSongId = null;
  accumulatedPlayTime = 0;
  currentListeningSessionId = null;
}

/**
 * Hook to initialize the audio engine. Should be called ONCE in a top-level component.
 * This sets up the audio element and all event listeners.
 *
 * Uses server-side queue state for track information.
 */
export function useAudioEngineInit() {
  const queryClient = useQueryClient();
  const [playbackState, setPlaybackState] = useAtom(playbackStateAtom);
  const setPlaybackError = useSetAtom(playbackErrorAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setBuffered = useSetAtom(bufferedAtom);
  const effectiveVolume = useAtomValue(effectiveVolumeAtom);
  const [hasScrobbled, setHasScrobbled] = useAtom(hasScrobbledAtom);
  const scrobbleThreshold = useAtomValue(scrobbleThresholdAtom);
  const setAudioElement = useSetAtom(audioElementAtom);

  // Transcoding and ReplayGain settings
  const transcodingEnabled = useAtomValue(transcodingEnabledAtom);
  const transcodingBitrate = useAtomValue(transcodingBitrateAtom);
  const replayGainMode = useAtomValue(replayGainModeAtom);
  const replayGainOffset = useAtomValue(replayGainOffsetAtom);

  // Server-side queue state
  const queueState = useAtomValue(serverQueueStateAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const isRestoringQueue = useAtomValue(isRestoringQueueAtom);
  const trackChangeSignal = useAtomValue(trackChangeSignalAtom);
  const goToNext = useSetAtom(goToNextAtom);
  const fetchQueue = useSetAtom(fetchQueueAtom);

  // Track connection state for initial queue fetch
  const serverConnection = useAtomValue(serverConnectionAtom);
  const isHydrated = useAtomValue(isHydratedAtom);

  // Track if we've initialized
  const initializedRef = useRef(false);
  // Track if we've fetched the initial queue
  const hasInitialFetchRef = useRef(false);
  // Track the last processed signal to detect restarts of the same track
  const lastProcessedSignalRef = useRef<number>(-1);
  // Track the last stream URL to detect settings changes
  const lastStreamUrlRef = useRef<string | null>(null);

  // Callback to invalidate queries that contain play count data
  const invalidatePlayCountQueries = () => {
    invalidatePlayCounts(queryClient);
  };

  // Refs for setters to avoid stale closures
  const settersRef = useRef({
    setPlaybackState,
    setPlaybackError,
    setCurrentTime,
    setDuration,
    setBuffered,
    setHasScrobbled,
    setAudioElement,
    invalidatePlayCountQueries,
    goToNext,
  });

  // Keep setter refs in sync
  useEffect(() => {
    settersRef.current = {
      setPlaybackState,
      setPlaybackError,
      setCurrentTime,
      setDuration,
      setBuffered,
      setHasScrobbled,
      setAudioElement,
      invalidatePlayCountQueries,
      goToNext,
    };
  });

  // Refs to avoid stale closures in event handlers
  const stateRef = useRef({
    playbackState,
    hasScrobbled,
    scrobbleThreshold,
    currentSong,
    queueState,
    isRestoringQueue,
    transcodingEnabled,
    replayGainMode,
    replayGainOffset,
  });

  // Keep refs in sync
  useEffect(() => {
    stateRef.current = {
      playbackState,
      hasScrobbled,
      scrobbleThreshold,
      currentSong,
      queueState,
      isRestoringQueue,
      transcodingEnabled,
      replayGainMode,
      replayGainOffset,
    };
  });

  // Fetch initial queue on mount - wait for hydration and client to be ready
  useEffect(() => {
    // Wait for hydration (localStorage has been read)
    if (!isHydrated) return;
    // Wait for connection to be available
    if (!serverConnection) return;
    // Only fetch once
    if (hasInitialFetchRef.current) return;

    // Double-check client is available (should be since we have serverConnection)
    const client = getClient();
    if (!client) return;

    hasInitialFetchRef.current = true;
    fetchQueue();
  }, [isHydrated, serverConnection, fetchQueue]);

  // Initialize audio element and event listeners ONCE
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initializedRef.current) return;
    initializedRef.current = true;

    const audio = getGlobalAudio();
    if (!audio) return;
    setAudioElement(audio);

    const handlePlay = () => {
      console.log("[Audio] play event fired");
      settersRef.current.setPlaybackState("playing");

      // Start tracking listening time
      const currentSongId = stateRef.current.currentSong?.id;
      if (currentSongId) {
        // If this is a new song, reset tracking
        if (currentSongId !== playbackStartSongId) {
          playbackStartSongId = currentSongId;
          accumulatedPlayTime = 0;
          currentListeningSessionId = null;
        }
        // Record when playback started
        playbackStartTime = Date.now();
        // Start periodic updates
        startListeningUpdateInterval();
      }
    };

    const handlePause = () => {
      console.log("[Audio] pause event fired");
      // Don't overwrite "ended" state - that's intentional when queue finishes
      if (isEndingQueue) {
        isEndingQueue = false;
        return;
      }
      settersRef.current.setPlaybackState("paused");

      // Stop periodic updates
      stopListeningUpdateInterval();

      // Accumulate listening time when paused and update the session
      if (playbackStartTime !== null) {
        accumulatedPlayTime += (Date.now() - playbackStartTime) / 1000;
        playbackStartTime = null;
        // Update the session with current accumulated time
        updateListeningSession();
      }
    };

    const handleEnded = () => {
      console.log("[Audio] ended event fired");
      // Log listening time before moving to next track
      logListeningTimeAndReset();

      // Handle repeat-one mode: just restart the track
      const state = stateRef.current;
      if (state.queueState?.repeatMode === "one") {
        audio.currentTime = 0;
        // Resume context just in case, then play
        resumeAudioContext().then(() => {
          audio.play().catch(console.error);
        });
        return;
      }

      // Check if we're at the end of the queue
      if (state.queueState) {
        const isLastTrack =
          state.queueState.currentIndex >= state.queueState.totalCount - 1;
        if (isLastTrack && state.queueState.repeatMode !== "all") {
          // End of queue - mark as ended
          isEndingQueue = true;
          settersRef.current.setCurrentTime(0);
          settersRef.current.setPlaybackState("ended");
          return;
        }
      }

      // Go to next track via server queue
      settersRef.current.goToNext();
    };

    const handleTimeUpdate = () => {
      // Add the stream time offset to get the real position in the song
      // This is needed when using timeOffset-based seeking with transcoding
      const realTime = audio.currentTime + currentStreamTimeOffset;
      settersRef.current.setCurrentTime(realTime);

      const state = stateRef.current;
      const duration = audio.duration || 0;
      if (!state.hasScrobbled && duration > 0) {
        // Calculate actual accumulated listening time (not just current position)
        // This ensures seeking past 50% doesn't immediately trigger a scrobble
        const totalListenedSeconds = calculateTotalListeningSeconds();
        const thresholdSeconds = duration * state.scrobbleThreshold;

        if (totalListenedSeconds >= thresholdSeconds) {
          settersRef.current.setHasScrobbled(true);
          if (state.currentSong) {
            getClient()
              ?.scrobble(state.currentSong.id)
              .then(() => {
                // Invalidate queries that display play counts so they update in real-time
                settersRef.current.invalidatePlayCountQueries();
              })
              .catch(console.error);
          }
        }
      }
    };

    const handleDurationChange = () => {
      // When transcoding is enabled, the audio.duration from the stream may be unreliable
      // (it changes as the stream is buffered). Prefer the database duration.
      const state = stateRef.current;
      const songDuration = state.currentSong?.duration;

      if (state.transcodingEnabled && songDuration && songDuration > 0) {
        // Use database duration when transcoding - it's more reliable
        settersRef.current.setDuration(songDuration);
      } else {
        // Use audio element duration when not transcoding or no database duration
        settersRef.current.setDuration(audio.duration || 0);
      }
    };

    const handleProgress = () => {
      if (audio.buffered.length > 0) {
        // Add stream time offset for correct buffered display with transcoded seeking
        settersRef.current.setBuffered(
          audio.buffered.end(audio.buffered.length - 1) + currentStreamTimeOffset,
        );
      }
    };

    const handleLoadStart = () => {
      console.log("[Audio] loadstart event");
      // Don't set loading state during restore - we want to stay paused
      // Also skip if we're intentionally stopping (clearing queue)
      if (!stateRef.current.isRestoringQueue && !isIntentionalStop) {
        settersRef.current.setPlaybackState("loading");
      }
    };

    const handleCanPlay = () => {
      console.log("[Audio] canplay event");
      const state = stateRef.current;

      // Don't try to play if src is empty or cleared
      if (
        !audio.src ||
        audio.src === "" ||
        audio.src === window.location.href
      ) {
        console.log("[Audio] Skipping auto-play because src is empty");
        return;
      }

      // Don't auto-play if we're restoring queue from server
      if (state.isRestoringQueue) {
        console.log(
          "[Audio] Skipping auto-play because queue is being restored",
        );
        isLoadingNewTrack = false;
        // Set state to paused so the play button shows correctly
        settersRef.current.setPlaybackState("paused");
        return;
      }

      // Don't auto-play if queue has ended (unless we're loading a new track)
      if (state.playbackState === "ended" && !isLoadingNewTrack) {
        console.log("[Audio] Skipping auto-play because queue has ended");
        settersRef.current.setPlaybackState("ended");
        return;
      }
      isLoadingNewTrack = false;
      // Always try to play when canplay fires
      // Ensure AudioContext is resumed first (may have been suspended by browser)
      resumeAudioContext().then(() => {
        audio.play().catch((err) => {
          console.error("[Audio] Failed to play on canplay:", err);
        });
      });
    };

    const handleWaiting = () => {
      console.log("[Audio] waiting event (buffering)");
      const state = stateRef.current;
      // Don't set loading if queue has ended or is idle
      if (state.playbackState !== "ended" && state.playbackState !== "idle") {
        settersRef.current.setPlaybackState("loading");
      }
    };

    const handlePlaying = () => {
      console.log("[Audio] playing event");
      // Clear any previous error when playback successfully starts
      settersRef.current.setPlaybackError(null);
      settersRef.current.setPlaybackState("playing");
    };

    const handleError = (e: Event) => {
      // Skip error handling if we're intentionally stopping/clearing
      if (isIntentionalStop) {
        console.log("[Audio] Ignoring error during intentional stop");
        return;
      }

      const audioElement = e.target as HTMLAudioElement;
      const mediaError = audioElement?.error;
      const state = stateRef.current;

      // Ignore errors from empty src (happens during cleanup)
      if (
        !audioElement?.src ||
        audioElement.src === "" ||
        audioElement.src === window.location.href
      ) {
        console.log("[Audio] Ignoring error from empty/cleared src");
        return;
      }

      // Determine error message based on error code
      let errorMessage = "Failed to play track";
      if (mediaError) {
        switch (mediaError.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMessage = "Playback was aborted";
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMessage = "Network error while loading track";
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMessage = "Could not decode audio file";
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = "Audio format not supported or file not found";
            break;
        }
      }

      console.error("[Audio] Playback error:", errorMessage, mediaError);

      // Set error state
      settersRef.current.setPlaybackError({
        message: errorMessage,
        trackId: state.currentSong?.id,
        trackTitle: state.currentSong?.title,
        timestamp: Date.now(),
      });
      settersRef.current.setPlaybackState("error");

      // Show toast notification
      const trackName = state.currentSong?.title || "Unknown track";
      toast.error(`Playback failed: ${trackName}`, {
        description: errorMessage,
        duration: 5000,
      });
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("progress", handleProgress);
    audio.addEventListener("loadstart", handleLoadStart);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("error", handleError);

    // Cleanup only happens on full unmount (which shouldn't happen for root component)
    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("progress", handleProgress);
      audio.removeEventListener("loadstart", handleLoadStart);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("error", handleError);
      // Clean up the listening update interval
      stopListeningUpdateInterval();
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally run once on mount; setAudioElement is stable
  }, []);

  // Update volume
  useEffect(() => {
    if (globalAudio) {
      globalAudio.volume = effectiveVolume;
    }
  }, [effectiveVolume]);

  // Pause audio when playback state becomes "ended" (e.g., when queue ends via goToNext)
  useEffect(() => {
    if (playbackState === "ended" && globalAudio && !globalAudio.paused) {
      // Set flag to prevent handlePause from overwriting "ended" state with "paused"
      isEndingQueue = true;
      globalAudio.pause();
    }
  }, [playbackState]);

  // Load new track when current song changes (triggered by trackChangeSignal or currentSong)
  // Also reload when transcoding settings change
  useEffect(() => {
    const audio = globalAudio;
    const client = getClient();

    if (!audio || !currentSong || !client) {
      if (audio && audio.src && !currentSong) {
        // Set flag BEFORE any audio operation to prevent error toasts
        isIntentionalStop = true;
        isEndingQueue = false; // Clear ending flag
        isLoadingNewTrack = false; // Clear loading flag

        // Pause first to stop any pending operations
        audio.pause();

        // Clear the source - this must be done carefully to avoid errors
        try {
          audio.removeAttribute("src");
          audio.load(); // Reset the media element
        } catch (_e) {
          // Fallback if removeAttribute fails
          audio.src = "";
        }

        setPlaybackState("idle");
        currentLoadedTrackId = null;
        lastStreamUrlRef.current = null;

        // Reset flag after sufficient delay to allow all error events to process
        setTimeout(() => {
          isIntentionalStop = false;
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
    // (signal changes when user explicitly starts playback or repeat-all wraps around)
    const signalChanged = trackChangeSignal !== lastProcessedSignalRef.current;
    const urlChanged = streamUrl !== lastStreamUrlRef.current;

    if (
      currentSong.id === currentLoadedTrackId &&
      !signalChanged &&
      !urlChanged
    ) {
      return;
    }
    lastProcessedSignalRef.current = trackChangeSignal;
    lastStreamUrlRef.current = streamUrl;

    // Log listening time for the track we're leaving
    if (currentLoadedTrackId && currentSong.id !== currentLoadedTrackId) {
      logListeningTimeAndReset();
    }

    currentLoadedTrackId = currentSong.id;

    // Initialize Web Audio API if not already done (needed for client-side ReplayGain)
    if (!audioContext) {
      initializeWebAudio(audio);
    }

    // Resume AudioContext if suspended (required after user interaction)
    resumeAudioContext();

    // Apply client-side ReplayGain
    // Note: We always need to apply this client-side because:
    // - When transcoding is disabled: browser ignores ReplayGain tags in original file
    // - When transcoding is enabled: browser ignores ReplayGain tags embedded in Opus stream
    //   (the server embeds R128_TRACK_GAIN but doesn't apply output_gain during transcoding)
    if (replayGainMode !== "disabled") {
      const trackGain = currentSong.replayGainTrackGain ?? 0;
      const totalGain = trackGain + replayGainOffset;
      console.log(
        `[Audio] Applying ReplayGain: track=${trackGain.toFixed(2)} dB, offset=${replayGainOffset.toFixed(2)} dB, total=${totalGain.toFixed(2)} dB`,
      );
      setReplayGain(totalGain);
    } else if (gainNode) {
      // Reset gain to unity when ReplayGain is disabled
      console.log("[Audio] ReplayGain disabled, setting gain to unity");
      gainNode.gain.value = 1;
    }

    // Check if this is just a transcoding settings change (same track, different URL)
    const isTranscodingSettingsChange =
      currentSong.id === currentLoadedTrackId && urlChanged && !signalChanged;

    // Save current playback position if this is a settings change
    const savedPosition = isTranscodingSettingsChange
      ? audio.currentTime + currentStreamTimeOffset
      : 0;
    const wasPlaying = isTranscodingSettingsChange && !audio.paused;

    // Stop current playback
    audio.pause();
    audio.src = streamUrl;

    // Reset stream time offset (no seeking when loading fresh track)
    currentStreamTimeOffset = 0;

    if (isRestoringQueue) {
      // During restore: load the track but don't play, set to paused state
      setPlaybackState("paused");
      setHasScrobbled(false);
      setCurrentTime(0);
      setDuration(currentSong.duration || 0);
      // Just load metadata, don't play
      audio.load();
    } else if (isTranscodingSettingsChange && savedPosition > 0) {
      // Transcoding settings changed - continue from saved position
      console.log(
        `[Audio] Transcoding settings changed, resuming from ${savedPosition.toFixed(1)}s`,
      );
      isLoadingNewTrack = true;
      setPlaybackState("loading");
      // Don't reset scrobble state - we're continuing the same track

      // Set up one-time handler to seek after loading
      const handleCanPlayForSeek = () => {
        audio.removeEventListener("canplay", handleCanPlayForSeek);

        if (transcodingEnabled && savedPosition > 0) {
          // For transcoded streams, we need timeOffset-based seeking
          // But since we just loaded a fresh stream, we need to reload with offset
          currentStreamTimeOffset = savedPosition;
          const offsetUrl = getClient()?.getStreamUrl(currentSong.id, {
            maxBitRate: transcodingEnabled ? transcodingBitrate : undefined,
            format: transcodingEnabled ? "opus" : undefined,
            timeOffset: savedPosition,
          });
          if (offsetUrl) {
            audio.src = offsetUrl;
            setCurrentTime(savedPosition);
            if (wasPlaying) {
              resumeAudioContext().then(() => {
                audio.play().catch(console.error);
              });
            }
          }
        } else {
          // Non-transcoded: native seeking works
          audio.currentTime = savedPosition;
          setCurrentTime(savedPosition);
          if (wasPlaying) {
            resumeAudioContext().then(() => {
              audio.play().catch(console.error);
            });
          }
        }
        isLoadingNewTrack = false;
      };
      audio.addEventListener("canplay", handleCanPlayForSeek);
      audio.load();
    } else {
      // Normal playback: load and play
      isLoadingNewTrack = true;
      setPlaybackState("loading");
      setHasScrobbled(false);
      setCurrentTime(0);
      setDuration(currentSong.duration || 0);

      // Resume AudioContext first, then play
      // Must await this - AudioContext must be running before audio will play through Web Audio graph
      resumeAudioContext().then((contextRunning) => {
        if (!contextRunning) {
          console.error(
            "[Audio] Cannot play: AudioContext not running after resume",
          );
        }
        audio.play().catch((err) => {
          console.error("Failed to play:", err);
          isLoadingNewTrack = false;
          setPlaybackState("paused");
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replayGainMode and replayGainOffset are handled by separate effect
  }, [
    currentSong,
    trackChangeSignal,
    isRestoringQueue,
    transcodingEnabled,
    transcodingBitrate,
    setPlaybackState,
    setHasScrobbled,
    setCurrentTime,
    setDuration,
  ]);

  // Separate effect for ReplayGain settings - updates gain immediately without reloading track
  useEffect(() => {
    if (!currentSong || !gainNode) return;

    if (replayGainMode !== "disabled") {
      const trackGain = currentSong.replayGainTrackGain ?? 0;
      const totalGain = trackGain + replayGainOffset;
      console.log(
        `[Audio] ReplayGain settings changed: track=${trackGain.toFixed(2)} dB, offset=${replayGainOffset.toFixed(2)} dB, total=${totalGain.toFixed(2)} dB`,
      );
      setReplayGain(totalGain);
    } else {
      console.log("[Audio] ReplayGain disabled, setting gain to unity");
      gainNode.gain.value = 1;
    }
  }, [replayGainMode, replayGainOffset, currentSong]);
}

/**
 * Hook for playback controls. Can be used in any component.
 * Does NOT set up audio - that's done by useAudioEngineInit.
 */
export function useAudioEngine() {
  const [playbackState, setPlaybackState] = useAtom(playbackStateAtom);
  const setPlaybackError = useSetAtom(playbackErrorAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);

  const currentSong = useAtomValue(currentSongAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const goToNextAction = useSetAtom(goToNextAtom);
  const goToPreviousAction = useSetAtom(goToPreviousAtom);
  const playAtIndex = useSetAtom(playAtIndexAtom);
  const setIsRestoring = useSetAtom(isRestoringQueueAtom);

  // Transcoding settings (needed for time-offset seeking)
  const transcodingEnabled = useAtomValue(transcodingEnabledAtom);
  const transcodingBitrate = useAtomValue(transcodingBitrateAtom);
  const transcodingSeekMode = useAtomValue(transcodingSeekModeAtom);

  // Retry playback by forcing a fresh load of the current track
  const retryPlayback = () => {
    if (!globalAudio || !currentSong) return;

    const client = getClient();
    if (!client) return;

    // Clear error state
    setPlaybackError(null);
    setPlaybackState("loading");

    // Force reload by clearing cached state
    currentLoadedTrackId = null;

    // Get fresh stream URL and load
    const streamUrl = client.getStreamUrl(currentSong.id);
    globalAudio.src = streamUrl;
    currentStreamTimeOffset = 0; // Reset offset for fresh load
    isLoadingNewTrack = true;

    // Resume AudioContext then play
    resumeAudioContext().then((contextRunning) => {
      if (!contextRunning) {
        console.error("[Audio] Cannot retry: AudioContext not running");
      }
      globalAudio?.play().catch((err) => {
        console.error("[Audio] Retry playback failed:", err);
        setPlaybackState("error");
      });
    });
  };

  const play = async () => {
    // Clear restore flag on explicit user interaction
    setIsRestoring(false);
    // Resume AudioContext if suspended (required for Web Audio API after user gesture)
    // Must await this - AudioContext must be running before audio will play through Web Audio graph
    const contextRunning = await resumeAudioContext();
    if (!contextRunning) {
      console.error("[Audio] Cannot play: AudioContext not running");
    }
    globalAudio?.play().catch(console.error);
  };

  const pause = () => {
    globalAudio?.pause();
  };

  const togglePlayPause = () => {
    if (!globalAudio) return;

    if (playbackState === "playing") {
      pause();
    } else if (playbackState === "loading") {
      // If loading, pause to cancel the pending play
      pause();
    } else if (playbackState === "ended") {
      // Queue finished - restart from the beginning
      if (queueState && queueState.totalCount > 0) {
        currentLoadedTrackId = null; // Force reload
        setIsRestoring(false);
        playAtIndex(0); // Go back to first track
      }
    } else if (playbackState === "error") {
      // Retry playback after error
      retryPlayback();
    } else {
      play();
    }
  };

  // Trailing throttle state for unbuffered seeks (only used when transcoding)
  const lastUnbufferedSeekRef = useRef<number>(0);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingSeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Native seek for non-transcoded content or buffered positions
  const seekNative = (time: number) => {
    if (globalAudio) {
      globalAudio.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Reload stream with time offset for transcoded unbuffered seeks
  const seekWithTimeOffset = (time: number) => {
    if (!globalAudio || !currentSong) return;

    const client = getClient();
    if (!client) return;

    const wasPlaying = !globalAudio.paused;

    // Track the offset so handleTimeUpdate can calculate real position
    currentStreamTimeOffset = time;

    // Build new stream URL with time offset and seek mode
    const streamUrl = client.getStreamUrl(currentSong.id, {
      maxBitRate: transcodingEnabled ? transcodingBitrate : undefined,
      format: transcodingEnabled ? "opus" : undefined,
      timeOffset: time,
      seekMode: transcodingSeekMode,
    });

    // Reload the stream from the new offset
    globalAudio.src = streamUrl;
    setCurrentTime(time);

    if (wasPlaying) {
      resumeAudioContext().then(() => {
        globalAudio?.play().catch(console.error);
      });
    } else {
      globalAudio.load();
    }
  };

  // General seek function that chooses the right strategy
  const seek = (time: number) => {
    if (!globalAudio) return;

    // Check if target time is within buffered ranges
    const isBuffered = (() => {
      const buffered = globalAudio.buffered;
      for (let i = 0; i < buffered.length; i++) {
        if (time >= buffered.start(i) && time <= buffered.end(i)) {
          return true;
        }
      }
      return false;
    })();

    if (isBuffered || !transcodingEnabled) {
      // Buffered content or no transcoding: native seek works
      seekNative(time);
    } else {
      // Unbuffered transcoded content: reload stream with time offset
      seekWithTimeOffset(time);
    }
  };

  // Smart seeking with trailing throttle for unbuffered positions when transcoding
  // This reduces stream reloads during scrubbing while ensuring final position is reached
  const seekPercent = (percent: number) => {
    if (!globalAudio) return;

    // Use database duration (stable) instead of audio.duration (unreliable with transcoding)
    const duration = currentSong?.duration ?? globalAudio.duration;
    if (!duration || duration <= 0) return;

    const targetTime = (percent / 100) * duration;

    // Check if target time is within buffered ranges
    const isBuffered = (() => {
      const buffered = globalAudio.buffered;
      for (let i = 0; i < buffered.length; i++) {
        if (targetTime >= buffered.start(i) && targetTime <= buffered.end(i)) {
          return true;
        }
      }
      return false;
    })();

    if (isBuffered || !transcodingEnabled) {
      // Buffered content or no transcoding: seek immediately
      // Also clear any pending unbuffered seek
      if (pendingSeekTimeoutRef.current) {
        clearTimeout(pendingSeekTimeoutRef.current);
        pendingSeekTimeoutRef.current = null;
      }
      pendingSeekRef.current = null;
      seekNative(targetTime);
    } else {
      // Unbuffered transcoded content: use trailing throttle to reduce stream reloads
      const now = Date.now();
      const throttleMs = 150; // Slightly higher for stream reloads
      const timeSinceLastSeek = now - lastUnbufferedSeekRef.current;

      // Always store the latest target
      pendingSeekRef.current = targetTime;

      if (timeSinceLastSeek >= throttleMs) {
        // Throttle window expired - seek immediately
        lastUnbufferedSeekRef.current = now;
        pendingSeekRef.current = null;
        if (pendingSeekTimeoutRef.current) {
          clearTimeout(pendingSeekTimeoutRef.current);
          pendingSeekTimeoutRef.current = null;
        }
        seekWithTimeOffset(targetTime);
      } else if (!pendingSeekTimeoutRef.current) {
        // Schedule trailing seek after throttle window
        const remainingTime = throttleMs - timeSinceLastSeek;
        pendingSeekTimeoutRef.current = setTimeout(() => {
          if (pendingSeekRef.current !== null) {
            lastUnbufferedSeekRef.current = Date.now();
            seekWithTimeOffset(pendingSeekRef.current);
            pendingSeekRef.current = null;
          }
          pendingSeekTimeoutRef.current = null;
        }, remainingTime);
      }
    }
  };

  const next = () => {
    // Log listening time before skipping
    logListeningTimeAndReset();
    // Clear restore flag on explicit user interaction
    setIsRestoring(false);
    goToNextAction();
  };

  const previous = () => {
    // Clear restore flag on explicit user interaction
    setIsRestoring(false);

    if (globalAudio && globalAudio.currentTime > 3) {
      globalAudio.currentTime = 0;
      return;
    }

    // Log listening time before going to previous track
    logListeningTimeAndReset();
    goToPreviousAction();
  };

  // Force go to previous track (used for swipe gestures - always skip, never restart)
  const previousForce = () => {
    // Clear restore flag on explicit user interaction
    setIsRestoring(false);

    // Log listening time before going to previous track
    logListeningTimeAndReset();
    goToPreviousAction();
  };

  return {
    play,
    pause,
    togglePlayPause,
    seek,
    seekPercent,
    next,
    previous,
    previousForce,
    retryPlayback,
    playbackState,
  };
}

// Hook for volume control
export function useVolumeControl() {
  const [volume, setVolume] = useAtom(volumeAtom);
  const [isMuted, setIsMuted] = useAtom(isMutedAtom);

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  const changeVolume = (newVolume: number) => {
    setVolume(Math.max(0, Math.min(1, newVolume)));
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  return { volume, isMuted, toggleMute, changeVolume };
}

// Hook for repeat mode cycling (using server-side state)
export function useRepeatMode() {
  const queueState = useAtomValue(serverQueueStateAtom);
  const setRepeatModeAction = useSetAtom(setRepeatModeAtom);

  const repeatMode = queueState?.repeatMode ?? "off";

  const cycleRepeatMode = () => {
    const nextMode: Record<RepeatMode, RepeatMode> = {
      off: "all",
      all: "one",
      one: "off",
    };
    setRepeatModeAction(nextMode[repeatMode]);
  };

  return { repeatMode, cycleRepeatMode };
}

// Hook for shuffle (using server-side state)
export function useShuffle() {
  const queueState = useAtomValue(serverQueueStateAtom);
  const toggleShuffleAction = useSetAtom(toggleShuffleAtom);

  const isShuffled = queueState?.isShuffled ?? false;

  const toggleShuffle = () => {
    toggleShuffleAction();
  };

  return { isShuffled, toggleShuffle };
}

/**
 * Hook for Media Session API integration.
 * Enables OS-level media controls (play/pause, next, previous, seek).
 * Should be called in a component that has access to audio controls.
 */
export function useMediaSession() {
  const currentSong = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const audioElement = useAtomValue(audioElementAtom);
  const { play, pause, next, previous } = useAudioEngine();

  // Update Media Session metadata when track changes
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    if (currentSong) {
      const client = getClient();
      const coverArtUrl =
        currentSong.coverArt && client
          ? client.getCoverArtUrl(currentSong.coverArt, 512)
          : undefined;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: currentSong.artist || "Unknown Artist",
        album: currentSong.album || "Unknown Album",
        artwork: coverArtUrl
          ? [
              { src: coverArtUrl, sizes: "96x96", type: "image/jpeg" },
              { src: coverArtUrl, sizes: "256x256", type: "image/jpeg" },
              { src: coverArtUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } else {
      navigator.mediaSession.metadata = null;
    }
  }, [currentSong]);

  // Update playback state
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    navigator.mediaSession.playbackState =
      playbackState === "playing" ? "playing" : "paused";
  }, [playbackState]);

  // Update position state
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    if (!("setPositionState" in navigator.mediaSession)) {
      return;
    }

    if (duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.min(currentTime, duration),
        });
      } catch {
        // Ignore errors from invalid position state
      }
    }
  }, [currentTime, duration]);

  // Set up action handlers
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const actionHandlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => play()],
      ["pause", () => pause()],
      ["previoustrack", () => previous()],
      ["nexttrack", () => next()],
      [
        "seekbackward",
        (details) => {
          if (audioElement) {
            const skipTime = details.seekOffset || 10;
            audioElement.currentTime = Math.max(
              audioElement.currentTime - skipTime,
              0,
            );
          }
        },
      ],
      [
        "seekforward",
        (details) => {
          if (audioElement) {
            const skipTime = details.seekOffset || 10;
            audioElement.currentTime = Math.min(
              audioElement.currentTime + skipTime,
              duration,
            );
          }
        },
      ],
      [
        "seekto",
        (details) => {
          if (audioElement && details.seekTime != null) {
            audioElement.currentTime = details.seekTime;
          }
        },
      ],
      ["stop", () => pause()],
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Browser doesn't support this action
      }
    }

    // Cleanup
    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Browser doesn't support this action
        }
      }
    };
  }, [play, pause, next, previous, audioElement, duration]);
}
