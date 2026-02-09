"use client";

import { useEffect, useRef } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {
  castStateAtom,
  castDeviceNameAtom,
  castSdkLoadedAtom,
} from "@/lib/store/cast";
import { currentSongAtom } from "@/lib/store/server-queue";
import { playbackStateAtom, currentTimeAtom } from "@/lib/store/player";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";

/**
 * Build a stream URL with embedded auth for Chromecast to fetch directly.
 */
function buildCastStreamUrl(songId: string): string | null {
  const client = getClient();
  if (!client) return null;
  // Use the existing getStreamUrl which embeds auth in query params
  return client.getStreamUrl(songId);
}

/**
 * Build a cover art URL for Chromecast display.
 */
function buildCastCoverArtUrl(coverArtId: string | undefined): string | null {
  if (!coverArtId) return null;
  const client = getClient();
  if (!client) return null;
  return client.getCoverArtUrl(coverArtId, "large");
}

/**
 * Load a song onto the Chromecast.
 */
function loadMediaOnCast(song: Song, startTime = 0): void {
  const castSession =
    cast.framework.CastContext.getInstance().getCurrentSession();
  if (!castSession) return;

  const streamUrl = buildCastStreamUrl(song.id);
  if (!streamUrl) return;

  const mediaInfo = new chrome.cast.media.MediaInfo(streamUrl, "audio/mpeg");
  mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;

  const metadata = new chrome.cast.media.MusicTrackMediaMetadata();
  metadata.title = song.title;
  metadata.artist = song.artist ?? undefined;
  if (song.album) metadata.albumName = song.album;
  if (song.track) metadata.trackNumber = song.track;
  if (song.discNumber) metadata.discNumber = song.discNumber;

  const coverArtUrl = buildCastCoverArtUrl(
    song.coverArt ?? song.albumId ?? undefined,
  );
  if (coverArtUrl) {
    metadata.images = [new chrome.cast.Image(coverArtUrl)];
  }

  mediaInfo.metadata = metadata;

  if (song.duration) {
    mediaInfo.duration = song.duration;
  }

  const request = new chrome.cast.media.LoadRequest(mediaInfo);
  request.currentTime = startTime;
  request.autoplay = true;

  castSession.loadMedia(request).then(
    () => console.log("[Cast] Media loaded successfully"),
    (errorCode: chrome.cast.ErrorCode) =>
      console.error("[Cast] Error loading media:", errorCode),
  );
}

/**
 * Hook that initializes the Chromecast SDK and manages the Cast lifecycle.
 * Should be called once at the app root level.
 */
export function useCastInit() {
  const setCastState = useSetAtom(castStateAtom);
  const setCastDeviceName = useSetAtom(castDeviceNameAtom);
  const setCastSdkLoaded = useSetAtom(castSdkLoadedAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);

  // Refs to store latest values for event callbacks
  const currentSongRef = useRef(currentSong);
  const currentTimeRef = useRef(currentTime);
  const playbackStateRef = useRef(playbackState);

  useEffect(() => {
    currentSongRef.current = currentSong;
    currentTimeRef.current = currentTime;
    playbackStateRef.current = playbackState;
  });

  useEffect(() => {
    // Set up the callback before the SDK script loads
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (!isAvailable) {
        setCastState("unavailable");
        return;
      }

      setCastSdkLoaded(true);

      // Initialize the Cast context with the default media receiver
      const context = cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });

      // Listen for Cast state changes
      context.addEventListener(
        cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        (event: cast.framework.CastStateEventData) => {
          switch (event.castState) {
            case cast.framework.CastState.NO_DEVICES_AVAILABLE:
              setCastState("unavailable");
              setCastDeviceName(null);
              break;
            case cast.framework.CastState.NOT_CONNECTED:
              setCastState("available");
              setCastDeviceName(null);
              break;
            case cast.framework.CastState.CONNECTING:
              setCastState("connecting");
              break;
            case cast.framework.CastState.CONNECTED: {
              setCastState("connected");
              const session = context.getCurrentSession();
              const device = session?.getCastDevice();
              setCastDeviceName(device?.friendlyName ?? null);

              // When Cast connects, transfer current playback
              const song = currentSongRef.current;
              if (song) {
                loadMediaOnCast(song, currentTimeRef.current);
              }
              break;
            }
          }
        },
      );

      // Set initial state
      const currentState = context.getCastState();
      if (currentState === cast.framework.CastState.NO_DEVICES_AVAILABLE) {
        setCastState("unavailable");
      } else {
        setCastState("available");
      }
    };

    // Load the Cast SDK script
    const script = document.createElement("script");
    script.src =
      "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
    script.async = true;
    document.head.appendChild(script);

    return () => {
      window.__onGCastApiAvailable = () => {};
    };
  }, [setCastState, setCastDeviceName, setCastSdkLoaded]);
}

/**
 * Hook for Cast playback controls.
 */
export function useCast() {
  const castState = useAtomValue(castStateAtom);
  const castDeviceName = useAtomValue(castDeviceNameAtom);
  const isCasting = castState === "connected";
  const isAvailable =
    castState === "available" ||
    castState === "connecting" ||
    castState === "connected";

  const requestCast = () => {
    try {
      cast.framework.CastContext.getInstance().requestSession();
    } catch (error) {
      console.error("[Cast] Failed to request session:", error);
    }
  };

  const stopCasting = () => {
    try {
      const session =
        cast.framework.CastContext.getInstance().getCurrentSession();
      session?.endSession(true);
    } catch (error) {
      console.error("[Cast] Failed to stop session:", error);
    }
  };

  const castCurrentTrack = (song: Song, startTime = 0) => {
    loadMediaOnCast(song, startTime);
  };

  return {
    castState,
    castDeviceName,
    isCasting,
    isAvailable,
    requestCast,
    stopCasting,
    castCurrentTrack,
  };
}
