"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
  repeatModeAtom,
  hasScrobbledAtom,
  scrobbleThresholdAtom,
  audioElementAtom,
} from "@/lib/store/player";
import {
  currentTrackAtom,
  queueAtom,
  queueIndexAtom,
  isShuffledAtom,
  shuffledIndicesAtom,
  playHistoryAtom,
  isRestoringQueueAtom,
  clearRestoringFlagAtom,
} from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { shuffleArray } from "../utils";

// Singleton audio element - only one instance across the entire app
let globalAudio: HTMLAudioElement | null = null;
// Track by queue index to handle duplicate songs
let currentLoadedQueueIndex: number = -1;
// Track the currently loaded track ID to avoid unnecessary reloads when queue changes
let currentLoadedTrackId: string | null = null;
// Flag to prevent handlePause from overwriting "ended" state
let isEndingQueue: boolean = false;
// Flag to indicate we're intentionally loading a new track (overrides "ended" state check)
let isLoadingNewTrack: boolean = false;

function getGlobalAudio(): HTMLAudioElement {
  if (typeof window === "undefined") {
    throw new Error("Cannot create audio element on server");
  }
  
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";
  }
  return globalAudio;
}

/**
 * Hook to initialize the audio engine. Should be called ONCE in a top-level component.
 * This sets up the audio element and all event listeners.
 */
