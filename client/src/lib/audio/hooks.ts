"use client";

import { useEffect, useRef, useCallback } from "react";
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
  type RepeatMode,
} from "@/lib/store/server-queue";
import { serverConnectionAtom, isHydratedAtom } from "@/lib/store/auth";
import { getClient } from "@/lib/api/client";

// Singleton audio element - only one instance across the entire app
let globalAudio: HTMLAudioElement | null = null;

// Track the currently loaded track ID to avoid unnecessary reloads when queue changes
let currentLoadedTrackId: string | null = null;
// Flag to prevent handlePause from overwriting "ended" state
let isEndingQueue: boolean = false;
// Flag to indicate we're intentionally loading a new track (overrides "ended" state check)
let isLoadingNewTrack: boolean = false;
// Track when playback started for listening time logging
let playbackStartTime: number | null = null;
let playbackStartSongId: string | null = null;
let accumulatedPlayTime: number = 0; // Accumulated time for pauses
// Session-based listening tracking
let currentListeningSessionId: number | null = null;
let listeningUpdateInterval: ReturnType<typeof setInterval> | null = null;

const LISTENING_UPDATE_INTERVAL_MS = 60000; // Update every 60 seconds

/**
 * Gets or creates the singleton audio element for playback.
 * 
 * Uses `preload="auto"` which instructs the browser to buffer the entire track
 * if possible. This helps with battery life on mobile devices since the modem
 * can go to sleep after downloading is complete. The actual buffering behavior
 * is browser-dependent and may be throttled based on network conditions and
 * available memory.
 */
