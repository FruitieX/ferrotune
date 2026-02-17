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
  clippingStateAtom,
  clippingDetectionEnabledAtom,
} from "@/lib/store/player";
import {
  startClippingDetection,
  stopClippingDetection,
  resetClippingPeak,
} from "@/lib/audio/clipping-detector";
import {
  serverQueueStateAtom,
  currentSongAtom,
  nextSongAtom,
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

// ============================================================================
// Dual Audio Element System for Gapless Playback
// ============================================================================
// Two audio elements are used: one active (playing) and one inactive (pre-buffering).
// Each has its own MediaElementAudioSourceNode → GainNode, both feeding into a shared
// AnalyserNode → AudioContext.destination. The inactive element's gain is 0.
// When the active track ends, we swap: the pre-buffered element becomes active immediately.

// Dual audio elements for gapless playback
const audioElements: [HTMLAudioElement | null, HTMLAudioElement | null] = [
  null,
  null,
];
let activeIndex: 0 | 1 = 0;

// Web Audio API nodes - dual gain nodes, shared analyser
let audioContext: AudioContext | null = null;
const sourceNodes: [
  MediaElementAudioSourceNode | null,
  MediaElementAudioSourceNode | null,
] = [null, null];
const gainNodes: [GainNode | null, GainNode | null] = [null, null];
let analyserNode: AnalyserNode | null = null;

// Pre-buffering state
let preBufferedTrackId: string | null = null;
let preBufferReady = false;
// Time in seconds before track end to start pre-buffering
const PRE_BUFFER_LEAD_TIME = 15;

// Track the currently loaded track ID to avoid unnecessary reloads when queue changes
let currentLoadedTrackId: string | null = null;
// Flag to prevent handlePause from overwriting "ended" state
let isEndingQueue: boolean = false;
// Flag to indicate we're intentionally loading a new track (overrides "ended" state check)
let isLoadingNewTrack: boolean = false;
// Flag to indicate we're intentionally stopping/clearing (prevents error toasts)
let isIntentionalStop: boolean = false;
// Flag to indicate a gapless handoff is in progress (prevents double-advance)
let isGaplessHandoff = false;
// Track the expected track ID during gapless handoff so queue sync can be
// acknowledged without reloading the already-playing pre-buffered stream.
let gaplessHandoffExpectedTrackId: string | null = null;
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
 * Initialize Web Audio API for ReplayGain processing with dual audio elements.
 * Creates an AudioContext, two source/gain chains, and a shared analyser.
 * Both chains feed into: sourceNode → gainNode → analyserNode → destination
 * The inactive element's gain is set to 0 to prevent audio bleed.
 */
function initializeWebAudio(
  audio0: HTMLAudioElement,
  audio1: HTMLAudioElement,
): void {
  if (audioContext) return; // Already initialized

  try {
    console.log(
      "[Audio] Initializing Web Audio API with dual elements for gapless playback",
    );
    audioContext = new AudioContext();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.connect(audioContext.destination);

    // Create source and gain nodes for each element
    for (const [i, audio] of [audio0, audio1].entries()) {
      sourceNodes[i as 0 | 1] = audioContext.createMediaElementSource(audio);
      gainNodes[i as 0 | 1] = audioContext.createGain();
      // Connect: source → gain → analyser
      sourceNodes[i as 0 | 1]!.connect(gainNodes[i as 0 | 1]!);
      gainNodes[i as 0 | 1]!.connect(analyserNode);
    }

    // Set inactive element gain to 0
    const inactiveIdx = activeIndex === 0 ? 1 : 0;
    gainNodes[inactiveIdx]!.gain.value = 0;

    console.log(
      "[Audio] Web Audio API initialized with dual elements, AudioContext state:",
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
 * Update the ReplayGain volume adjustment for a specific audio element.
 * @param gainDb - The gain in dB to apply (can be negative)
 * @param elementIndex - Which audio element's gain to adjust (0 or 1). Defaults to active element.
 */
function setReplayGain(gainDb: number, elementIndex?: 0 | 1): void {
  const idx = elementIndex ?? activeIndex;
  const node = gainNodes[idx];
  if (!node) {
    console.warn(
      "[Audio] Cannot set ReplayGain: gainNode not initialized for element",
      idx,
    );
    return;
  }

  const linearGain = dbToLinear(gainDb);
  // Clamp to prevent extreme values (max +12dB boost)
  const clampedGain = Math.min(linearGain, dbToLinear(12));
  node.gain.value = clampedGain;
  console.log(
    `[Audio] ReplayGain set on element ${idx}: ${gainDb.toFixed(2)} dB -> linear gain ${clampedGain.toFixed(4)}`,
  );
}

/**
 * Creates an audio element for gapless playback.
 * Uses `preload="auto"` for full buffering and enables CORS for Web Audio API.
 */
function createAudioElement(): HTMLAudioElement {
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
  audio.setAttribute("aria-hidden", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);
  return audio;
}

/**
 * Gets or creates the dual audio elements for gapless playback.
 * Returns the currently active audio element.
 */
export function getGlobalAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (!audioElements[0]) {
    audioElements[0] = createAudioElement();
    audioElements[1] = createAudioElement();
  }
  return audioElements[activeIndex];
}

/**
 * Gets the currently active audio element without creating elements.
 */
function getActiveAudio(): HTMLAudioElement | null {
  return audioElements[activeIndex];
}

/**
 * Gets the inactive (pre-buffer) audio element.
 */
function getInactiveAudio(): HTMLAudioElement | null {
  return audioElements[activeIndex === 0 ? 1 : 0];
}

/**
 * Invalidates the pre-buffer state, clearing any pre-loaded track.
 */
function invalidatePreBuffer(): void {
  const inactiveAudio = getInactiveAudio();
  if (inactiveAudio && preBufferedTrackId) {
    console.log(
      "[Audio] Invalidating pre-buffer for track:",
      preBufferedTrackId,
    );
    inactiveAudio.pause();
    inactiveAudio.removeAttribute("src");
    inactiveAudio.load();
  }
  preBufferedTrackId = null;
  preBufferReady = false;
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
 *
 * @param skipped - Whether the song was skipped by the user
 */
async function logListeningTimeAndReset(skipped = false): Promise<void> {
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
          skipped,
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
  const setClippingState = useSetAtom(clippingStateAtom);
  const clippingDetectionEnabled = useAtomValue(clippingDetectionEnabledAtom);

  // Transcoding and ReplayGain settings
  const transcodingEnabled = useAtomValue(transcodingEnabledAtom);
  const transcodingBitrate = useAtomValue(transcodingBitrateAtom);
  const replayGainMode = useAtomValue(replayGainModeAtom);
  const replayGainOffset = useAtomValue(replayGainOffsetAtom);

  // Server-side queue state
  const queueState = useAtomValue(serverQueueStateAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const nextSong = useAtomValue(nextSongAtom);
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
    setClippingState,
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
      setClippingState,
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
    nextSong,
    queueState,
    isRestoringQueue,
    transcodingEnabled,
    transcodingBitrate,
    replayGainMode,
    replayGainOffset,
    clippingDetectionEnabled,
  });

  // Keep refs in sync
  useEffect(() => {
    stateRef.current = {
      playbackState,
      hasScrobbled,
      scrobbleThreshold,
      currentSong,
      nextSong,
      queueState,
      isRestoringQueue,
      transcodingEnabled,
      transcodingBitrate,
      replayGainMode,
      replayGainOffset,
      clippingDetectionEnabled,
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

  // Initialize audio elements and event listeners ONCE
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initializedRef.current) return;
    initializedRef.current = true;

    const audio = getGlobalAudio();
    if (!audio) return;
    setAudioElement(audio);

    // Also ensure secondary element exists
    const audio1 = audioElements[1];
    if (!audio1) return;

    // Initialize Web Audio API with both elements immediately
    initializeWebAudio(audioElements[0]!, audio1);

    // ========================================================================
    // Event Handlers for ACTIVE element only
    // The inactive (pre-buffer) element has its own minimal handlers below.
    // ========================================================================

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

    const handlePause = (e: Event) => {
      if (!isFromActive(e)) return;
      console.log("[Audio] pause event fired on active element", activeIndex);
      // Don't overwrite "ended" state - that's intentional when queue finishes
      if (isEndingQueue) {
        isEndingQueue = false;
        return;
      }
      settersRef.current.setPlaybackState("paused");

      // Stop clipping detection while paused
      stopClippingDetection();

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
          isEndingQueue = true;
          settersRef.current.setCurrentTime(0);
          settersRef.current.setPlaybackState("ended");
          invalidatePreBuffer();
          return;
        }
      }

      // =====================================================================
      // GAPLESS HANDOFF: if pre-buffer is ready, swap immediately
      // =====================================================================
      if (preBufferReady && preBufferedTrackId) {
        console.log(
          "[Audio] Gapless handoff: swapping to pre-buffered element",
        );
        const handoffTrackId = preBufferedTrackId;
        isGaplessHandoff = true;
        gaplessHandoffExpectedTrackId = handoffTrackId;

        // Swap active index
        const oldActiveIdx = activeIndex;
        const newActiveIdx: 0 | 1 = activeIndex === 0 ? 1 : 0;
        activeIndex = newActiveIdx;

        // Mute the old element
        if (gainNodes[oldActiveIdx]) {
          gainNodes[oldActiveIdx]!.gain.value = 0;
        }

        // Apply ReplayGain to the new active element
        const nextSongData = stateRef.current.nextSong;
        if (nextSongData && stateRef.current.replayGainMode !== "disabled") {
          const trackGain = nextSongData.replayGainTrackGain ?? 0;
          const totalGain = trackGain + stateRef.current.replayGainOffset;
          setReplayGain(totalGain, newActiveIdx);
        } else if (gainNodes[newActiveIdx]) {
          // ReplayGain disabled: set unity gain
          gainNodes[newActiveIdx]!.gain.value = 1;
        }

        // Update the audio element atom so the rest of the app knows
        settersRef.current.setAudioElement(audioElements[activeIndex]!);

        // Reset tracking for the new active element
        currentLoadedTrackId = handoffTrackId;
        currentStreamTimeOffset = 0;
        preBufferedTrackId = null;
        preBufferReady = false;

        // Reset scrobble tracking for new track
        settersRef.current.setHasScrobbled(false);
        settersRef.current.setCurrentTime(0);
        settersRef.current.setBuffered(0);
        if (nextSongData) {
          settersRef.current.setDuration(nextSongData.duration || 0);
        }

        // Play the pre-buffered element immediately (should be instant)
        resumeAudioContext().then(() => {
          audioElements[activeIndex]?.play().catch(console.error);
        });

        // Update server state asynchronously (fire-and-forget)
        settersRef.current.goToNext();

        // Clean up old element
        const oldElement = audioElements[oldActiveIdx];
        if (oldElement) {
          oldElement.pause();
          oldElement.removeAttribute("src");
          oldElement.load();
        }

        return;
      }

      // No pre-buffer ready, fall back to standard next track
      settersRef.current.goToNext();
    };

    const handleTimeUpdate = (e: Event) => {
      if (!isFromActive(e)) return;
      const activeAudio = audioElements[activeIndex]!;
      // Add the stream time offset to get the real position in the song
      const realTime = activeAudio.currentTime + currentStreamTimeOffset;
      settersRef.current.setCurrentTime(realTime);

      // Also update buffered during timeupdate as a fallback
      if (activeAudio.buffered.length > 0) {
        const rawBuffered = activeAudio.buffered.end(
          activeAudio.buffered.length - 1,
        );
        settersRef.current.setBuffered(rawBuffered + currentStreamTimeOffset);
      }

      const state = stateRef.current;
      const duration = activeAudio.duration || 0;
      if (!state.hasScrobbled && duration > 0) {
        const totalListenedSeconds = calculateTotalListeningSeconds();
        const thresholdSeconds = duration * state.scrobbleThreshold;

        if (totalListenedSeconds >= thresholdSeconds) {
          settersRef.current.setHasScrobbled(true);
          if (state.currentSong) {
            getClient()
              ?.scrobble(state.currentSong.id)
              .then(() => {
                settersRef.current.invalidatePlayCountQueries();
              })
              .catch(console.error);
          }
        }
      }

      // Pre-buffer logic: start loading next track when near the end
      if (
        duration > 0 &&
        !preBufferedTrackId &&
        state.queueState?.repeatMode !== "one" &&
        activeAudio.currentTime > duration - PRE_BUFFER_LEAD_TIME
      ) {
        const nextSongData = state.nextSong;
        if (nextSongData) {
          startPreBuffering(nextSongData, state);
        }
      }
    };

    /**
     * Start pre-buffering the next track on the inactive audio element.
     */
    const startPreBuffering = (
      nextSongData: {
        id: string;
        replayGainTrackGain?: number | null;
        duration?: number | null;
      },
      state: typeof stateRef.current,
    ) => {
      const client = getClient();
      if (!client) return;

      const inactiveIdx = activeIndex === 0 ? 1 : 0;
      const inactiveAudio = audioElements[inactiveIdx];
      if (!inactiveAudio) return;

      console.log("[Audio] Pre-buffering next track:", nextSongData.id);
      preBufferedTrackId = nextSongData.id;
      preBufferReady = false;

      // Build stream URL for the next track
      const streamUrl = client.getStreamUrl(nextSongData.id, {
        maxBitRate: state.transcodingEnabled
          ? state.transcodingBitrate
          : undefined,
        format: state.transcodingEnabled ? "opus" : undefined,
      });

      // Keep inactive element gain at 0 until handoff
      if (gainNodes[inactiveIdx]) {
        gainNodes[inactiveIdx]!.gain.value = 0;
      }

      // Load the stream
      inactiveAudio.src = streamUrl;
      inactiveAudio.load();
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
      const activeAudio = audioElements[activeIndex]!;
      if (activeAudio.buffered.length > 0) {
        settersRef.current.setBuffered(
          activeAudio.buffered.end(activeAudio.buffered.length - 1) +
            currentStreamTimeOffset,
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
          preBufferReady = true;
        }
        return;
      }

      console.log("[Audio] canplay event on active element");
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
        console.log(
          "[Audio] Skipping auto-play because queue is being restored",
        );
        isLoadingNewTrack = false;
        settersRef.current.setPlaybackState("paused");
        return;
      }

      if (state.playbackState === "ended" && !isLoadingNewTrack) {
        console.log("[Audio] Skipping auto-play because queue has ended");
        settersRef.current.setPlaybackState("ended");
        return;
      }
      isLoadingNewTrack = false;
      resumeAudioContext().then(() => {
        audioElement.play().catch((err) => {
          console.error("[Audio] Failed to play on canplay:", err);
        });
      });
    };

    const handleWaiting = (e: Event) => {
      if (!isFromActive(e)) return;
      console.log("[Audio] waiting event (buffering)");
      const state = stateRef.current;
      if (state.playbackState !== "ended" && state.playbackState !== "idle") {
        settersRef.current.setPlaybackState("loading");
      }
    };

    const handlePlaying = (e: Event) => {
      if (!isFromActive(e)) return;
      console.log("[Audio] playing event on active element");
      settersRef.current.setPlaybackError(null);
      settersRef.current.setPlaybackState("playing");
    };

    const handleError = (e: Event) => {
      // Skip errors from inactive (pre-buffer) element — just invalidate pre-buffer
      if (!isFromActive(e)) {
        console.warn(
          "[Audio] Error on inactive (pre-buffer) element, invalidating pre-buffer",
        );
        invalidatePreBuffer();
        return;
      }

      if (isIntentionalStop) {
        console.log("[Audio] Ignoring error during intentional stop");
        return;
      }

      const audioElement = e.target as HTMLAudioElement;
      const mediaError = audioElement?.error;
      const state = stateRef.current;

      if (
        !audioElement?.src ||
        audioElement.src === "" ||
        audioElement.src === window.location.href
      ) {
        console.log("[Audio] Ignoring error from empty/cleared src");
        return;
      }

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

      settersRef.current.setPlaybackError({
        message: errorMessage,
        trackId: state.currentSong?.id,
        trackTitle: state.currentSong?.title,
        timestamp: Date.now(),
      });
      settersRef.current.setPlaybackState("error");

      const trackName = state.currentSong?.title || "Unknown track";
      toast.error(`Playback failed: ${trackName}`, {
        description: errorMessage,
        duration: 5000,
      });
    };

    // Attach event listeners to BOTH elements (handlers check isFromActive)
    const events: Array<[string, (e: Event) => void]> = [
      ["play", handlePlay],
      ["pause", handlePause],
      ["ended", handleEnded],
      ["timeupdate", handleTimeUpdate],
      ["durationchange", handleDurationChange],
      ["progress", handleProgress],
      ["loadstart", handleLoadStart],
      ["canplay", handleCanPlay],
      ["waiting", handleWaiting],
      ["playing", handlePlaying],
      ["error", handleError],
    ];

    for (const element of [audioElements[0]!, audio1]) {
      for (const [event, handler] of events) {
        element.addEventListener(event, handler);
      }
    }

    // Cleanup
    return () => {
      for (const element of [audioElements[0], audioElements[1]]) {
        if (!element) continue;
        for (const [event, handler] of events) {
          element.removeEventListener(event, handler);
        }
      }
      stopListeningUpdateInterval();
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally run once on mount; setAudioElement is stable
  }, []);

  // Update volume on both elements
  useEffect(() => {
    for (const el of audioElements) {
      if (el) el.volume = effectiveVolume;
    }
  }, [effectiveVolume]);

  // Start/stop clipping detection when the setting changes
  useEffect(() => {
    if (!clippingDetectionEnabled) {
      stopClippingDetection();
      setClippingState(null);
    } else if (
      playbackState === "playing" &&
      analyserNode &&
      audioElements[activeIndex]
    ) {
      const audio = audioElements[activeIndex]!;
      startClippingDetection(
        analyserNode,
        setClippingState,
        () => audio.volume,
      );
    }
  }, [clippingDetectionEnabled, setClippingState, playbackState]);

  // Pause audio when playback state becomes "ended" (e.g., when queue ends via goToNext)
  useEffect(() => {
    if (
      playbackState === "ended" &&
      audioElements[activeIndex] &&
      !audioElements[activeIndex]!.paused
    ) {
      // Set flag to prevent handlePause from overwriting "ended" state with "paused"
      isEndingQueue = true;
      audioElements[activeIndex]!.pause();
    }
  }, [playbackState]);

  // Load new track when current song changes (triggered by trackChangeSignal or currentSong)
  // Also reload when transcoding settings change
  useEffect(() => {
    const audio = getActiveAudio();
    const client = getClient();

    if (!audio || !currentSong || !client) {
      if (audio && audio.src && !currentSong) {
        // Set flag BEFORE any audio operation to prevent error toasts
        isIntentionalStop = true;
        isEndingQueue = false;
        isLoadingNewTrack = false;

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

        setPlaybackState("idle");
        currentLoadedTrackId = null;
        lastStreamUrlRef.current = null;
        invalidatePreBuffer();

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
    const signalChanged = trackChangeSignal !== lastProcessedSignalRef.current;
    const urlChanged = streamUrl !== lastStreamUrlRef.current;

    // During gapless handoff, queue advances after playback already switched.
    // If queue sync points to the same pre-buffered track, consume the signal
    // and skip reloading to prevent restarting the track from 0.
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
      lastProcessedSignalRef.current = trackChangeSignal;
      lastStreamUrlRef.current = streamUrl;
      isGaplessHandoff = false;
      gaplessHandoffExpectedTrackId = null;
      return;
    }

    // Queue selected a different next song than the pre-buffered handoff target
    // (e.g. shuffle/repeat-all reshuffle). Let normal load flow handle it.
    if (
      isGaplessHandoff &&
      gaplessHandoffExpectedTrackId &&
      currentSong.id !== gaplessHandoffExpectedTrackId &&
      signalChanged
    ) {
      console.warn(
        "[Audio] Gapless handoff mismatch with queue state; reloading queue-selected track",
      );
      isGaplessHandoff = false;
      gaplessHandoffExpectedTrackId = null;
    }

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
      resetClippingPeak();
    }

    currentLoadedTrackId = currentSong.id;

    // Invalidate any pre-buffer since we're loading a new track explicitly
    invalidatePreBuffer();

    // Resume AudioContext if suspended (required after user interaction)
    resumeAudioContext();

    // Apply client-side ReplayGain on the active element
    if (replayGainMode !== "disabled") {
      const trackGain = currentSong.replayGainTrackGain ?? 0;
      const totalGain = trackGain + replayGainOffset;
      console.log(
        `[Audio] Applying ReplayGain: track=${trackGain.toFixed(2)} dB, offset=${replayGainOffset.toFixed(2)} dB, total=${totalGain.toFixed(2)} dB`,
      );
      setReplayGain(totalGain, activeIndex);
    } else if (gainNodes[activeIndex]) {
      console.log("[Audio] ReplayGain disabled, setting gain to unity");
      gainNodes[activeIndex]!.gain.value = 1;
    }

    // Ensure inactive element gain is 0
    const inactiveIdx = activeIndex === 0 ? 1 : 0;
    if (gainNodes[inactiveIdx]) {
      gainNodes[inactiveIdx]!.gain.value = 0;
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
      setBuffered(0);
      setDuration(currentSong.duration || 0);
      audio.load();
    } else if (isTranscodingSettingsChange && savedPosition > 0) {
      console.log(
        `[Audio] Transcoding settings changed, resuming from ${savedPosition.toFixed(1)}s`,
      );
      isLoadingNewTrack = true;
      setPlaybackState("loading");

      const handleCanPlayForSeek = () => {
        audio.removeEventListener("canplay", handleCanPlayForSeek);

        if (transcodingEnabled && savedPosition > 0) {
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
      setBuffered(0);
      setDuration(currentSong.duration || 0);

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
    setBuffered,
    setDuration,
  ]);

  // Separate effect for ReplayGain settings - updates gain immediately without reloading track
  useEffect(() => {
    if (!currentSong || !gainNodes[activeIndex]) return;

    if (replayGainMode !== "disabled") {
      const trackGain = currentSong.replayGainTrackGain ?? 0;
      const totalGain = trackGain + replayGainOffset;
      console.log(
        `[Audio] ReplayGain settings changed: track=${trackGain.toFixed(2)} dB, offset=${replayGainOffset.toFixed(2)} dB, total=${totalGain.toFixed(2)} dB`,
      );
      setReplayGain(totalGain, activeIndex);
    } else {
      console.log("[Audio] ReplayGain disabled, setting gain to unity");
      gainNodes[activeIndex]!.gain.value = 1;
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
  const setBuffered = useSetAtom(bufferedAtom);

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
    const audio = getActiveAudio();
    if (!audio || !currentSong) return;

    const client = getClient();
    if (!client) return;

    // Clear error state
    setPlaybackError(null);
    setPlaybackState("loading");

    // Force reload by clearing cached state
    currentLoadedTrackId = null;
    invalidatePreBuffer();

    // Get fresh stream URL and load
    const streamUrl = client.getStreamUrl(currentSong.id);
    audio.src = streamUrl;
    currentStreamTimeOffset = 0;
    isLoadingNewTrack = true;

    resumeAudioContext().then((contextRunning) => {
      if (!contextRunning) {
        console.error("[Audio] Cannot retry: AudioContext not running");
      }
      audio.play().catch((err) => {
        console.error("[Audio] Retry playback failed:", err);
        setPlaybackState("error");
      });
    });
  };

  const play = async () => {
    setIsRestoring(false);
    const contextRunning = await resumeAudioContext();
    if (!contextRunning) {
      console.error("[Audio] Cannot play: AudioContext not running");
    }
    getActiveAudio()?.play().catch(console.error);
  };

  const pause = () => {
    getActiveAudio()?.pause();
  };

  const togglePlayPause = () => {
    const audio = getActiveAudio();
    if (!audio) return;

    if (playbackState === "playing") {
      pause();
    } else if (playbackState === "loading") {
      pause();
    } else if (playbackState === "ended") {
      if (queueState && queueState.totalCount > 0) {
        currentLoadedTrackId = null;
        setIsRestoring(false);
        playAtIndex(0);
      }
    } else if (playbackState === "error") {
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
    const audio = getActiveAudio();
    if (audio) {
      audio.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Reload stream with time offset for transcoded unbuffered seeks
  const seekWithTimeOffset = (time: number) => {
    const audio = getActiveAudio();
    if (!audio || !currentSong) return;

    const client = getClient();
    if (!client) return;

    const wasPlaying = !audio.paused;

    currentStreamTimeOffset = time;
    setBuffered(time);

    const streamUrl = client.getStreamUrl(currentSong.id, {
      maxBitRate: transcodingEnabled ? transcodingBitrate : undefined,
      format: transcodingEnabled ? "opus" : undefined,
      timeOffset: time,
      seekMode: transcodingSeekMode,
    });

    // Invalidate pre-buffer since we're seeking (current track position changed)
    invalidatePreBuffer();

    audio.src = streamUrl;
    setCurrentTime(time);

    if (wasPlaying) {
      resumeAudioContext().then(() => {
        audio.play().catch(console.error);
      });
    } else {
      audio.load();
    }
  };

  // General seek function that chooses the right strategy
  const seek = (time: number) => {
    const audio = getActiveAudio();
    if (!audio) return;

    const streamRelativeTime = time - currentStreamTimeOffset;

    const isBuffered = (() => {
      const buffered = audio.buffered;
      for (let i = 0; i < buffered.length; i++) {
        if (
          streamRelativeTime >= buffered.start(i) &&
          streamRelativeTime <= buffered.end(i)
        ) {
          return true;
        }
      }
      return false;
    })();

    if (isBuffered || !transcodingEnabled) {
      if (transcodingEnabled && currentStreamTimeOffset > 0) {
        audio.currentTime = streamRelativeTime;
        setCurrentTime(time);
      } else {
        seekNative(time);
      }
    } else {
      seekWithTimeOffset(time);
    }
  };

  const seekPercent = (percent: number) => {
    const audio = getActiveAudio();
    if (!audio) return;

    const duration = currentSong?.duration ?? audio.duration;
    if (!duration || duration <= 0) return;

    const targetTime = (percent / 100) * duration;
    const streamRelativeTime = targetTime - currentStreamTimeOffset;

    const isBuffered = (() => {
      const buffered = audio.buffered;
      for (let i = 0; i < buffered.length; i++) {
        if (
          streamRelativeTime >= buffered.start(i) &&
          streamRelativeTime <= buffered.end(i)
        ) {
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
      // Use stream-relative time for the actual seek operation with transcoding
      if (transcodingEnabled && currentStreamTimeOffset > 0) {
        audio.currentTime = streamRelativeTime;
        setCurrentTime(targetTime);
      } else {
        seekNative(targetTime);
      }
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
    logListeningTimeAndReset(true);
    setIsRestoring(false);
    // Invalidate any pre-buffer since user is explicitly skipping
    invalidatePreBuffer();
    isGaplessHandoff = false;
    gaplessHandoffExpectedTrackId = null;
    goToNextAction();
  };

  const previous = () => {
    setIsRestoring(false);

    const audio = getActiveAudio();
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    logListeningTimeAndReset(true);
    invalidatePreBuffer();
    isGaplessHandoff = false;
    gaplessHandoffExpectedTrackId = null;
    goToPreviousAction();
  };

  // Force go to previous track (used for swipe gestures - always skip, never restart)
  const previousForce = () => {
    // Clear restore flag on explicit user interaction
    setIsRestoring(false);

    // Log listening time before going to previous track
    logListeningTimeAndReset(true);
    isGaplessHandoff = false;
    gaplessHandoffExpectedTrackId = null;
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