export function useAudioEngineInit() {
  const [playbackState, setPlaybackState] = useAtom(playbackStateAtom);
  const setPlaybackError = useSetAtom(playbackErrorAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setBuffered = useSetAtom(bufferedAtom);
  const effectiveVolume = useAtomValue(effectiveVolumeAtom);
  const [hasScrobbled, setHasScrobbled] = useAtom(hasScrobbledAtom);
  const scrobbleThreshold = useAtomValue(scrobbleThresholdAtom);
  const setAudioElement = useSetAtom(audioElementAtom);
  
  const currentTrack = useAtomValue(currentTrackAtom);
  const queue = useAtomValue(queueAtom);
  const [queueIndex, setQueueIndex] = useAtom(queueIndexAtom);
  const repeatMode = useAtomValue(repeatModeAtom);
  const isShuffled = useAtomValue(isShuffledAtom);
  const [shuffledIndices, setShuffledIndices] = useAtom(shuffledIndicesAtom);
  const setPlayHistory = useSetAtom(playHistoryAtom);
  const isRestoringQueue = useAtomValue(isRestoringQueueAtom);

  // Track if we've initialized
  const initializedRef = useRef(false);

  // Refs for setters to avoid stale closures
  const settersRef = useRef({
    setPlaybackState,
    setPlaybackError,
    setCurrentTime,
    setDuration,
    setBuffered,
    setHasScrobbled,
    setAudioElement,
    setQueueIndex,
    setShuffledIndices,
    setPlayHistory,
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
      setQueueIndex,
      setShuffledIndices,
      setPlayHistory,
    };
  });

  // Refs to avoid stale closures in event handlers
  const stateRef = useRef({
    playbackState,
    hasScrobbled,
    scrobbleThreshold,
    currentTrack,
    queue,
    queueIndex,
    repeatMode,
    isShuffled,
    shuffledIndices,
    isRestoringQueue,
  });

  // Keep refs in sync
  useEffect(() => {
    stateRef.current = {
      playbackState,
      hasScrobbled,
      scrobbleThreshold,
      currentTrack,
      queue,
      queueIndex,
      repeatMode,
      isShuffled,
      shuffledIndices,
      isRestoringQueue,
    };
  });

  // Initialize audio element and event listeners ONCE
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    
    const audio = getGlobalAudio();
    setAudioElement(audio);

    const handlePlay = () => {
      console.log("[Audio] play event fired");
      settersRef.current.setPlaybackState("playing");
    };
    const handlePause = () => {
      console.log("[Audio] pause event fired");
      // Don't overwrite "ended" state - that's intentional when queue finishes
      if (isEndingQueue) {
        isEndingQueue = false;
        return;
      }
      settersRef.current.setPlaybackState("paused");
    };
    
    const handleEnded = () => {
      // Handle next track
      const state = stateRef.current;
      if (state.queue.length === 0) {
        settersRef.current.setPlaybackState("idle");
        return;
      }

      if (state.currentTrack) {
        settersRef.current.setPlayHistory((prev) => [...prev, state.currentTrack!]);
      }

      if (state.repeatMode === "one") {
        audio.currentTime = 0;
        audio.play().catch(console.error);
        return;
      }

      let nextIndex: number;

      if (state.isShuffled && state.shuffledIndices.length > 0) {
        const currentShuffleIndex = state.shuffledIndices.indexOf(state.queueIndex);
        if (currentShuffleIndex < state.shuffledIndices.length - 1) {
          nextIndex = state.shuffledIndices[currentShuffleIndex + 1];
        } else if (state.repeatMode === "all") {
          const newShuffled = shuffleArray([...Array(state.queue.length).keys()]);
          settersRef.current.setShuffledIndices(newShuffled);
          nextIndex = newShuffled[0];
        } else {
          // End of queue - keep position, just mark as ended
          settersRef.current.setCurrentTime(0);
          settersRef.current.setPlaybackState("ended");
          return;
        }
      } else {
        if (state.queueIndex < state.queue.length - 1) {
          nextIndex = state.queueIndex + 1;
        } else if (state.repeatMode === "all") {
          nextIndex = 0;
        } else {
          // End of queue - keep position, just mark as ended
          settersRef.current.setCurrentTime(0);
          settersRef.current.setPlaybackState("ended");
          return;
        }
      }

      // Force reload if same track (duplicate in queue)
      if (nextIndex === state.queueIndex || 
          (state.queue[nextIndex]?.song.id === state.queue[state.queueIndex]?.song.id)) {
        // Same track or same song ID - force reload
        currentLoadedQueueIndex = -1;
        currentLoadedTrackId = null;
      }

      settersRef.current.setQueueIndex(nextIndex);
    };

    const handleTimeUpdate = () => {
      settersRef.current.setCurrentTime(audio.currentTime);
      
      const state = stateRef.current;
      const duration = audio.duration || 0;
      if (!state.hasScrobbled && duration > 0 && audio.currentTime / duration >= state.scrobbleThreshold) {
        settersRef.current.setHasScrobbled(true);
        if (state.currentTrack) {
          getClient()?.scrobble(state.currentTrack.id).catch(console.error);
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
      // Always try to play when canplay fires - the play() call will trigger handlePlay
      // which sets state to "playing"
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
        trackId: state.currentTrack?.id,
        trackTitle: state.currentTrack?.title,
        timestamp: Date.now(),
      });
      settersRef.current.setPlaybackState("error");
      
      // Show toast notification
      const trackName = state.currentTrack?.title || "Unknown track";
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
      initializedRef.current = false;
    };
  }, []);

  // Update volume
  useEffect(() => {
    if (globalAudio) {
      globalAudio.volume = effectiveVolume;
    }
  }, [effectiveVolume]);

  // Load new track when queue index changes
  useEffect(() => {
    const audio = globalAudio;
    const client = getClient();
    
    // Get current track from queue (don't use atom directly to avoid re-renders)
    const queueItem = queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex] : null;
    const track = queueItem?.song ?? null;
    
    // Skip if same track ID is already loaded at the same index
    // This prevents restarts when items are added to the queue
    if (track && track.id === currentLoadedTrackId && queueIndex === currentLoadedQueueIndex) {
      return;
    }
    
    currentLoadedQueueIndex = queueIndex;
    currentLoadedTrackId = track?.id ?? null;
    
    if (!audio || !track || !client || queueIndex < 0) {
      if (audio && audio.src) {
        audio.pause();
        audio.src = "";
      }
      if (queueIndex < 0) {
        setPlaybackState("idle");
      }
      return;
    }

    // Check if this is a queue restore (don't auto-play on restore)
    const isRestoring = stateRef.current.isRestoringQueue;
    
    const streamUrl = client.getStreamUrl(track.id);
    
    // Stop current playback
    audio.pause();
    audio.src = streamUrl;
    
    if (isRestoring) {
      // During restore: load the track but don't play, set to paused state
      setPlaybackState("paused");
      setHasScrobbled(false);
      setCurrentTime(0);
      setDuration(track.duration || 0);
      // Just load metadata, don't play
      audio.load();
    } else {
      // Normal playback: load and play
      isLoadingNewTrack = true; // Signal to handleCanPlay that we want to play
      setPlaybackState("loading");
      setHasScrobbled(false);
      setCurrentTime(0);
      setDuration(track.duration || 0);

      audio.play().catch((err) => {
        console.error("Failed to play:", err);
        isLoadingNewTrack = false;
        setPlaybackState("paused");
      });
    }
  }, [queueIndex, queue, setPlaybackState, setHasScrobbled, setCurrentTime, setDuration]);
}

