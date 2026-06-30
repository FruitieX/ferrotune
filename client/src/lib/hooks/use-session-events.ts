"use client";

import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { getClient, getClientName } from "@/lib/api/client";
import { effectiveSessionIdAtom, clientIdAtom } from "@/lib/store/session";
import { isClientInitializedAtom } from "@/lib/store/auth";

export interface SessionEvent {
  type:
    | "queueChanged"
    | "queueUpdated"
    | "playbackCommand"
    | "positionUpdate"
    | "volumeChange"
    | "clientListChanged"
    | "ownerChanged";
  action?: string;
  clientId?: string;
  positionMs?: number;
  currentIndex?: number;
  isPlaying?: boolean;
  currentSongId?: string;
  currentSongTitle?: string;
  currentSongArtist?: string;
  volume?: number;
  isMuted?: boolean;
  ownerClientId?: string;
  ownerClientName?: string;
  resumePlayback?: boolean;
}

// Backoff schedule for explicit SSE reconnects. EventSource has built-in
// auto-reconnect per the spec, but in practice it is unreliable when a proxy
// keeps the underlying TCP half-open or the browser throttles retries. We
// therefore close the EventSource ourselves on error and recreate it after a
// short backoff, capped at 30s. The schedule is reset to the start any time we
// receive a message (i.e. the connection is healthy).
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/**
 * Hook to maintain an SSE connection for session events.
 * Receives queue changes, playback commands, and position updates
 * from the server for the current session.
 */
export function useSessionEvents(onEvent?: (event: SessionEvent) => void) {
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const sessionId = useAtomValue(effectiveSessionIdAtom);
  const clientId = useAtomValue(clientIdAtom);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffIndexRef = useRef(0);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!isClientInitialized || !sessionId) return;

    const client = getClient();
    if (!client) return;

    let closedByCleanup = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const openConnection = () => {
      if (closedByCleanup) return;

      const url = client.getSessionEventsUrl(
        sessionId,
        clientId,
        getClientName(),
      );

      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        // Any incoming data (incl. real events) means the connection is
        // healthy — reset the backoff so the next failure starts fresh.
        backoffIndexRef.current = 0;
        try {
          const data: SessionEvent = JSON.parse(event.data);
          onEventRef.current?.(data);
        } catch {
          // Ignore parse errors (e.g., heartbeat/keepalive messages)
        }
      };

      eventSource.onerror = () => {
        // The spec says EventSource auto-reconnects, but it is unreliable in
        // the face of half-open sockets / proxy timeouts / background tab
        // throttling. Close it explicitly and reopen after backoff so the tab
        // stays in the server's connected-clients list and keeps receiving
        // remote-control events.
        eventSource.close();
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }

        if (closedByCleanup) return;

        const delay =
          RECONNECT_BACKOFF_MS[
            Math.min(backoffIndexRef.current, RECONNECT_BACKOFF_MS.length - 1)
          ];
        backoffIndexRef.current = Math.min(
          backoffIndexRef.current + 1,
          RECONNECT_BACKOFF_MS.length - 1,
        );

        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(openConnection, delay);
      };
    };

    openConnection();

    return () => {
      closedByCleanup = true;
      clearReconnectTimer();
      const eventSource = eventSourceRef.current;
      if (eventSource) {
        eventSource.close();
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
      }
    };
  }, [isClientInitialized, sessionId, clientId]);
}
