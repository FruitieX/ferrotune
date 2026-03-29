"use client";

import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  useSessionEvents,
  type SessionEvent,
} from "@/lib/hooks/use-session-events";
import { useAudioEngine } from "@/lib/audio/hooks";
import {
  isAudioOwnerAtom,
  isRemoteControllingAtom,
  remotePlaybackStateAtom,
  connectedClientsAtom,
  ownerClientIdAtom,
  ownerClientNameAtom,
  clientIdAtom,
  selfTakeoverPending,
} from "@/lib/store/session";
import {
  fetchQueueAndPlayAtom,
  fetchQueueSilentAtom,
  currentSongAtom,
  nativeAutonomousMode,
} from "@/lib/store/server-queue";
import {
  playbackStateAtom,
  currentTimeAtom,
  durationAtom,
  volumeAtom,
  isMutedAtom,
} from "@/lib/store/player";
import { getClient } from "@/lib/api/client";

/**
 * Receives SSE events for the current session and dispatches
 * playback commands to the local audio engine.
 *
 * When this tab is the audio owner, playback commands are executed locally.
 * When remote controlling, position updates drive the player bar display.
 */
export function SessionEventHandler() {
  const isAudioOwner = useAtomValue(isAudioOwnerAtom);
  const isRemoteControlling = useAtomValue(isRemoteControllingAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const clientId = useAtomValue(clientIdAtom);
  const { play, pause, next, previous, seek } = useAudioEngine();
  const fetchQueueAndPlay = useSetAtom(fetchQueueAndPlayAtom);
  const fetchQueueSilent = useSetAtom(fetchQueueSilentAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);
  const setPlaybackState = useSetAtom(playbackStateAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setVolume = useSetAtom(volumeAtom);
  const setIsMuted = useSetAtom(isMutedAtom);
  const [, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const setConnectedClients = useSetAtom(connectedClientsAtom);
  const setOwnerClientId = useSetAtom(ownerClientIdAtom);
  const setOwnerClientName = useSetAtom(ownerClientNameAtom);

  // Update duration from current song when remote controlling
  useEffect(() => {
    if (isRemoteControlling && currentSong?.duration) {
      setDuration(currentSong.duration);
    }
  }, [isRemoteControlling, currentSong, setDuration]);

  // Position interpolation: tick every 250ms when remote controlling and playing
  const remotePlaybackState = useAtomValue(remotePlaybackStateAtom);
  const remoteIsPlaying = remotePlaybackState?.isPlaying ?? false;

  useEffect(() => {
    if (!isRemoteControlling || !remoteIsPlaying) return;

    const interval = setInterval(() => {
      const remote = remotePlaybackState;
      if (!remote) return;
      const elapsed = Date.now() - remote.positionTimestamp;
      const currentMs = remote.positionMs + elapsed;
      setCurrentTime(currentMs / 1000);
    }, 250);

    return () => clearInterval(interval);
  }, [
    isRemoteControlling,
    remoteIsPlaying,
    remotePlaybackState,
    setCurrentTime,
  ]);

  const handleEvent = (event: SessionEvent) => {
    switch (event.type) {
      case "playbackCommand":
        // Only the audio owner processes playback commands
        if (!isAudioOwner) return;

        // Handle "takeOver" — another client is taking over this session.
        // Skip if we just initiated the takeover ourselves (the broadcast
        // echoes back to us and would incorrectly pause our own playback).
        if (event.action === "takeOver") {
          if (selfTakeoverPending.value) return;
          pause();
          setIsAudioOwner(false);
          return;
        }

        // In native autonomous mode, Kotlin's PlaybackService has its own
        // SSE connection and handles playback commands directly. Skip here
        // to avoid double-processing (e.g. skipping two songs instead of one).
        if (nativeAutonomousMode.value) return;

        switch (event.action) {
          case "play":
            play();
            break;
          case "pause":
            pause();
            break;
          case "next":
            next();
            break;
          case "previous":
            previous();
            break;
          case "seek":
            if (event.positionMs !== undefined) {
              seek(event.positionMs / 1000);
            }
            break;
          case "stop":
            pause();
            break;
          case "setVolume":
            if (event.volume !== undefined) {
              setVolume(event.volume);
            }
            if (event.isMuted !== undefined) {
              setIsMuted(event.isMuted);
            }
            break;
        }
        break;
      case "queueChanged":
        if (isAudioOwner && !isRemoteControlling) {
          // Owner: refetch queue and play the new track
          fetchQueueAndPlay();
        } else {
          // Follower: silently refetch for UI without showing loading spinner
          fetchQueueSilent();
        }
        break;
      case "queueUpdated":
        // Queue metadata changed (shuffle/repeat/add/remove/move)
        // Just refetch without affecting playback state
        fetchQueueSilent();
        break;
      case "positionUpdate": {
        const now = Date.now();
        const posMs = event.positionMs ?? 0;
        const playing = event.isPlaying ?? false;

        // Always update remote playback state (for UI display and interpolation)
        setRemotePlaybackState({
          isPlaying: playing,
          currentIndex: event.currentIndex ?? 0,
          positionMs: posMs,
          positionTimestamp: now,
          currentSongId: event.currentSongId,
          currentSongTitle: event.currentSongTitle,
          currentSongArtist: event.currentSongArtist,
        });

        // When remote controlling (or not the audio owner), drive the
        // player bar atoms from SSE so follower UI stays in sync
        if (isRemoteControlling || !isAudioOwner) {
          setPlaybackState(playing ? "playing" : "paused");
          setCurrentTime(posMs / 1000);
        }
        break;
      }
      case "clientListChanged": {
        // Refresh the client list from the server
        const client = getClient();
        if (client) {
          client
            .listClients()
            .then((response) => setConnectedClients(response.clients))
            .catch(() => {});
        }
        break;
      }
      case "ownerChanged": {
        // Another client has taken ownership
        if (event.ownerClientId) {
          setOwnerClientId(event.ownerClientId);
          setOwnerClientName(event.ownerClientName ?? null);

          if (event.ownerClientId === clientId) {
            // We became the owner. For self-initiated takeovers
            // (selfTakeoverPending), this is the single place that
            // triggers fetchQueueAndPlay — transferToClient defers to
            // here to avoid a double-load race condition.
            const wasSelfTakeover = selfTakeoverPending.value;
            selfTakeoverPending.value = false;

            // Read remotePlaybackState to know if we should auto-play.
            // For self-takeovers the state hasn't been cleared yet so
            // the value is fresh; for external transfers it was set by
            // the SSE positionUpdate handler.
            const wasPlaying = remotePlaybackState?.isPlaying ?? false;
            setIsAudioOwner(true);
            setRemotePlaybackState(null);

            // Start playback seamlessly if the previous owner was playing
            if (wasPlaying || wasSelfTakeover) {
              fetchQueueAndPlay();
            }
          } else if (isAudioOwner) {
            // We were the owner but someone else took over
            pause();
            setIsAudioOwner(false);
          }
        }
        break;
      }
      case "volumeChange":
        // Only non-owners apply volumeChange events (followers sync from this).
        // The audio owner ignores these to prevent echo of its own changes.
        if (!isAudioOwner) {
          if (event.volume !== undefined) {
            setVolume(event.volume);
          }
          if (event.isMuted !== undefined) {
            setIsMuted(event.isMuted);
          }
        }
        break;
    }
  };

  useSessionEvents(handleEvent);

  return null;
}
