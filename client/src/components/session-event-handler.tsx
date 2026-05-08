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
  clientIdAtom,
  effectiveSessionIdAtom,
} from "@/lib/store/session";
import {
  fetchQueueAndPlayAtom,
  fetchQueueSilentAtom,
  currentSongAtom,
  playAtIndexAtom,
  serverQueueStateAtom,
} from "@/lib/store/server-queue";
import { hasNativeAudio } from "@/lib/tauri";
import {
  playbackStateAtom,
  currentTimeAtom,
  durationAtom,
  volumeAtom,
  isMutedAtom,
} from "@/lib/store/player";
import { getClient } from "@/lib/api/client";
import { useSessionOwnerState } from "@/lib/hooks/use-session-owner-state";

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
  const clientId = useAtomValue(clientIdAtom);
  const sessionId = useAtomValue(effectiveSessionIdAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const { play, pause, next, previous, seek } = useAudioEngine();
  const fetchQueueAndPlay = useSetAtom(fetchQueueAndPlayAtom);
  const fetchQueueSilent = useSetAtom(fetchQueueSilentAtom);
  const playAtIndex = useSetAtom(playAtIndexAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const setPlaybackState = useSetAtom(playbackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setVolume = useSetAtom(volumeAtom);
  const setIsMuted = useSetAtom(isMutedAtom);
  const [, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const setConnectedClients = useSetAtom(connectedClientsAtom);
  const { applyOwnerSnapshot } = useSessionOwnerState();

  const syncQueueForPosition = (event: SessionEvent) => {
    if (event.currentIndex === undefined) return;

    const needsQueueRefresh =
      !queueState ||
      !currentSong ||
      queueState.currentIndex !== event.currentIndex ||
      (event.currentSongId !== undefined &&
        currentSong.id !== event.currentSongId);

    if (needsQueueRefresh) {
      fetchQueueSilent();
    }
  };

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
          if (event.clientId === clientId) {
            return;
          }
          pause();
          setIsAudioOwner(false);
          return;
        }

        // When native audio is active, Kotlin's PlaybackService has its own
        // SSE connection and handles playback commands directly. Skip here
        // to avoid double-processing (e.g. skipping two songs instead of one).
        if (hasNativeAudio()) return;

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
          case "playAtIndex":
            if (event.currentIndex !== undefined) {
              playAtIndex(event.currentIndex);
            }
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
          if (hasNativeAudio()) {
            // PlaybackService has its own SSE connection and will reload the
            // queue natively. Only refresh the UI here to avoid restarting the
            // same track a second time from JS.
            fetchQueueSilent();
          } else {
            // Owner: refetch queue and play the new track
            fetchQueueAndPlay();
          }
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

        syncQueueForPosition(event);

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

          if (
            isAudioOwner &&
            !isRemoteControlling &&
            !hasNativeAudio() &&
            sessionId &&
            currentSong &&
            queueState
          ) {
            client
              .sessionHeartbeat(sessionId, {
                clientId: clientId || undefined,
                isPlaying: playbackState === "playing",
                currentIndex: queueState.currentIndex,
                positionMs: Math.round(currentTime * 1000),
                currentSongId: currentSong.id,
                currentSongTitle: currentSong.title,
                currentSongArtist: currentSong.artist,
              })
              .catch(() => {});
          }
        }
        break;
      }
      case "ownerChanged": {
        applyOwnerSnapshot({
          ownerClientId: event.ownerClientId,
          ownerClientName: event.ownerClientName,
          resumePlayback: event.resumePlayback,
        });
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
