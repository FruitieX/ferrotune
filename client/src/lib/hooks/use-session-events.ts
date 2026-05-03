"use client";

import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { getClient, getClientName } from "@/lib/api/client";
import {
  effectiveSessionIdAtom,
  clientIdAtom,
  isAudioOwnerAtom,
} from "@/lib/store/session";
import { isClientInitializedAtom } from "@/lib/store/auth";
import { playbackStateAtom } from "@/lib/store/player";
import { usingNativeAudio } from "@/lib/audio/engine-state";
import { hasNativeAudio } from "@/lib/tauri";

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
  const isAudioOwner = useAtomValue(isAudioOwnerAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  const isAudioOwnerRef = useRef(isAudioOwner);
  const playbackStateRef = useRef(playbackState);
  const reevaluateConnectionRef = useRef(() => {});
  useEffect(() => {
    onEventRef.current = onEvent;
    isAudioOwnerRef.current = isAudioOwner;
    playbackStateRef.current = playbackState;
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

    const shouldKeepOpen = () => {
      const isNativePlatform = hasNativeAudio() || usingNativeAudio;
      const hasActiveWebOwnerPlayback =
        !isNativePlatform &&
        isAudioOwnerRef.current &&
        (playbackStateRef.current === "playing" ||
          playbackStateRef.current === "loading");

      return isVisible() || hasActiveWebOwnerPlayback;
    };

    const reevaluateConnection = () => {
      if (shouldKeepOpen()) {
        open();
      } else {
        close();
      }
    };

    reevaluateConnectionRef.current = reevaluateConnection;

    // Keep the SSE connection open while visible. For browser audio owners,
    // also keep it open while hidden playback is active so transfer/takeover
    // commands are received immediately. Native Android keeps its own service
    // SSE in the background, so the WebView can still close its hidden stream.
    reevaluateConnection();

    const handleVisibilityChange = () => {
      reevaluateConnection();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      close();
      reevaluateConnectionRef.current = () => {};
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [isClientInitialized, sessionId, clientId]);

  useEffect(() => {
    reevaluateConnectionRef.current();
  }, [isAudioOwner, playbackState]);
}
