"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import {
  playbackStateAtom,
  currentTimeAtom,
  durationAtom,
  audioElementAtom,
} from "@/lib/store/player";
import { currentSongAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { useAudioEngine } from "./hooks";

/**
 * Hook for Media Session API integration.
 * Enables OS-level media controls (play/pause, next, previous, seek).
 * Should be called in a component that has access to audio controls.
 */
export function useMediaSession() {
  const currentSong = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const audioElement = useAtomValue(audioElementAtom);
  const { play, pause, next, previous } = useAudioEngine();

  // Update Media Session metadata when track changes
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    if (currentSong) {
      const client = getClient();
      const coverArtUrl =
        currentSong.coverArt && client
          ? client.getCoverArtUrl(currentSong.coverArt, 512)
          : undefined;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: currentSong.artist || "Unknown Artist",
        album: currentSong.album || "Unknown Album",
        artwork: coverArtUrl
          ? [
              { src: coverArtUrl, sizes: "96x96", type: "image/jpeg" },
              { src: coverArtUrl, sizes: "256x256", type: "image/jpeg" },
              { src: coverArtUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } else {
      navigator.mediaSession.metadata = null;
    }
  }, [currentSong]);

  // Update playback state
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    navigator.mediaSession.playbackState =
      playbackState === "playing" ? "playing" : "paused";
  }, [playbackState]);

  // Update position state
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    if (!("setPositionState" in navigator.mediaSession)) {
      return;
    }

    if (duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.min(currentTime, duration),
        });
      } catch {
        // Ignore errors from invalid position state
      }
    }
  }, [currentTime, duration]);

  // Set up action handlers
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const actionHandlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => play()],
      ["pause", () => pause()],
      ["previoustrack", () => previous()],
      ["nexttrack", () => next()],
      [
        "seekbackward",
        (details) => {
          if (audioElement) {
            const skipTime = details.seekOffset || 10;
            audioElement.currentTime = Math.max(
              audioElement.currentTime - skipTime,
              0,
            );
          }
        },
      ],
      [
        "seekforward",
        (details) => {
          if (audioElement) {
            const skipTime = details.seekOffset || 10;
            audioElement.currentTime = Math.min(
              audioElement.currentTime + skipTime,
              duration,
            );
          }
        },
      ],
      [
        "seekto",
        (details) => {
          if (audioElement && details.seekTime != null) {
            audioElement.currentTime = details.seekTime;
          }
        },
      ],
      ["stop", () => pause()],
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Browser doesn't support this action
      }
    }

    // Cleanup
    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Browser doesn't support this action
        }
      }
    };
  }, [play, pause, next, previous, audioElement, duration]);
}
