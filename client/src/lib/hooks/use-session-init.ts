"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { getClient } from "@/lib/api/client";
import {
  currentSessionIdAtom,
  activeSessionsAtom,
  isAudioOwnerAtom,
} from "@/lib/store/session";
import {
  isClientInitializedAtom,
  serverConnectionAtom,
  accountKey,
} from "@/lib/store/auth";
import {
  currentSongAtom,
  serverQueueStateAtom,
} from "@/lib/store/server-queue";
import { playbackStateAtom, currentTimeAtom } from "@/lib/store/player";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Initializes a playback session on mount, sends periodic heartbeats,
 * and refreshes the list of active sessions.
 *
 * Should be called once at the app level (e.g. in AudioEngineProvider).
 */
export function useSessionInit() {
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const serverConnection = useAtomValue(serverConnectionAtom);
  const [sessionId, setSessionId] = useAtom(currentSessionIdAtom);
  const setActiveSessions = useSetAtom(activeSessionsAtom);
  const [isAudioOwner, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const hasInitializedRef = useRef(false);
  const previousAccountKeyRef = useRef<string | null>(null);

  // Use refs for heartbeat data to avoid restarting the interval
  const currentSongRef = useRef(currentSong);
  const queueStateRef = useRef(queueState);
  const playbackStateRef = useRef(playbackState);
  const currentTimeRef = useRef(currentTime);
  const sessionIdRef = useRef(sessionId);
  const isAudioOwnerRef = useRef(isAudioOwner);
  useEffect(() => {
    currentSongRef.current = currentSong;
    queueStateRef.current = queueState;
    playbackStateRef.current = playbackState;
    currentTimeRef.current = currentTime;
    sessionIdRef.current = sessionId;
    isAudioOwnerRef.current = isAudioOwner;
  });

  const refreshSessionsRef = useRef(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const response = await client.listSessions();
      setActiveSessions(response.sessions);
    } catch {
      // Silently ignore
    }
  });

  const sendHeartbeatRef = useRef(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    const client = getClient();
    if (!client) return;

    // When remote-controlling another session, still send heartbeat to keep
    // our own session alive, but don't report the controlled session's track data
    if (!isAudioOwnerRef.current) {
      try {
        await client.sessionHeartbeat(sid, { isPlaying: false });
      } catch {
        // Silently ignore heartbeat failures
      }
      return;
    }

    const song = currentSongRef.current;
    const state = queueStateRef.current;
    const pbState = playbackStateRef.current;
    const currentTimeSec = currentTimeRef.current;

    try {
      await client.sessionHeartbeat(sid, {
        isPlaying: pbState === "playing",
        currentIndex: state?.currentIndex,
        positionMs: Math.round(currentTimeSec * 1000),
        currentSongId: song?.id,
        currentSongTitle: song?.title,
        currentSongArtist: song?.artist,
      });
    } catch {
      // Silently ignore heartbeat failures
    }
  });

  // Initialize session when client becomes ready
  useEffect(() => {
    if (!isClientInitialized || !serverConnection) return;

    const currentKey = accountKey(serverConnection);

    // Reset on account switch
    if (previousAccountKeyRef.current !== currentKey) {
      hasInitializedRef.current = false;
      previousAccountKeyRef.current = currentKey;
    }

    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const initSession = async () => {
      const client = getClient();
      if (!client) return;

      try {
        // Check if we already have a session from sessionStorage (tab refresh)
        if (sessionId) {
          // Validate it still exists on the server
          const response = await client.listSessions();
          setActiveSessions(response.sessions);
          const exists = response.sessions.some((s) => s.id === sessionId);
          if (exists) {
            setIsAudioOwner(true);
            return;
          }
          // Session expired (e.g. server restart) - try to resume the most
          // recent session so we recover the previous queue state
          if (response.sessions.length > 0) {
            const mostRecent = response.sessions[0];
            setSessionId(mostRecent.id);
            setIsAudioOwner(true);
            return;
          }
          // No sessions at all, fall through to create new
        }

        // New tab with no previous session - always create a fresh one
        const created = await client.createSession("ferrotune-web");
        setSessionId(created.id);
        setIsAudioOwner(true);
        // Refresh list so other sessions are visible
        await refreshSessionsRef.current();
      } catch (error) {
        console.error("Failed to initialize playback session:", error);
      }
    };

    initSession();
  }, [
    isClientInitialized,
    serverConnection,
    sessionId,
    setSessionId,
    setActiveSessions,
    setIsAudioOwner,
  ]);

  // Start heartbeat interval when sessionId is set
  useEffect(() => {
    if (!sessionId || !isClientInitialized) {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      return;
    }

    // Send initial heartbeat
    sendHeartbeatRef.current();

    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeatRef.current();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [sessionId, isClientInitialized]);

  // Periodically refresh active sessions list (every 60s)
  useEffect(() => {
    if (!isClientInitialized) return;

    const interval = setInterval(() => refreshSessionsRef.current(), 60_000);
    return () => clearInterval(interval);
  }, [isClientInitialized]);
}
