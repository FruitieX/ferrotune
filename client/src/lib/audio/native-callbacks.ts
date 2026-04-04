/**
 * Factory for native audio engine callbacks (Tauri/ExoPlayer bridge).
 *
 * Extracted from hooks.ts — creates the callback object passed to
 * `initNativeAudioEngine()`. Follows the same factory pattern as
 * `createNetworkErrorHandlers()`.
 */

import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import type { PlaybackState } from "@/lib/store/player";
import {
  nativePlay,
  nativeSeek,
  nativeUpdateStarredState,
  type NativeAudioCallbacks,
} from "@/lib/audio/native-engine";
import {
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
  currentLoadedTrackId,
  setCurrentLoadedTrackId,
} from "@/lib/audio/engine-state";
import type { EngineStateSnapshot, EngineSetters } from "./engine-types";

export interface NativeCallbackDeps {
  stateRef: React.RefObject<EngineStateSnapshot>;
  settersRef: React.RefObject<EngineSetters>;
}

interface NativeTrackInfo {
  id: string;
  title?: string;
  artist?: string;
}

interface NativeQueueState {
  currentIndex: number;
  totalCount: number;
  isShuffled: boolean;
  repeatMode: string;
}

export function createNativeCallbacks({
  stateRef,
  settersRef,
}: NativeCallbackDeps): NativeAudioCallbacks {
  const onStateChange = (state: PlaybackState) => {
    // Handle "ended" state: Kotlin handles repeat-all wrap-around and
    // auto-advance. This only fires when it's truly the end of queue.
    if (state === "ended") {
      logListeningTimeAndReset();
      const qs = stateRef.current.queueState;
      // Repeat-one is handled natively by ExoPlayer REPEAT_MODE_ONE,
      // so we should never reach here. Just in case:
      if (qs?.repeatMode === "one") {
        nativeSeek(0)
          .then(() => nativePlay())
          .catch(console.error);
        return;
      }
      settersRef.current.setCurrentTime(0);
      settersRef.current.setPlaybackState("ended");
      return;
    }

    settersRef.current.setPlaybackState(state);

    // Handle listening time tracking
    const currentSongId = stateRef.current.currentSong?.id;
    if (state === "playing" && currentSongId) {
      if (currentSongId !== playbackStartSongId) {
        setPlaybackStartSongId(currentSongId);
        setAccumulatedPlayTime(0);
        setCurrentListeningSessionId(null);
      }
      setPlaybackStartTime(Date.now());
      startListeningUpdateInterval();
    } else if (state === "paused" && playbackStartTime !== null) {
      stopListeningUpdateInterval();
      setAccumulatedPlayTime(
        accumulatedPlayTime + (Date.now() - playbackStartTime) / 1000,
      );
      setPlaybackStartTime(null);
      updateListeningSession();
    }
  };

  const onProgress = (
    currentTime: number,
    duration: number,
    buffered: number,
  ) => {
    settersRef.current.setCurrentTime(currentTime);
    settersRef.current.setDuration(duration);
    settersRef.current.setBuffered(buffered);

    // Progress events only fire when the player is actually playing.
    // If we're stuck in "loading" due to a missed state change, fix it.
    if (stateRef.current.playbackState === "loading") {
      settersRef.current.setPlaybackState("playing");
    }
  };

  const onError = (message: string, trackId?: string) => {
    console.error("[NativeAudio] Error:", message, trackId);
    settersRef.current.setPlaybackError({
      message,
      trackId,
      trackTitle: stateRef.current.currentSong?.title,
      timestamp: Date.now(),
    });
    settersRef.current.setPlaybackState("error");

    const trackName = stateRef.current.currentSong?.title || "Unknown track";
    toast.error(`Playback failed: ${trackName}`, {
      description: message,
      duration: 5000,
    });
  };

  const onTrackChange = (
    track: NativeTrackInfo | undefined,
    queueIndex: number,
  ) => {
    console.log(
      "[NativeAudio] Track changed to index:",
      queueIndex,
      "track:",
      track?.id,
    );

    // Log listening time for the track we're leaving
    if (
      currentLoadedTrackId &&
      track?.id &&
      track.id !== currentLoadedTrackId
    ) {
      logListeningTimeAndReset();
    }

    // Update loaded track ID
    if (track?.id) {
      setCurrentLoadedTrackId(track.id);
    }

    // Reset scrobble state for new track
    settersRef.current.setHasScrobbled(false);
    settersRef.current.setCurrentTime(0);

    // Update server queue state (currentIndex). Kotlin handles the
    // actual server position update, so JS just updates local state.
    settersRef.current.setServerQueueState((prev) =>
      prev ? { ...prev, currentIndex: queueIndex, positionMs: 0 } : prev,
    );

    // Find the song in the queue window for duration info
    const window = stateRef.current.queueWindow;
    const entry = window?.songs.find((s) => s.position === queueIndex);
    if (entry?.song) {
      settersRef.current.setDuration(entry.song.duration || 0);
    }

    // Fetch updated queue window for UI (Kotlin handles server position sync)
    const client = getClient();
    if (client) {
      client
        .getQueueCurrentWindow(
          20,
          "small",
          stateRef.current.currentSessionId ?? undefined,
        )
        .then((response) => {
          settersRef.current.setQueueWindow(response.window);
        })
        .catch(console.error);
    }

    // Start listening time tracking for new track
    if (track?.id) {
      setPlaybackStartSongId(track.id);
      setAccumulatedPlayTime(0);
      setCurrentListeningSessionId(null);
      setPlaybackStartTime(Date.now());
      startListeningUpdateInterval();

      // Sync star state to WearOS button icon
      const isStarred = stateRef.current.starredItems.get(track.id) ?? false;
      nativeUpdateStarredState(isStarred).catch(console.error);
    }
  };

  const onToggleStar = (trackId: string, isStarred: boolean) => {
    // Toggle star from WearOS overflow menu
    const client = getClient();
    if (!client) return;
    const newStarred = !isStarred;
    // Optimistically update UI
    settersRef.current.setStarredItems((current) => {
      const updated = new Map(current);
      updated.set(trackId, newStarred);
      return updated;
    });
    const action = isStarred
      ? client.unstar({ id: trackId })
      : client.star({ id: trackId });
    action
      .then(() => {
        nativeUpdateStarredState(newStarred).catch(console.error);
      })
      .catch((err) => {
        console.error("[NativeAudio] Failed to toggle star:", err);
        // Revert on failure
        settersRef.current.setStarredItems((current) => {
          const updated = new Map(current);
          updated.set(trackId, isStarred);
          return updated;
        });
        nativeUpdateStarredState(isStarred).catch(console.error);
      });
  };

  const onQueueStateChanged = (queueState: NativeQueueState) => {
    // Autonomous mode: Kotlin syncs queue state back to JS for UI
    console.log("[NativeAudio] Queue state changed (autonomous):", queueState);
    settersRef.current.setServerQueueState((prev) =>
      prev
        ? {
            ...prev,
            currentIndex: queueState.currentIndex,
            totalCount: queueState.totalCount,
            isShuffled: queueState.isShuffled,
            repeatMode: queueState.repeatMode as "off" | "all" | "one",
          }
        : prev,
    );
  };

  const onScrobble = (trackId: string) => {
    // Autonomous mode: Kotlin scrobbled a track, invalidate play count caches
    console.log("[NativeAudio] Scrobble from native:", trackId);
    settersRef.current.invalidatePlayCountQueries();
  };

  const onClipping = (peakOverDb: number) => {
    settersRef.current.setClippingState({
      peakOverDbAt100: peakOverDb,
      lastClipTime: Date.now(),
    });
  };

  return {
    onStateChange,
    onProgress,
    onError,
    onTrackChange,
    onToggleStar,
    onQueueStateChanged,
    onScrobble,
    onClipping,
  };
}
