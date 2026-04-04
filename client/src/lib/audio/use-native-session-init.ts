"use client";

/**
 * Native session initialization.
 * Configures server credentials so Kotlin can make direct API calls.
 *
 * Extracted from useAudioEngineInit — Effect 7.
 */

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { serverConnectionAtom } from "@/lib/store/auth";
import { currentSessionIdAtom, clientIdAtom } from "@/lib/store/session";
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
} from "@/lib/audio/engine-state";
import { hasNativeAudio } from "@/lib/tauri";
import type { EngineStateSnapshot } from "./engine-types";

interface NativeSessionInitDeps {
  stateRef: React.RefObject<EngineStateSnapshot>;
}

export function useNativeSessionInit({ stateRef }: NativeSessionInitDeps) {
  const serverConnection = useAtomValue(serverConnectionAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const clientId = useAtomValue(clientIdAtom);
  const isNativePlatform = hasNativeAudio() || usingNativeAudio;

  useEffect(() => {
    if (!isNativePlatform || !serverConnection || !currentSessionId) {
      return;
    }

    let cancelled = false;

    // resetEngineState() clears the readiness gate on account changes, but the
    // one-time audio init effect does not rerun. Recreate the gate here so
    // restored queue loads keep waiting for fresh native credentials.
    if (!nativeSessionReady) {
      createNativeSessionReadyPromise();
    }

    const init = async () => {
      if (nativeAudioReady) {
        await nativeAudioReady;
      }
      if (cancelled) return;

      await nativeInitSession({
        serverUrl: serverConnection.serverUrl,
        username: serverConnection.username ?? "",
        password: serverConnection.password,
        apiKey: serverConnection.apiKey,
        sessionId: currentSessionId,
        clientId: clientId || undefined,
      });
      if (cancelled) return;

      await nativeUpdateSettings({
        replayGainMode: stateRef.current.replayGainMode,
        replayGainOffset: stateRef.current.replayGainOffset,
        scrobbleThreshold: stateRef.current.scrobbleThreshold,
        transcodingEnabled: stateRef.current.transcodingEnabled,
        transcodingBitrate: stateRef.current.transcodingBitrate,
      });
      if (cancelled) return;

      // Signal readiness only after both session config and playback settings
      // have reached Kotlin, so startup preloading uses the correct URLs/gain.
      resolveNativeSessionReadyPromise();
    };

    init().catch((err) => {
      console.error(`[NativeAudio] session init: FAILED: ${String(err)}`);
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
