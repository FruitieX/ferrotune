"use client";

import { useEffect, useRef, useCallback } from "react";
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
import { playbackStateAtom } from "@/lib/store/player";

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
  const setIsAudioOwner = useSetAtom(isAudioOwnerAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const playbackState = useAtomValue(playbackStateAtom);

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const hasInitializedRef = useRef(false);
  const previousAccountKeyRef = useRef<string | null>(null);

  // Use refs for heartbeat data to avoid restarting the interval
  const currentSongRef = useRef(currentSong);
  currentSongRef.current = currentSong;
  const queueStateRef = useRef(queueState);
  queueStateRef.current = queueState;
  const playbackStateRef = useRef(playbackState);
  playbackStateRef.current = playbackState;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const refreshSessions = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const response = await client.listSessions();
      setActiveSessions(response.sessions);
    } catch {
      // Silently ignore
    }
  }, [setActiveSessions]);

  const sendHeartbeat = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    const client = getClient();
    if (!client) return;

    const song = currentSongRef.current;
    const state = queueStateRef.current;
    const pbState = playbackStateRef.current;

    try {
      await client.sessionHeartbeat(sid, {
        isPlaying: pbState === "playing",
        currentIndex: state?.currentIndex,
        positionMs: state?.positionMs,
        currentSongId: song?.id,
        currentSongTitle: song?.title,
        currentSongArtist: song?.artist,
      });
    } catch {
      // Silently ignore heartbeat failures
    }
  }, []);

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
          // Validate it still exists
          const response = await client.listSessions();
          setActiveSessions(response.sessions);
          const exists = response.sessions.some((s) => s.id === sessionId);
          if (exists) {
            setIsAudioOwner(true);
            return;
          }
          // Session expired, fall through to create new
        }

        // Check for existing sessions (e.g. resuming after server restart)
        const response = await client.listSessions();
        setActiveSessions(response.sessions);

        if (response.sessions.length > 0) {
          // Resume the most recent session
          const mostRecent = response.sessions[0];
          setSessionId(mostRecent.id);
          setIsAudioOwner(true);
        } else {
          // Create a new session
          const created = await client.createSession("ferrotune-web");
          setSessionId(created.id);
          setIsAudioOwner(true);
          // Refresh list
          await refreshSessions();
        }
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
    refreshSessions,
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
    sendHeartbeat();

    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [sessionId, isClientInitialized, sendHeartbeat]);

  // Periodically refresh active sessions list (every 60s)
  useEffect(() => {
    if (!isClientInitialized) return;

    const interval = setInterval(refreshSessions, 60_000);
    return () => clearInterval(interval);
  }, [isClientInitialized, refreshSessions]);

  return { refreshSessions };
}
