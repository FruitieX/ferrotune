"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { getClient, getClientName } from "@/lib/api/client";
import {
  currentSessionIdAtom,
  currentSessionAccountKeyAtom,
  effectiveSessionIdAtom,
  isAudioOwnerAtom,
  clientIdAtom,
  connectedClientsAtom,
  ownerClientIdAtom,
  ownerClientNameAtom,
  remotePlaybackStateAtom,
  selfTakeoverPending,
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
import { currentLoadedTrackId } from "@/lib/audio/engine-state";
import { hasNativeAudio } from "@/lib/tauri";

const HEARTBEAT_INTERVAL_MS = 30_000;

function shouldReportQueuePosition(songId: string | undefined): boolean {
  return (
    hasNativeAudio() ||
    currentLoadedTrackId === null ||
    songId === currentLoadedTrackId
  );
}

/**
 * Initializes the single playback session on mount, sends periodic heartbeats,
 * and refreshes the list of connected clients.
 *
 * Should be called once at the app level (e.g. in AudioEngineProvider).
 */
export function useSessionInit() {
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const serverConnection = useAtomValue(serverConnectionAtom);
  const [, setSessionId] = useAtom(currentSessionIdAtom);
  const effectiveSessionId = useAtomValue(effectiveSessionIdAtom);
  const setSessionAccountKey = useSetAtom(currentSessionAccountKeyAtom);
  const [isAudioOwner, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const clientId = useAtomValue(clientIdAtom);
  const setConnectedClients = useSetAtom(connectedClientsAtom);
  const setOwnerClientId = useSetAtom(ownerClientIdAtom);
  const setOwnerClientName = useSetAtom(ownerClientNameAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const hasInitializedRef = useRef(false);
  const previousAccountKeyRef = useRef<string | null | undefined>(undefined);
  const initGenerationRef = useRef(0);
  const accountKeyRef = useRef<string | null>(null);

  // Use refs for heartbeat data to avoid restarting the interval
  const currentSongRef = useRef(currentSong);
  const queueStateRef = useRef(queueState);
  const playbackStateRef = useRef(playbackState);
  const currentTimeRef = useRef(currentTime);
  const sessionIdRef = useRef(effectiveSessionId);
  const isAudioOwnerRef = useRef(isAudioOwner);
  const clientIdRef = useRef(clientId);
  useEffect(() => {
    currentSongRef.current = currentSong;
    queueStateRef.current = queueState;
    playbackStateRef.current = playbackState;
    currentTimeRef.current = currentTime;
    sessionIdRef.current = effectiveSessionId;
    isAudioOwnerRef.current = isAudioOwner;
    clientIdRef.current = clientId;
    accountKeyRef.current = serverConnection
      ? accountKey(serverConnection)
      : null;
  });

  const refreshClientsRef = useRef(async (expectedAccountKey?: string) => {
    if (
      expectedAccountKey !== undefined &&
      accountKeyRef.current !== expectedAccountKey
    ) {
      return;
    }

    const client = getClient();
    if (!client) return;
    try {
      const response = await client.listClients();
      if (
        expectedAccountKey !== undefined &&
        accountKeyRef.current !== expectedAccountKey
      ) {
        return;
      }
      setConnectedClients(response.clients);
    } catch {
      // Silently ignore
    }
  });

  const sendHeartbeatRef = useRef(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    const client = getClient();
    if (!client) return;

    // When not the audio owner, still send heartbeat to keep
    // the session alive, but don't report track data
    if (!isAudioOwnerRef.current) {
      try {
        await client.sessionHeartbeat(sid, {
          clientId: clientIdRef.current || undefined,
          isPlaying: false,
        });
      } catch {
        // Silently ignore heartbeat failures
      }
      return;
    }

    const song = currentSongRef.current;
    const state = queueStateRef.current;
    const pbState = playbackStateRef.current;
    const currentTimeSec = currentTimeRef.current;
    const isPlaying = pbState === "playing";

    if (!shouldReportQueuePosition(song?.id)) {
      try {
        await client.sessionHeartbeat(sid, {
          clientId: clientIdRef.current || undefined,
          isPlaying,
        });
      } catch {
        // Silently ignore heartbeat failures
      }
      return;
    }

    try {
      await client.sessionHeartbeat(sid, {
        clientId: clientIdRef.current || undefined,
        isPlaying,
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
    if (!isClientInitialized || !serverConnection || !clientId) return;

    const currentKey = accountKey(serverConnection);

    if (previousAccountKeyRef.current === undefined) {
      previousAccountKeyRef.current = currentKey;
    } else if (previousAccountKeyRef.current !== currentKey) {
      hasInitializedRef.current = false;
      initGenerationRef.current += 1;
      selfTakeoverPending.value = false;
      previousAccountKeyRef.current = currentKey;
      setSessionAccountKey(null);
      setSessionId(null);
      setConnectedClients([]);
      setOwnerClientId(null);
      setOwnerClientName(null);
      setRemotePlaybackState(null);
    }

    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    const initGeneration = ++initGenerationRef.current;
    const isCurrentInit = () =>
      initGenerationRef.current === initGeneration &&
      accountKeyRef.current === currentKey;

    const initSession = async () => {
      const client = getClient();
      if (!client) return;

      try {
        // Connect to (or create) the user's single session
        const response = await client.connectSession(getClientName(), clientId);
        if (!isCurrentInit()) return;

        setSessionAccountKey(currentKey);
        setSessionId(response.id);
        setOwnerClientId(response.ownerClientId);
        setOwnerClientName(
          response.ownerClientId ? response.ownerClientName : null,
        );

        if (
          !response.ownerClientId &&
          isAudioOwner &&
          effectiveSessionId === response.id &&
          isCurrentInit()
        ) {
          await client.sendSessionCommand(
            response.id,
            "takeOver",
            undefined,
            undefined,
            undefined,
            getClientName(),
            clientId,
            false,
          );
          if (!isCurrentInit()) return;
          setOwnerClientId(clientId);
          setOwnerClientName(getClientName());
        }

        if (!isCurrentInit()) return;

        // Determine ownership: if this client is the owner, or new session
        if (response.isNewSession || response.ownerClientId === clientId) {
          setIsAudioOwner(true);
        } else if (!response.ownerClientId) {
          // No owner (e.g., previous owner was disowned due to inactivity).
          // Treat this as locally controllable instead of follower mode so
          // play/pause doesn't route through remote-control code paths.
          setIsAudioOwner(true);
        } else {
          // Existing session owned by another client — join as follower
          setIsAudioOwner(false);
        }

        // Fetch initial client list
        await refreshClientsRef.current(currentKey);
      } catch (error) {
        if (isCurrentInit()) {
          console.error("Failed to initialize playback session:", error);
        }
      }
    };

    initSession();
  }, [
    isClientInitialized,
    serverConnection,
    clientId,
    effectiveSessionId,
    isAudioOwner,
    setSessionId,
    setSessionAccountKey,
    setConnectedClients,
    setIsAudioOwner,
    setOwnerClientId,
    setOwnerClientName,
    setRemotePlaybackState,
  ]);

  // Start heartbeat interval when sessionId is set.
  //
  // When the document is hidden AND playback is not active, we pause the
  // interval entirely to avoid waking the radio every 30 s in the background
  // (this was a significant battery drain on the Android app). When the doc
  // becomes visible again, or playback starts, we immediately send a heartbeat
  // and resume the interval.
  useEffect(() => {
    if (!effectiveSessionId || !isClientInitialized) {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      return;
    }

    const shouldRunHeartbeats = () => {
      if (typeof document === "undefined") return true;
      if (document.visibilityState === "visible") return true;
      return playbackStateRef.current === "playing";
    };

    const startInterval = () => {
      if (heartbeatIntervalRef.current) return;
      // Send immediate heartbeat so the server sees the updated state.
      sendHeartbeatRef.current();
      heartbeatIntervalRef.current = setInterval(() => {
        sendHeartbeatRef.current();
      }, HEARTBEAT_INTERVAL_MS);
    };

    const stopInterval = () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };

    if (shouldRunHeartbeats()) {
      startInterval();
    }

    const handleVisibilityChange = () => {
      if (shouldRunHeartbeats()) {
        startInterval();
      } else {
        stopInterval();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      stopInterval();
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [effectiveSessionId, isClientInitialized, playbackState]);

  // Periodically refresh connected clients list (every 60s).
  // Skip entirely while the document is hidden; refresh on the next
  // visibilitychange back to visible.
  useEffect(() => {
    if (!isClientInitialized || !serverConnection) return;
    const currentKey = accountKey(serverConnection);

    let interval: ReturnType<typeof setInterval> | null = null;

    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const start = () => {
      if (interval) return;
      interval = setInterval(
        () => refreshClientsRef.current(currentKey),
        60_000,
      );
    };

    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    if (isVisible()) start();

    const handleVisibilityChange = () => {
      if (isVisible()) {
        refreshClientsRef.current(currentKey);
        start();
      } else {
        stop();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [isClientInitialized, serverConnection]);

  // Client deregistration on tab close is handled automatically by the SSE
  // connection's CleanupGuard on the server side (fires when EventSource closes).
}