export function getGlobalAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") {
    return null;
  }
  
  if (!globalAudio) {
    globalAudio = new Audio();
    // Buffer the entire track if possible - helps with battery life on mobile
    // as the modem can sleep when there's no network activity
    globalAudio.preload = "auto";
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
        currentListeningSessionId ?? undefined
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
          currentListeningSessionId ?? undefined
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

  // Callback to invalidate queries that contain play count data
  const invalidatePlayCountQueries = useCallback(() => {
    // Invalidate all queries that display play counts
    queryClient.invalidateQueries({ queryKey: ["songs"] });
    queryClient.invalidateQueries({ queryKey: ["starred-search"] });
    queryClient.invalidateQueries({ queryKey: ["play-history"] });
    queryClient.invalidateQueries({ queryKey: ["album"] });
    queryClient.invalidateQueries({ queryKey: ["artist"] });
    queryClient.invalidateQueries({ queryKey: ["playlist"] });
  }, [queryClient]);

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
        audio.play().catch(console.error);
        return;
      }
      
      // Check if we're at the end of the queue
      if (state.queueState) {
        const isLastTrack = state.queueState.currentIndex >= state.queueState.totalCount - 1;
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
      settersRef.current.setCurrentTime(audio.currentTime);
      
      const state = stateRef.current;
      const duration = audio.duration || 0;
      if (!state.hasScrobbled && duration > 0 && audio.currentTime / duration >= state.scrobbleThreshold) {
        settersRef.current.setHasScrobbled(true);
        if (state.currentSong) {
          getClient()?.scrobble(state.currentSong.id)
            .then(() => {
              // Invalidate queries that display play counts so they update in real-time
              settersRef.current.invalidatePlayCountQueries();
            })
            .catch(console.error);
        }
      }
    };

    const handleDurationChange = () => settersRef.current.setDuration(audio.duration || 0);
    
    const handleProgress = () => {
      if (audio.buffered.length > 0) {
        settersRef.current.setBuffered(audio.buffered.end(audio.buffered.length - 1));
      }
    };

    const handleLoadStart = () => {
      console.log("[Audio] loadstart event");
      // Don't set loading state during restore - we want to stay paused
      if (!stateRef.current.isRestoringQueue) {
        settersRef.current.setPlaybackState("loading");
      }
    };
    
    const handleCanPlay = () => {
      console.log("[Audio] canplay event");
      const state = stateRef.current;
      
      // Don't auto-play if we're restoring queue from server
      if (state.isRestoringQueue) {
        console.log("[Audio] Skipping auto-play because queue is being restored");
        isLoadingNewTrack = false;
        // Set state to paused so the play button shows correctly
        settersRef.current.setPlaybackState("paused");
        return;
      }
      
      // Don't auto-play if queue has ended (unless we're loading a new track)
      if (state.playbackState === "ended" && !isLoadingNewTrack) {
        console.log("[Audio] Skipping auto-play because queue has ended");
        return;
      }
      isLoadingNewTrack = false;
      // Always try to play when canplay fires
      audio.play().catch((err) => {
        console.error("[Audio] Failed to play on canplay:", err);
      });
    };

    const handleWaiting = () => {
      console.log("[Audio] waiting event (buffering)");
      settersRef.current.setPlaybackState("loading");
    };

    const handlePlaying = () => {
      console.log("[Audio] playing event");
      // Clear any previous error when playback successfully starts
      settersRef.current.setPlaybackError(null);
      settersRef.current.setPlaybackState("playing");
    };

    const handleError = (e: Event) => {
      const audioElement = e.target as HTMLAudioElement;
      const mediaError = audioElement?.error;
      const state = stateRef.current;
      
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
  }, []);

  // Update volume
  useEffect(() => {
    if (globalAudio) {
      globalAudio.volume = effectiveVolume;
    }
  }, [effectiveVolume]);

  // Load new track when current song changes (triggered by trackChangeSignal or currentSong)
  useEffect(() => {
    const audio = globalAudio;
    const client = getClient();
    
    if (!audio || !currentSong || !client) {
      if (audio && audio.src && !currentSong) {
        audio.pause();
        audio.src = "";
        setPlaybackState("idle");
      }
      return;
    }
    
    // Skip if same track is already loaded
    if (currentSong.id === currentLoadedTrackId) {
      return;
    }
    
    // Log listening time for the track we're leaving
    if (currentLoadedTrackId && currentSong.id !== currentLoadedTrackId) {
      logListeningTimeAndReset();
    }
    
    currentLoadedTrackId = currentSong.id;
    
    const streamUrl = client.getStreamUrl(currentSong.id);
    
    // Stop current playback
    audio.pause();
    audio.src = streamUrl;
    
    if (isRestoringQueue) {
      // During restore: load the track but don't play, set to paused state
      setPlaybackState("paused");
      setHasScrobbled(false);
      setCurrentTime(0);
      setDuration(currentSong.duration || 0);
      // Just load metadata, don't play
      audio.load();
    } else {
      // Normal playback: load and play
      isLoadingNewTrack = true;
      setPlaybackState("loading");
      setHasScrobbled(false);
      setCurrentTime(0);
      setDuration(currentSong.duration || 0);

      audio.play().catch((err) => {
        console.error("Failed to play:", err);
        isLoadingNewTrack = false;
        setPlaybackState("paused");
      });
    }
  }, [currentSong, trackChangeSignal, isRestoringQueue, setPlaybackState, setHasScrobbled, setCurrentTime, setDuration]);
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
  const setIsRestoring = useSetAtom(isRestoringQueueAtom);

  // Retry playback by forcing a fresh load of the current track
  const retryPlayback = useCallback(() => {
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
    isLoadingNewTrack = true;
    
    globalAudio.play().catch((err) => {
      console.error("[Audio] Retry playback failed:", err);
      setPlaybackState("error");
    });
  }, [currentSong, setPlaybackError, setPlaybackState]);

  const play = useCallback(() => {
    // Clear restore flag on explicit user interaction
    setIsRestoring(false);
    globalAudio?.play().catch(console.error);
  }, [setIsRestoring]);

  const pause = useCallback(() => {
    globalAudio?.pause();
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!globalAudio) return;
    
    if (playbackState === "playing") {
      pause();
    } else if (playbackState === "loading") {
      // If loading, pause to cancel the pending play
      pause();
    } else if (playbackState === "ended") {
      // Queue finished - the server will handle replay logic
      if (queueState && queueState.totalCount > 0) {
        currentLoadedTrackId = null; // Force reload
        // Restart from beginning - trigger via setting restoring false and going to index 0
        setIsRestoring(false);
        play();
      }
    } else if (playbackState === "error") {
      // Retry playback after error
      retryPlayback();
    } else {
      play();
    }
  }, [playbackState, play, pause, queueState, retryPlayback, setIsRestoring]);

  const seek = useCallback((time: number) => {
    if (globalAudio) {
      globalAudio.currentTime = time;
      setCurrentTime(time);
    }
  }, [setCurrentTime]);

  const seekPercent = useCallback((percent: number) => {
    if (globalAudio && globalAudio.duration) {
      const time = (percent / 100) * globalAudio.duration;
      seek(time);
    }
  }, [seek]);

  const next = useCallback(() => {
    // Log listening time before skipping
    logListeningTimeAndReset();
    // Clear restore flag on explicit user interaction
    setIsRestoring(false);
    goToNextAction();
  }, [goToNextAction, setIsRestoring]);

  const previous = useCallback(() => {
    // Clear restore flag on explicit user interaction
    setIsRestoring(false);
    
    if (globalAudio && globalAudio.currentTime > 3) {
      globalAudio.currentTime = 0;
      return;
    }
    
    // Log listening time before going to previous track
    logListeningTimeAndReset();
    goToPreviousAction();
  }, [goToPreviousAction, setIsRestoring]);

  return {
    play,
    pause,
    togglePlayPause,
    seek,
    seekPercent,
    next,
    previous,
    retryPlayback,
    playbackState,
  };
}

