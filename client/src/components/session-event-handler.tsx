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
  currentSessionIdAtom,
  pendingTakeoverPlayAtom,
} from "@/lib/store/session";
import {
  fetchQueueAtom,
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
import { getClient, getClientName } from "@/lib/api/client";

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
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const [pendingTakeoverPlay, setPendingTakeoverPlay] = useAtom(
    pendingTakeoverPlayAtom,
  );

  // Refetch queue when effective session changes (e.g. switching sessions).
  // Skip the initial mount — useAudioEngineInit already handles the first fetch.
  const prevSessionIdRef = useRef(effectiveSessionId);
  const isInitialMountRef = useRef(true);
  useEffect(() => {
    if (effectiveSessionId && prevSessionIdRef.current !== effectiveSessionId) {
      if (isInitialMountRef.current) {
        isInitialMountRef.current = false;
      } else if (pendingTakeoverPlay) {
        setPendingTakeoverPlay(false);
        fetchQueueAndPlay();
      } else {
        fetchQueue();
      }
    }
    prevSessionIdRef.current = effectiveSessionId;
  }, [
    effectiveSessionId,
    fetchQueue,
    fetchQueueAndPlay,
    pendingTakeoverPlay,
    setPendingTakeoverPlay,
  ]);

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
            // Remote controller is setting the owner's volume
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

        // When remote controlling (or not the audio owner), drive the
        // player bar atoms from SSE so follower UI stays in sync
        if (isRemoteControlling || !isAudioOwner) {
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
      case "sessionEnded": {
        // The session we were using was cleaned up or deleted.
        // Recover by finding another session to join or creating a new one.
        setControllingSessionId(null);
        setRemotePlaybackState(null);

        const recoverSession = async () => {
          const client = getClient();
          if (!client) return;
          try {
            const response = await client.listSessions();
            setActiveSessions(response.sessions);
            // Filter out the ended session
            const otherSessions = response.sessions.filter(
              (s) => s.id !== effectiveSessionId,
            );
            if (otherSessions.length > 0) {
              // Join another active session as a follower
              const playing = otherSessions.find((s) => s.isPlaying);
              const target = playing ?? otherSessions[0];
              setCurrentSessionId(target.id);
              setIsAudioOwner(false);
            } else {
              // No other sessions — create a new one as owner
              const created = await client.createSession(getClientName());
              setCurrentSessionId(created.id);
              setIsAudioOwner(true);
              const refreshed = await client.listSessions();
              setActiveSessions(refreshed.sessions);
            }
          } catch {
            // Failed to recover — will retry on next heartbeat or SSE reconnect
          }
        };
        recoverSession();
        break;
      }
      case "volumeChange":
        // Only non-owners apply volumeChange events (followers sync from this).
        // The audio owner ignores these to prevent echo of its own changes.
        // Remote controllers reach the owner via playbackCommand("setVolume").
        if (!isAudioOwner) {
          if (event.volume !== undefined) {
            setVolume(event.volume);
          }
          if (event.isMuted !== undefined) {
            setIsMuted(event.isMuted);
          }
        }
        break;
      case "sessionListChanged": {
        // Another session was created or deleted — refresh the list
        const client = getClient();
        if (client) {
          client
            .listSessions()
            .then((response) => setActiveSessions(response.sessions))
            .catch(() => {});
        }
        break;
      }
    }
  };

  useSessionEvents(handleEvent);

  return null;
}
