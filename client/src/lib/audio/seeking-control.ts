/**
 * Seeking and position control for audio playback.
 *
 * Extracted from hooks.ts — handles seek dispatching (native/web/transcoded),
 * throttled seeks for transcoded unbuffered content, and position broadcasts.
 */
import { useRef } from "react";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import type { PlaybackState } from "@/lib/store/player";
import {
  getActiveAudio,
  invalidatePreBuffer,
  resumeAudioContext,
} from "./web-audio";

// Module-level mutable state (shared with hooks.ts via getter/setter)
let currentStreamTimeOffset = 0;

export function setCurrentStreamTimeOffset(v: number) {
  currentStreamTimeOffset = v;
}
export function getCurrentStreamTimeOffset() {
  return currentStreamTimeOffset;
}

export interface SeekControlDeps {
  currentSong: Song | null;
  duration: number;
  transcodingEnabled: boolean;
  transcodingBitrate: number;
  transcodingSeekMode: "accurate" | "coarse" | undefined;
  queueState: { currentIndex: number } | null;
  playbackState: PlaybackState;
  currentSessionId: string | null;
  isRemoteControlling: boolean;
  usingNativeAudio: boolean;
  setCurrentTime: (t: number) => void;
  setBuffered: (b: number) => void;
  sendRemoteCommand: (action: string, positionMs?: number) => void;
  nativeSeek: (time: number) => Promise<void>;
}

