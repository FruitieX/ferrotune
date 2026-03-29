"use client";

/**
 * One-time audio engine initialization: sets up native or web audio
 * and attaches all event listeners.
 *
 * Extracted from useAudioEngineInit — Effect 6.
 */

import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { audioElementAtom } from "@/lib/store/player";
import { nativeAutonomousMode } from "@/lib/store/server-queue";
import { hasNativeAudio } from "@/lib/tauri";
import {
  initNativeAudioEngine,
  cleanupNativeAudioEngine,
} from "@/lib/audio/native-engine";
import { stopListeningUpdateInterval } from "@/lib/audio/listening";
import {
  audioElements,
  initializeWebAudio,
  getGlobalAudio,
} from "@/lib/audio/web-audio";
import {
  setUsingNativeAudio,
  setNativeAudioReady,
  resetEngineState,
} from "@/lib/audio/engine-state";
import { createNativeCallbacks } from "./native-callbacks";
import { createWebAudioHandlers } from "./web-audio-handlers";
import type { EngineStateSnapshot, EngineSetters } from "./engine-types";

interface AudioInitDeps {
  stateRef: React.RefObject<EngineStateSnapshot>;
  settersRef: React.RefObject<EngineSetters>;
  lastStreamUrlRef: React.MutableRefObject<string | null>;
}

export function useAudioInit({
  stateRef,
  settersRef,
  lastStreamUrlRef,
}: AudioInitDeps) {
  const setAudioElement = useSetAtom(audioElementAtom);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Check if we should use native audio (Tauri mobile)
    if (hasNativeAudio()) {
      console.log("[Audio] Using native audio engine (Tauri mobile)");
      setUsingNativeAudio(true);

      const callbacks = createNativeCallbacks({ stateRef, settersRef });

      // Initialize native audio with callbacks.
      // Store the promise so the track-loading effect can await readiness.
      setNativeAudioReady(
        initNativeAudioEngine(callbacks)
          .then(() => {
            console.log(
              "[NativeAudio] initNativeAudioEngine completed successfully",
            );
          })
          .catch((error) => {
            console.error("[Audio] Failed to initialize native audio:", error);
            // Fall back to web audio
            setUsingNativeAudio(false);
            setNativeAudioReady(null);
            const fallbackAudio = getGlobalAudio();
            const fallbackAudio1 = audioElements[1];
            if (fallbackAudio && fallbackAudio1) {
              initializeWebAudio(fallbackAudio, fallbackAudio1);
            }
          }),
      );

      return () => {
        cleanupNativeAudioEngine();
        stopListeningUpdateInterval();
        initializedRef.current = false;
        resetEngineState();
        nativeAutonomousMode.value = false;
      };
    }

    // Web audio initialization
    const audio = getGlobalAudio();
    if (!audio) return;
    setAudioElement(audio);

    const audio1 = audioElements[1];
    if (!audio1) return;

    // Initialize Web Audio API with both elements immediately
    initializeWebAudio(audioElements[0]!, audio1);

    // Create all web audio event handlers
    const { events, clearStallTimer } = createWebAudioHandlers({
      stateRef,
      settersRef,
      lastStreamUrlRef,
    });

    // Attach event listeners to BOTH elements (handlers check isFromActive)
    for (const element of [audioElements[0]!, audio1]) {
      for (const [event, handler] of events) {
        element.addEventListener(event, handler);
      }
    }

    // Cleanup
    return () => {
      clearStallTimer();
      for (const element of [audioElements[0], audioElements[1]]) {
        if (!element) continue;
        for (const [event, handler] of events) {
          element.removeEventListener(event, handler);
        }
      }
      stopListeningUpdateInterval();
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally run once on mount
  }, []);
}
