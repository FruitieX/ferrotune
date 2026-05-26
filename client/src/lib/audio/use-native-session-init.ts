"use client";

/**
 * Native session initialization.
 * Configures server credentials so Kotlin can make direct API calls.
 *
 * Extracted from useAudioEngineInit — Effect 7.
 */

import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { serverConnectionAtom } from "@/lib/store/auth";
import { effectiveSessionIdAtom, clientIdAtom } from "@/lib/store/session";
import {
  nativeInitSession,
  nativeUpdateSettings,
} from "@/lib/audio/native-engine";
import {
  usingNativeAudio,
  nativeAudioReady,
  nativeSessionReady,
  createNativeSessionReadyPromise,
  resolveNativeSessionReadyPromise,
  getPlaybackRuntimeGeneration,
} from "@/lib/audio/engine-state";
import { hasNativeAudio } from "@/lib/tauri";
import type { EngineStateSnapshot } from "./engine-types";

interface NativeSessionInitDeps {
  stateRef: React.RefObject<EngineStateSnapshot>;
}

export function useNativeSessionInit({ stateRef }: NativeSessionInitDeps) {
  const serverConnection = useAtomValue(serverConnectionAtom);
  const currentSessionId = useAtomValue(effectiveSessionIdAtom);
  const clientId = useAtomValue(clientIdAtom);
  const isNativePlatform = hasNativeAudio() || usingNativeAudio;
  const nativeSessionInitKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isNativePlatform || !serverConnection || !currentSessionId) {
      return;
    }

    let cancelled = false;
    const nativeSessionInitKey = [
      serverConnection.serverUrl,
      serverConnection.username ?? "",
      serverConnection.sessionToken ?? "",
      serverConnection.sessionExpiresAt ?? "",
      currentSessionId,
      clientId ?? "",
    ].join("\u0000");

    // Account/session changes need a fresh readiness gate so restored queue
    // loads wait for credentials that match the current native session.
    if (
      !nativeSessionReady ||
      nativeSessionInitKeyRef.current !== nativeSessionInitKey
    ) {
      createNativeSessionReadyPromise();
    }
    nativeSessionInitKeyRef.current = nativeSessionInitKey;

    const runtimeGeneration = getPlaybackRuntimeGeneration();
    const isCurrentInit = () =>
      !cancelled &&
      getPlaybackRuntimeGeneration() === runtimeGeneration &&
      stateRef.current.currentSessionId === currentSessionId &&
      stateRef.current.clientId === clientId;

    const init = async () => {
      if (nativeAudioReady) {
        await nativeAudioReady;
      }
      if (!isCurrentInit()) return;

      await nativeInitSession({
        serverUrl: serverConnection.serverUrl,
        username: serverConnection.username ?? "",
        sessionToken: serverConnection.sessionToken,
        sessionExpiresAt: serverConnection.sessionExpiresAt,
        sessionId: currentSessionId,
        clientId: clientId || undefined,
      });
      if (!isCurrentInit()) return;

      await nativeUpdateSettings({
        replayGainMode: stateRef.current.replayGainMode,
        replayGainOffset: stateRef.current.replayGainOffset,
        scrobbleThreshold: stateRef.current.scrobbleThreshold,
        transcodingEnabled: stateRef.current.transcodingEnabled,
        transcodingBitrate: stateRef.current.transcodingBitrate,
      });
      if (!isCurrentInit()) return;

      // Signal readiness only after both session config and playback settings
      // have reached Kotlin, so startup preloading uses the correct URLs/gain.
      resolveNativeSessionReadyPromise();
    };

    init().catch((err) => {
      console.error(`[NativeAudio] session init: FAILED: ${String(err)}`);
      if (!isCurrentInit()) return;
      // Unblock pending loads so the failure surfaces as a command error
      // instead of hanging forever on an unresolved readiness promise.
      resolveNativeSessionReadyPromise();
    });

    return () => {
      cancelled = true;
    };
  }, [
    serverConnection,
    currentSessionId,
    clientId,
    stateRef,
    isNativePlatform,
  ]);
}
