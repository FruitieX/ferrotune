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
  nativeSetQueue,
  nativeAppendToQueue,
  nativeUpdateStarredState,
  type NativeAudioCallbacks,
} from "@/lib/audio/native-engine";
import { nativeAutonomousMode } from "@/lib/store/server-queue";
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
  currentLoadedTrackId,
  setCurrentLoadedTrackId,
  nativeQueueOffset,
  setNativeQueueOffset,
  nativeQueueLength,
  setNativeQueueLength,
  setSuppressQueueWindowSync,
  setNativeAutoAdvanced,
} from "@/lib/audio/engine-state";
import type { EngineStateSnapshot, EngineSetters } from "./engine-types";
import { getNativeStreamOptions } from "./engine-types";

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
    // Handle "ended" state: with multi-item queue this only fires when
    // ExoPlayer has exhausted all loaded media items (end of window or
    // true end of queue).
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
      if (qs) {
        const isLastServerTrack = qs.currentIndex >= qs.totalCount - 1;
        if (isLastServerTrack && qs.repeatMode !== "all") {
          // True end of queue with no repeat
          settersRef.current.setCurrentTime(0);
          settersRef.current.setPlaybackState("ended");
          return;
        }
        if (isLastServerTrack && qs.repeatMode === "all") {
          // Repeat-all: wrap around to the beginning
          // Update server position, fetch a fresh window, and re-send queue
          const client = getClient();
          if (client) {
            client
              .updateServerQueuePosition(
                0,
                0,
                qs.isShuffled,
                stateRef.current.currentSessionId ?? undefined,
              )
              .then(() =>
                client.getQueueCurrentWindow(
                  20,
                  "small",
                  stateRef.current.currentSessionId ?? undefined,
                ),
              )
              .then(async (response) => {
                settersRef.current.setServerQueueState((prev) =>
                  prev ? { ...prev, currentIndex: 0, positionMs: 0 } : prev,
                );
                setSuppressQueueWindowSync(true);
                settersRef.current.setQueueWindow(response.window);
                if (response.window.songs.length > 0) {
                  const sorted = [...response.window.songs].sort(
                    (a, b) => a.position - b.position,
                  );
                  const songs = sorted.map((s) => s.song);
                  setNativeQueueOffset(sorted[0].position);
                  setNativeQueueLength(sorted.length);
                  setCurrentLoadedTrackId(songs[0].id);
                  await nativeSetQueue(
                    songs,
                    0,
                    client,
                    nativeQueueOffset,
                    0,
                    getNativeStreamOptions(stateRef.current),
                    true,
                  );
                }
              })
              .catch(console.error);
          }
          return;
        }
        // End of loaded window but more tracks exist in server queue.
        // This is a fallback — normally onTrackChange proactively appends.
        // Re-fetch and re-send the queue.
        settersRef.current.goToNext();
      }
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

    // Handle scrobbling based on actual listened time (not just position).
    // In native autonomous mode, Kotlin handles scrobbling via checkScrobble(),
    // so skip the JS-side scrobble to avoid double-counting.
    if (!nativeAutonomousMode.value) {
      checkAndScrobble(
        stateRef.current,
        duration,
        settersRef.current.setHasScrobbled,
        settersRef.current.invalidatePlayCountQueries,
      );
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

    // Deduplicate: setQueue() and onMediaItemTransition both emit
    // track change events for the same track. Skip if the track hasn't
    // actually changed to prevent double scrobble resets.
    if (track?.id && track.id === currentLoadedTrackId) {
      console.log(
        "[NativeAudio] Skipping duplicate track change for:",
        track.id,
      );
      return;
    }

    // This fires when ExoPlayer auto-advances to the next track in its
    // queue. We need to sync state back to JS without triggering the
    // track-loading effect (which would send the queue again).

    // Log listening time for the track we're leaving
    if (
      currentLoadedTrackId &&
      track?.id &&
      track.id !== currentLoadedTrackId
    ) {
      logListeningTimeAndReset();
    }

    // Update loaded track ID so the track-loading effect skips
    if (track?.id) {
      setCurrentLoadedTrackId(track.id);
      setNativeAutoAdvanced(true);
    }

    // Reset scrobble state for new track
    settersRef.current.setHasScrobbled(false);
    settersRef.current.setCurrentTime(0);

    // Update server queue state (currentIndex) without incrementing
    // trackChangeSignal — this prevents the track-loading effect from
    // re-sending the queue. The currentSongAtom will re-derive from
    // the new currentIndex.
    settersRef.current.setServerQueueState((prev) =>
      prev ? { ...prev, currentIndex: queueIndex, positionMs: 0 } : prev,
    );

    // Find the song in the queue window for duration info
    const window = stateRef.current.queueWindow;
    const entry = window?.songs.find((s) => s.position === queueIndex);
    if (entry?.song) {
      settersRef.current.setDuration(entry.song.duration || 0);
    }

    // Sync position with server asynchronously (fire-and-forget).
    // In autonomous mode, Kotlin's syncPositionToServer() already updates
    // the server position, so skip the duplicate JS call to avoid
    // broadcasting queueUpdated twice. Still fetch the window for UI.
    const client = getClient();
    if (client) {
      const positionSynced = nativeAutonomousMode.value
        ? Promise.resolve()
        : client.updateServerQueuePosition(
            queueIndex,
            0,
            false,
            stateRef.current.currentSessionId ?? undefined,
          );
      positionSynced
        .then(() => {
          // After server sync, re-fetch window centered on new position
          // so the queue UI and WearOS always show ~20 items around current
          return client.getQueueCurrentWindow(
            20,
            "small",
            stateRef.current.currentSessionId ?? undefined,
          );
        })
        .then(async (response) => {
          // Update the queue window atom for UI.
          // Suppress the queue-window-sync effect — we handle appending
          // directly here, no need for a full queue re-send.
          setSuppressQueueWindowSync(true);
          settersRef.current.setQueueWindow(response.window);

          const qs = stateRef.current.queueState;
          if (!qs) return;

          // In autonomous mode, Kotlin handles queue prefetching.
          // JS-side appending would desync the exoIndexToQueueSong mapping
          // and break ReplayGain computation on auto-advanced tracks.
          if (nativeAutonomousMode.value) return;
          const exoIndex = queueIndex - nativeQueueOffset;
          const remainingInExo = nativeQueueLength - exoIndex - 1;

          // Find songs in the new window that are beyond our current
          // ExoPlayer queue and append them
          const currentExoEnd = nativeQueueOffset + nativeQueueLength;
          const newSongs = response.window.songs
            .filter((s) => s.position >= currentExoEnd)
            .sort((a, b) => a.position - b.position);

          if (newSongs.length > 0 && client) {
            console.log(
              "[NativeAudio] Appending",
              newSongs.length,
              "tracks to native queue",
            );
            await nativeAppendToQueue(
              newSongs.map((s) => s.song),
              client,
              getNativeStreamOptions(stateRef.current),
            );
            setNativeQueueLength(nativeQueueLength + newSongs.length);
          }

          console.log(
            "[NativeAudio] Queue status: exoIndex=",
            exoIndex,
            "remaining=",
            remainingInExo,
            "nativeQueueLength=",
            nativeQueueLength,
          );
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

  const onSkipPrevious = () => {
    // Only fires when ExoPlayer has no previous item (edge of loaded window).
    // This requires user interaction (screen on), so JS round-trip is OK.
    console.log(
      "[NativeAudio] Skip previous from notification (at window edge)",
    );
    settersRef.current.goToPrevious();
  };

  const onSkipNext = () => {
    // Only fires when ExoPlayer has no next item (edge of loaded window).
    console.log("[NativeAudio] Skip next from notification (at window edge)");
    settersRef.current.goToNext();
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

  const onShuffleModeChanged = (enabled: boolean) => {
    // Shuffle mode changed from WearOS — sync to app state
    console.log("[NativeAudio] Shuffle mode changed from external:", enabled);
    settersRef.current.setServerQueueState((prev) =>
      prev ? { ...prev, isShuffled: enabled } : prev,
    );
  };

  const onRepeatModeChanged = (mode: string) => {
    // Repeat mode changed from WearOS — sync to app state
    console.log("[NativeAudio] Repeat mode changed from external:", mode);
    const repeatMode = mode as "off" | "one" | "all";
    settersRef.current.setServerQueueState((prev) =>
      prev ? { ...prev, repeatMode } : prev,
    );
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
    onSkipPrevious,
    onSkipNext,
    onToggleStar,
    onShuffleModeChanged,
    onRepeatModeChanged,
    onQueueStateChanged,
    onScrobble,
    onClipping,
  };
}
