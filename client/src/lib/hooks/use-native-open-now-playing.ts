"use client";

import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { fullscreenPlayerOpenAtom } from "@/lib/store/ui";

export const nativeOpenNowPlayingEvent = "ferrotune:native-open-now-playing";
const nativeOpenNowPlayingFlag = "__FERROTUNE_OPEN_NOW_PLAYING__" as const;

declare global {
  interface Window {
    __FERROTUNE_OPEN_NOW_PLAYING__?: boolean;
  }
}

/** Opens the full-screen player when Android launches the app from its media notification. */
export function useNativeOpenNowPlaying() {
  const setFullscreenPlayerOpen = useSetAtom(fullscreenPlayerOpenAtom);

  useEffect(() => {
    const openNowPlaying = () => {
      setFullscreenPlayerOpen(true);
    };

    window.addEventListener(nativeOpenNowPlayingEvent, openNowPlaying);

    if (window[nativeOpenNowPlayingFlag]) {
      delete window[nativeOpenNowPlayingFlag];
      openNowPlaying();
    }

    return () => {
      window.removeEventListener(nativeOpenNowPlayingEvent, openNowPlaying);
    };
  }, [setFullscreenPlayerOpen]);
}
