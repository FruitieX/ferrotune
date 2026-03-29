"use client";

/**
 * Native session initialization for autonomous mode.
 * Configures server credentials so Kotlin can make direct API calls.
 *
 * Extracted from useAudioEngineInit — Effect 7.
 */

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { serverConnectionAtom } from "@/lib/store/auth";
import { currentSessionIdAtom, clientIdAtom } from "@/lib/store/session";
import { nativeAutonomousMode } from "@/lib/store/server-queue";
import {
  nativeInitSession,
  nativeUpdateSettings,
} from "@/lib/audio/native-engine";
import { usingNativeAudio, nativeAudioReady } from "@/lib/audio/engine-state";
import type { EngineStateSnapshot } from "./engine-types";

interface NativeSessionInitDeps {
  stateRef: React.RefObject<EngineStateSnapshot>;
}

export function useNativeSessionInit({ stateRef }: NativeSessionInitDeps) {
  const serverConnection = useAtomValue(serverConnectionAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const clientId = useAtomValue(clientIdAtom);

  useEffect(() => {
    if (!usingNativeAudio || !serverConnection || !currentSessionId) {
      return;
    }

    let cancelled = false;

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
      nativeAutonomousMode.value = true;
    };

    init().catch((err) => {
      console.error(`[NativeAudio] autonomous init: FAILED: ${String(err)}`);
      nativeAutonomousMode.value = false;
    });

    return () => {
      cancelled = true;
    };
  }, [serverConnection, currentSessionId, clientId, stateRef]);
}