/**
 * Hook for playback controls. Can be used in any component.
 * Does NOT set up audio - that's done by useAudioEngineInit.
 */
export function useAudioEngine() {
  const [playbackState, setPlaybackState] = useAtom(playbackStateAtom);
  const setPlaybackError = useSetAtom(playbackErrorAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const clearRestoringFlag = useSetAtom(clearRestoringFlagAtom);
  
  const currentTrack = useAtomValue(currentTrackAtom);
  const [queue, setQueue] = useAtom(queueAtom);
  const [queueIndex, setQueueIndex] = useAtom(queueIndexAtom);
  const repeatMode = useAtomValue(repeatModeAtom);
  const isShuffled = useAtomValue(isShuffledAtom);
  const [shuffledIndices, setShuffledIndices] = useAtom(shuffledIndicesAtom);
  const [playHistory, setPlayHistory] = useAtom(playHistoryAtom);

  // Retry playback by forcing a fresh load of the current track
  const retryPlayback = useCallback(() => {
    if (!globalAudio || !currentTrack) return;
    
    const client = getClient();
    if (!client) return;
    
    // Clear error state
    setPlaybackError(null);
    setPlaybackState("loading");
    
    // Force reload by clearing cached state
    currentLoadedQueueIndex = -1;
    currentLoadedTrackId = null;
    
    // Get fresh stream URL and load
    const streamUrl = client.getStreamUrl(currentTrack.id);
    globalAudio.src = streamUrl;
    isLoadingNewTrack = true;
    
    globalAudio.play().catch((err) => {
      console.error("[Audio] Retry playback failed:", err);
      setPlaybackState("error");
    });
  }, [currentTrack, setPlaybackError, setPlaybackState]);

  const play = useCallback(() => {
    // Clear restore flag on explicit user interaction
    clearRestoringFlag();
    globalAudio?.play().catch(console.error);
  }, [clearRestoringFlag]);

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
      // Queue finished - restart from beginning
      if (queue.length > 0) {
        currentLoadedQueueIndex = -1; // Force reload
        currentLoadedTrackId = null;
        setQueueIndex(0);
      }
    } else if (playbackState === "error") {
      // Retry playback after error
      retryPlayback();
    } else {
      play();
    }
  }, [playbackState, play, pause, queue.length, setQueueIndex, retryPlayback]);

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
    if (queue.length === 0) return;

    // Clear restore flag on explicit user interaction
    clearRestoringFlag();

    if (currentTrack) {
      setPlayHistory((prev) => [...prev, currentTrack]);
    }

    // Note: repeatMode === "one" is NOT checked here - that's intentional!
    // Repeat-one only repeats when track ends naturally (handled in handleEnded).
    // User clicking "next" should always advance to the next track.

    let nextIndex: number;

    if (isShuffled && shuffledIndices.length > 0) {
      const currentShuffleIndex = shuffledIndices.indexOf(queueIndex);
      if (currentShuffleIndex < shuffledIndices.length - 1) {
        nextIndex = shuffledIndices[currentShuffleIndex + 1];
      } else if (repeatMode === "all") {
        const newShuffled = shuffleArray([...Array(queue.length).keys()]);
        setShuffledIndices(newShuffled);
        nextIndex = newShuffled[0];
      } else {
        // End of queue - stop playback and mark as ended
        isEndingQueue = true;
        if (globalAudio) {
          globalAudio.pause();
        }
        setCurrentTime(0);
        setPlaybackState("ended");
        return;
      }
    } else {
      if (queueIndex < queue.length - 1) {
        nextIndex = queueIndex + 1;
      } else if (repeatMode === "all") {
        nextIndex = 0;
      } else {
        // End of queue - stop playback and mark as ended
        isEndingQueue = true;
        if (globalAudio) {
          globalAudio.pause();
        }
        setCurrentTime(0);
        setPlaybackState("ended");
        return;
      }
    }

    // Force reload if same track (duplicate in queue)
    if (queue[nextIndex]?.song.id === queue[queueIndex]?.song.id) {
      currentLoadedQueueIndex = -1;
      currentLoadedTrackId = null;
    }

    setQueueIndex(nextIndex);
  }, [
    queue,
    queueIndex,
    currentTrack,
    repeatMode,
    isShuffled,
    shuffledIndices,
    setQueueIndex,
    setPlayHistory,
    setPlaybackState,
    setShuffledIndices,
    setCurrentTime,
    clearRestoringFlag,
  ]);

  const previous = useCallback(() => {
    // Clear restore flag on explicit user interaction
    clearRestoringFlag();

    if (globalAudio && globalAudio.currentTime > 3) {
      globalAudio.currentTime = 0;
      return;
    }

    if (playHistory.length > 0) {
      const previousTrack = playHistory[playHistory.length - 1];
      setPlayHistory((prev) => prev.slice(0, -1));
      
      const trackIndex = queue.findIndex((t) => t.song.id === previousTrack.id);
      if (trackIndex >= 0) {
        setQueueIndex(trackIndex);
      } else {
        // Track not in queue - add it as a new queue item
        const newQueue = [...queue];
        newQueue.splice(queueIndex, 0, { 
          queueItemId: crypto.randomUUID(), 
          song: previousTrack 
        });
        setQueue(newQueue);
      }
      return;
    }

    if (queueIndex > 0) {
      setQueueIndex(queueIndex - 1);
    } else if (repeatMode === "all" && queue.length > 0) {
      setQueueIndex(queue.length - 1);
    }
  }, [queue, queueIndex, playHistory, repeatMode, setQueueIndex, setQueue, setPlayHistory, clearRestoringFlag]);

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

