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
  fetchQueueAndRestoreAtom,
  fetchQueueAndPlayAtom,
  fetchQueueSilentAtom,
  currentSongAtom,
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
  const fetchQueueAndRestore = useSetAtom(fetchQueueAndRestoreAtom);
  const fetchQueueAndPlay = useSetAtom(fetchQueueAndPlayAtom);
  const fetchQueueSilent = useSetAtom(fetchQueueSilentAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);
  const setPlaybackState = useSetAtom(playbackStateAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setVolume = useSetAtom(volumeAtom);
  const setIsMuted = useSetAtom(isMutedAtom);
  const [, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const ownerClientId = useAtomValue(ownerClientIdAtom);
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
          if (selfTakeoverPending.value) {
            selfTakeoverPending.value = false;
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
        // Ownership changed — could be transferred to another client or cleared
        const nextOwnerClientId = event.ownerClientId ?? null;
        const isCurrentClientOwner =
          clientId !== "" && nextOwnerClientId === clientId;
        const isSameOwnerAnnouncement =
          isCurrentClientOwner &&
          (isAudioOwner ||
            ownerClientId === clientId ||
            selfTakeoverPending.value);

        setOwnerClientId(nextOwnerClientId);
        setOwnerClientName(event.ownerClientName ?? null);

        if (nextOwnerClientId) {
          if (isCurrentClientOwner) {
            // The SSE stream sends an initial ownership snapshot every time it
            // reconnects. If it says we are still the owner, do not refetch the
            // queue in restore mode — that reloads the active audio element and
            // pauses playback when switching browser tabs.
            if (isSameOwnerAnnouncement) {
              setIsAudioOwner(true);
              setRemotePlaybackState(null);
              break;
            }

            // We became the owner.
            // Don't clear selfTakeoverPending here — the PlaybackCommand
            // {takeOver} handler needs to read it to prevent the echo
            // (OwnerChanged is broadcast BEFORE PlaybackCommand by the server).
            setIsAudioOwner(true);
            setRemotePlaybackState(null);

            // Only explicit takeover requests are allowed to auto-resume.
            if (event.resumePlayback === true) {
              fetchQueueAndPlay();
            } else {
              fetchQueueAndRestore();
            }
          } else if (isAudioOwner) {
            // We were the owner but someone else took over
            pause();
            setIsAudioOwner(false);
          }
        } else {
          // Ownership cleared by the server (inactivity timeout) — there is
          // no remote owner to follow anymore, so restore the queue locally in
          // a paused state without implicitly starting playback.
          if (isAudioOwner) {
            pause();
            setIsAudioOwner(false);
          }
          setRemotePlaybackState(null);
          fetchQueueAndRestore();
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