// Hook for volume control
export function useVolumeControl() {
  const [volume, setVolume] = useAtom(volumeAtom);
  const [isMuted, setIsMuted] = useAtom(isMutedAtom);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, [setIsMuted]);

  const changeVolume = useCallback(
    (newVolume: number) => {
      setVolume(Math.max(0, Math.min(1, newVolume)));
      if (newVolume > 0 && isMuted) {
        setIsMuted(false);
      }
    },
    [setVolume, isMuted, setIsMuted]
  );

  return { volume, isMuted, toggleMute, changeVolume };
}

// Hook for repeat mode cycling (using server-side state)
export function useRepeatMode() {
  const queueState = useAtomValue(serverQueueStateAtom);
  const setRepeatModeAction = useSetAtom(setRepeatModeAtom);

  const repeatMode = queueState?.repeatMode ?? "off";

  const cycleRepeatMode = useCallback(() => {
    const nextMode: Record<RepeatMode, RepeatMode> = {
      off: "all",
      all: "one",
      one: "off",
    };
    setRepeatModeAction(nextMode[repeatMode]);
  }, [repeatMode, setRepeatModeAction]);

  return { repeatMode, cycleRepeatMode };
}

// Hook for shuffle (using server-side state)
export function useShuffle() {
  const queueState = useAtomValue(serverQueueStateAtom);
  const toggleShuffleAction = useSetAtom(toggleShuffleAtom);

  const isShuffled = queueState?.isShuffled ?? false;

  const toggleShuffle = useCallback(() => {
    toggleShuffleAction();
  }, [toggleShuffleAction]);

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
      const coverArtUrl = currentSong.coverArt && client
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

    navigator.mediaSession.playbackState = playbackState === "playing" ? "playing" : "paused";
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
      ["seekbackward", (details) => {
        if (audioElement) {
          const skipTime = details.seekOffset || 10;
          audioElement.currentTime = Math.max(audioElement.currentTime - skipTime, 0);
        }
      }],
      ["seekforward", (details) => {
        if (audioElement) {
          const skipTime = details.seekOffset || 10;
          audioElement.currentTime = Math.min(audioElement.currentTime + skipTime, duration);
        }
      }],
      ["seekto", (details) => {
        if (audioElement && details.seekTime != null) {
          audioElement.currentTime = details.seekTime;
        }
      }],
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
