"use client";

import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { getClient } from "@/lib/api/client";
import { effectiveSessionIdAtom } from "@/lib/store/session";
import { isClientInitializedAtom } from "@/lib/store/auth";

export interface SessionEvent {
  type:
    | "queueChanged"
    | "queueUpdated"
    | "playbackCommand"
    | "positionUpdate"
    | "sessionEnded"
    | "volumeChange";
  action?: string;
  positionMs?: number;
  currentIndex?: number;
  isPlaying?: boolean;
  currentSongId?: string;
  currentSongTitle?: string;
  currentSongArtist?: string;
  volume?: number;
  isMuted?: boolean;
}

/**
 * Hook to maintain an SSE connection for session events.
 * Receives queue changes, playback commands, and position updates
 * from the server for the current session.
 */
export function useSessionEvents(onEvent?: (event: SessionEvent) => void) {
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const sessionId = useAtomValue(effectiveSessionIdAtom);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!isClientInitialized || !sessionId) return;

    const client = getClient();
    if (!client) return;

    const url = client.getSessionEventsUrl(sessionId);
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

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [isClientInitialized, sessionId]);
}
