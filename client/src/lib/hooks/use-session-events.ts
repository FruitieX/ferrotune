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
 * Send a best-effort disconnect beacon so the server removes this tab from the
 * connected-clients list immediately, instead of waiting for the heartbeat
 * grace period to elapse (which leaves a stale entry for ~90s).
 *
 * `sendBeacon` is the right primitive here: it survives the pagehide/unload
 * transition with a 64KiB body cap and does not need a CORS preflight. We fall
 * back to `fetch(..., { keepalive: true })` if `sendBeacon` is unavailable.
 */
function sendDisconnectBeacon(sessionId: string, clientId: string): void {
  if (typeof window === "undefined") return;
  const client = getClient();
  if (!client) return;

  const url = client.getDisconnectClientBeaconUrl(sessionId, clientId);
  const blob = new Blob([""], { type: "application/json" });

  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(url, blob);
      return;
    } catch {
      // Fall through to fetch keepalive below.
    }
  }

  try {
    fetch(url, { method: "DELETE", body: blob, keepalive: true }).catch(
      () => {},
    );
  } catch {
    // Best-effort; nothing to do here.
  }
}

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

  // Track the active (sessionId, clientId) pair so the disconnect beacon
  // fires for the same client that was actually registered with the server,
  // even if the atom values change before unload fires (e.g. account switch).
  const activeSessionRef = useRef<{
    sessionId: string;
    clientId: string;
  } | null>(null);

  useEffect(() => {
    activeSessionRef.current =
      sessionId && clientId ? { sessionId, clientId } : null;
  }, [sessionId, clientId]);

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

    // Send an explicit disconnect beacon when the tab is closing. `pagehide`
    // is the modern, reliable event for this (also fires on mobile background
    // transitions); `beforeunload` is a legacy fallback. The beacon tells the
    // server to remove this client immediately rather than waiting for the
    // 90s heartbeat grace period after the SSE stream drops.
    const handleUnload = () => {
      const active = activeSessionRef.current;
      if (!active) return;
      sendDisconnectBeacon(active.sessionId, active.clientId);
    };

    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);

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
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [isClientInitialized, sessionId, clientId]);
}
