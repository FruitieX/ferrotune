"use client";

import { useEffect, useRef } from "react";
import {
  isAndroidTauriWebView,
  nativeAppResumeEvent,
  requestAppResumeRepaint,
} from "@/lib/utils/app-resume-repaint";

const resumeRepaintDebounceMs = 250;

export function useAppResumeRepaint() {
  const lastResumeSignalAtRef = useRef(0);

  useEffect(() => {
    const handleResumeSignal = (reason: string) => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const now = performance.now();
      if (now - lastResumeSignalAtRef.current < resumeRepaintDebounceMs) {
        return;
      }

      lastResumeSignalAtRef.current = now;
      requestAppResumeRepaint(reason);
    };

    const handleNativeResume = () => {
      handleResumeSignal(nativeAppResumeEvent);
    };

    window.addEventListener(nativeAppResumeEvent, handleNativeResume);

    if (!isAndroidTauriWebView()) {
      return () => {
        window.removeEventListener(nativeAppResumeEvent, handleNativeResume);
      };
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleResumeSignal("visibilitychange");
      }
    };

    const handleWindowFocus = () => {
      handleResumeSignal("focus");
    };

    const handlePageShow = () => {
      handleResumeSignal("pageshow");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener(nativeAppResumeEvent, handleNativeResume);
    };
  }, []);
}