export function useSeekControl(deps: SeekControlDeps) {
  // Trailing throttle state for unbuffered seeks (only used when transcoding)
  const lastUnbufferedSeekRef = useRef<number>(0);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingSeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Throttle state for seek position broadcasts to followers
  const lastSeekBroadcastRef = useRef<number>(0);
  const pendingSeekBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Native seek for non-transcoded content or buffered positions
  const seekNative = (time: number) => {
    const audio = getActiveAudio();
    if (audio) {
      audio.currentTime = time;
      deps.setCurrentTime(time);
    }
  };

  // Reload stream with time offset for transcoded unbuffered seeks
  const seekWithTimeOffset = (time: number) => {
    const audio = getActiveAudio();
    if (!audio || !deps.currentSong) return;

    const client = getClient();
    if (!client) return;

    const wasPlaying = !audio.paused;

    currentStreamTimeOffset = time;
    deps.setBuffered(time);

    const streamUrl = client.getStreamUrl(deps.currentSong.id, {
      maxBitRate: deps.transcodingEnabled ? deps.transcodingBitrate : undefined,
      format: deps.transcodingEnabled ? "opus" : undefined,
      timeOffset: time,
      seekMode: deps.transcodingSeekMode,
    });

    // Invalidate pre-buffer since we're seeking (current track position changed)
    invalidatePreBuffer();

    audio.src = streamUrl;
    deps.setCurrentTime(time);

    if (wasPlaying) {
      resumeAudioContext().then(() => {
        audio.play().catch(console.error);
      });
    } else {
      audio.load();
    }
  };

  // Broadcast playback state to followers immediately via heartbeat.
  // When native audio is active, Kotlin handles heartbeats directly,
  // so JS skips broadcasting to avoid duplicate position updates.
  const broadcastPlaybackState = (overrides?: {
    positionMs?: number;
    isPlaying?: boolean;
  }) => {
    if (!deps.currentSessionId) return;
    if (deps.usingNativeAudio) return;
    // Don't broadcast if we don't have valid playback state
    // (server would classify as non-owner keepalive and skip broadcast)
    if (!deps.queueState || !deps.currentSong) return;
    const client = getClient();
    if (!client) return;
    // Derive current position from the audio element to avoid subscribing
    // to currentTimeAtom (which would cause excessive re-renders)
    const audio = getActiveAudio();
    const posMs =
      overrides?.positionMs ??
      (audio
        ? Math.round((audio.currentTime + currentStreamTimeOffset) * 1000)
        : 0);
    client
      .sessionHeartbeat(deps.currentSessionId, {
        positionMs: posMs,
        isPlaying: overrides?.isPlaying ?? deps.playbackState === "playing",
        currentIndex: deps.queueState.currentIndex,
        currentSongId: deps.currentSong.id,
        currentSongTitle: deps.currentSong.title,
        currentSongArtist: deps.currentSong.artist,
      })
      .catch((err: unknown) =>
        console.warn("[Session] Failed to broadcast playback state:", err),
      );
  };

  // General seek function that chooses the right strategy
  const seek = (time: number) => {
    if (deps.isRemoteControlling) {
      deps.sendRemoteCommand("seek", Math.round(time * 1000));
      return;
    }

    // Broadcast new position to followers
    broadcastPlaybackState({ positionMs: Math.round(time * 1000) });
    if (deps.usingNativeAudio) {
      deps.nativeSeek(time).catch(console.error);
      deps.setCurrentTime(time);
      return;
    }
    const audio = getActiveAudio();
    if (!audio) return;

    const streamRelativeTime = time - currentStreamTimeOffset;

    const isBuffered = (() => {
      const buffered = audio.buffered;
      for (let i = 0; i < buffered.length; i++) {
        if (
          streamRelativeTime >= buffered.start(i) &&
          streamRelativeTime <= buffered.end(i)
        ) {
          return true;
        }
      }
      return false;
    })();

    if (isBuffered || !deps.transcodingEnabled) {
      if (deps.transcodingEnabled && currentStreamTimeOffset > 0) {
        audio.currentTime = streamRelativeTime;
        deps.setCurrentTime(time);
      } else {
        seekNative(time);
      }
    } else {
      seekWithTimeOffset(time);
    }
  };

  const seekPercent = (percent: number) => {
    // Route to remote session when remote controlling
    if (deps.isRemoteControlling) {
      const songDuration = deps.currentSong?.duration ?? deps.duration;
      if (songDuration > 0) {
        const time = (percent / 100) * songDuration;
        seek(time);
      }
      return;
    }

    if (deps.usingNativeAudio) {
      if (deps.duration > 0) {
        const time = (percent / 100) * deps.duration;
        seek(time);
      }
      return;
    }
    const audio = getActiveAudio();
    if (!audio) return;

    // Use the browser's audio.duration for non-transcoded content since it
    // reflects the actual decoded length which may differ from metadata.
    // For transcoded streams audio.duration is Infinity, so fall back to metadata.
    const audioDuration =
      !deps.transcodingEnabled && audio.duration && isFinite(audio.duration)
        ? audio.duration
        : (deps.currentSong?.duration ?? audio.duration);
    if (!audioDuration || audioDuration <= 0) return;

    const targetTime = (percent / 100) * audioDuration;

    // Broadcast new position to followers (throttled to avoid spamming during drag)
    const seekBroadcastThrottleMs = 250;
    const nowMs = Date.now();
    const posMs = Math.round(targetTime * 1000);
    if (nowMs - lastSeekBroadcastRef.current >= seekBroadcastThrottleMs) {
      lastSeekBroadcastRef.current = nowMs;
      if (pendingSeekBroadcastRef.current) {
        clearTimeout(pendingSeekBroadcastRef.current);
        pendingSeekBroadcastRef.current = null;
      }
      broadcastPlaybackState({ positionMs: posMs });
    } else if (!pendingSeekBroadcastRef.current) {
      // Schedule trailing broadcast so the final position is always sent
      const remaining =
        seekBroadcastThrottleMs - (nowMs - lastSeekBroadcastRef.current);
      pendingSeekBroadcastRef.current = setTimeout(() => {
        lastSeekBroadcastRef.current = Date.now();
        pendingSeekBroadcastRef.current = null;
        broadcastPlaybackState({ positionMs: posMs });
      }, remaining);
    }

    const streamRelativeTime = targetTime - currentStreamTimeOffset;

    const isBuffered = (() => {
      const buffered = audio.buffered;
      for (let i = 0; i < buffered.length; i++) {
        if (
          streamRelativeTime >= buffered.start(i) &&
          streamRelativeTime <= buffered.end(i)
        ) {
          return true;
        }
      }
      return false;
    })();

    if (isBuffered || !deps.transcodingEnabled) {
      // Buffered content or no transcoding: seek immediately
      // Also clear any pending unbuffered seek
      if (pendingSeekTimeoutRef.current) {
        clearTimeout(pendingSeekTimeoutRef.current);
        pendingSeekTimeoutRef.current = null;
      }
      pendingSeekRef.current = null;
      // Use stream-relative time for the actual seek operation with transcoding
      if (deps.transcodingEnabled && currentStreamTimeOffset > 0) {
        audio.currentTime = streamRelativeTime;
        deps.setCurrentTime(targetTime);
      } else {
        seekNative(targetTime);
      }
    } else {
      // Unbuffered transcoded content: use trailing throttle to reduce stream reloads
      const now = Date.now();
      const throttleMs = 150; // Slightly higher for stream reloads
      const timeSinceLastSeek = now - lastUnbufferedSeekRef.current;

      // Always store the latest target
      pendingSeekRef.current = targetTime;

      if (timeSinceLastSeek >= throttleMs) {
        // Throttle window expired - seek immediately
        lastUnbufferedSeekRef.current = now;
        pendingSeekRef.current = null;
        if (pendingSeekTimeoutRef.current) {
          clearTimeout(pendingSeekTimeoutRef.current);
          pendingSeekTimeoutRef.current = null;
        }
        seekWithTimeOffset(targetTime);
      } else if (!pendingSeekTimeoutRef.current) {
        // Schedule trailing seek after throttle window
        const remainingTime = throttleMs - timeSinceLastSeek;
        pendingSeekTimeoutRef.current = setTimeout(() => {
          if (pendingSeekRef.current !== null) {
            lastUnbufferedSeekRef.current = Date.now();
            seekWithTimeOffset(pendingSeekRef.current);
            pendingSeekRef.current = null;
          }
          pendingSeekTimeoutRef.current = null;
        }, remainingTime);
      }
    }
  };

  return { seek, seekPercent, broadcastPlaybackState };
}
