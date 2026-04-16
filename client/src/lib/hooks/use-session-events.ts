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
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!isClientInitialized || !sessionId) return;

    const client = getClient();
    if (!client) return;

    const url = client.getSessionEventsUrl(
      sessionId,
      clientId,
      getClientName(),
    );

    const open = () => {
      if (eventSourceRef.current) return;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data: SessionEvent = JSON.parse(event.data);
          onEventRef.current?.(data);
        } catch {
          // Ignore parse errors (e.g., heartbeat/keepalive messages)
        }
      };

      eventSource.onerror = () => {
        // Connection lost - will auto-reconnect via EventSource spec
      };
    };

    const close = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    // Keep the SSE connection open only while the document is visible. When
    // hidden, close it to stop waking the radio on every server event — the
    // native Android service maintains its own SSE connection for background
    // remote control, and the JS reopens immediately when the page becomes
    // visible again.
    if (isVisible()) {
      open();
    }

    const handleVisibilityChange = () => {
      if (isVisible()) {
        open();
      } else {
        close();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      close();
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [isClientInitialized, sessionId, clientId]);
}
