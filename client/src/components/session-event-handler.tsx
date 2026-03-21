"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  useSessionEvents,
  type SessionEvent,
} from "@/lib/hooks/use-session-events";
import { useAudioEngine } from "@/lib/audio/hooks";
import {
  isAudioOwnerAtom,
  effectiveSessionIdAtom,
  activeSessionsAtom,
  remotePlaybackStateAtom,
  isRemoteControllingAtom,
  controllingSessionIdAtom,
} from "@/lib/store/session";
import {
  fetchQueueAtom,
  fetchQueueAndPlayAtom,
  fetchQueueSilentAtom,
  currentSongAtom,
} from "@/lib/store/server-queue";
import {
  playbackStateAtom,
  currentTimeAtom,
  durationAtom,
  volumeAtom,
  isMutedAtom,
} from "@/lib/store/player";

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
  const effectiveSessionId = useAtomValue(effectiveSessionIdAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const { play, pause, next, previous, seek } = useAudioEngine();
  const fetchQueue = useSetAtom(fetchQueueAtom);
  const fetchQueueAndPlay = useSetAtom(fetchQueueAndPlayAtom);
  const fetchQueueSilent = useSetAtom(fetchQueueSilentAtom);
  const setActiveSessions = useSetAtom(activeSessionsAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);
  const setPlaybackState = useSetAtom(playbackStateAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setVolume = useSetAtom(volumeAtom);
  const setIsMuted = useSetAtom(isMutedAtom);
  const [, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const setControllingSessionId = useSetAtom(controllingSessionIdAtom);

  // Refetch queue when effective session changes (e.g. switching sessions)
  const prevSessionIdRef = useRef(effectiveSessionId);
  useEffect(() => {
    if (effectiveSessionId && prevSessionIdRef.current !== effectiveSessionId) {
      fetchQueue();
    }
    prevSessionIdRef.current = effectiveSessionId;
  }, [effectiveSessionId, fetchQueue]);

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

        // Handle "takeOver" — another tab is taking over this session
        if (event.action === "takeOver") {
          pause();
          setIsAudioOwner(false);
          return;
        }

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
        }
        break;
      case "queueChanged":
        if (isAudioOwner) {
          // Owner: refetch queue and play the new track
          fetchQueueAndPlay();
        } else {
          // Follower: just refetch for UI
          fetchQueue();
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

        // When remote controlling, drive the player bar atoms from SSE
        if (isRemoteControlling) {
          setPlaybackState(playing ? "playing" : "paused");
          setCurrentTime(posMs / 1000);
        }

        // Update session list with latest track info
        if (effectiveSessionId) {
          setActiveSessions((sessions) =>
            sessions.map((s) =>
              s.id === effectiveSessionId
                ? {
                    ...s,
                    isPlaying: playing,
                    currentSongId: event.currentSongId ?? s.currentSongId,
                    currentSongTitle:
                      event.currentSongTitle ?? s.currentSongTitle,
                    currentSongArtist:
                      event.currentSongArtist ?? s.currentSongArtist,
                  }
                : s,
            ),
          );
        }
        break;
      }
      case "sessionEnded":
        // If we were remote-controlling this session, switch back to our own
        if (isRemoteControlling) {
          setControllingSessionId(null);
          setIsAudioOwner(true);
          setRemotePlaybackState(null);
        }
        break;
      case "volumeChange":
        // Owner applies volume changes from remote controllers;
        // followers apply volume changes from the owner
        if (isAudioOwner || isRemoteControlling) {
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