// Hook for repeat mode cycling
export function useRepeatMode() {
  const [repeatMode, setRepeatMode] = useAtom(repeatModeAtom);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((current) => {
      switch (current) {
        case "off":
          return "all";
        case "all":
          return "one";
        case "one":
          return "off";
      }
    });
  }, [setRepeatMode]);

  return { repeatMode, cycleRepeatMode };
}

// Hook for shuffle
export function useShuffle() {
  const [isShuffled, setIsShuffled] = useAtom(isShuffledAtom);
  const queue = useAtomValue(queueAtom);
  const queueIndex = useAtomValue(queueIndexAtom);
  const setShuffledIndices = useSetAtom(shuffledIndicesAtom);

  const toggleShuffle = useCallback(() => {
    if (!isShuffled) {
      // Turning shuffle on - create shuffled indices starting from current position
      const indices = [...Array(queue.length).keys()];
      const shuffled = shuffleArray(indices.filter((i) => i !== queueIndex));
      setShuffledIndices([queueIndex, ...shuffled]);
      setIsShuffled(true);
    } else {
      // Turning shuffle off
      setShuffledIndices([]);
      setIsShuffled(false);
    }
  }, [isShuffled, queue.length, queueIndex, setIsShuffled, setShuffledIndices]);

  return { isShuffled, toggleShuffle };
}

/**
 * Hook for Media Session API integration.
 * Enables OS-level media controls (play/pause, next, previous, seek).
 * Should be called in a component that has access to audio controls.
 */
export function useMediaSession() {
  const currentTrack = useAtomValue(currentTrackAtom);
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

    if (currentTrack) {
      const client = getClient();
      const coverArtUrl = currentTrack.coverArt && client
        ? client.getCoverArtUrl(currentTrack.coverArt, 512)
        : undefined;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist || "Unknown Artist",
        album: currentTrack.album || "Unknown Album",
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
  }, [currentTrack]);

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
