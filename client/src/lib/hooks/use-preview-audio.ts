/**
 * Preview Audio Hook
 *
 * A standalone audio preview system that doesn't interfere with the main playback.
 * Creates its own audio element and manages preview state independently.
 */

import { useState, useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { getClient } from "@/lib/api/client";
import {
  audioElementAtom,
  playbackStateAtom,
  effectiveVolumeAtom,
} from "@/lib/store/player";

interface UsePreviewAudioReturn {
  // State
  isPlaying: boolean;
  progress: number; // 0-100
  isLoading: boolean;
  volume: number; // 0-100

  // Actions
  play: (songId: string, startPosition?: number) => void;
  playUrl: (url: string, id: string, startPosition?: number) => void;
  pause: () => void;
  toggle: () => void;
  seek: (position: number) => void; // 0-100
  setVolume: (volume: number) => void; // 0-100
  stop: () => void;
}

export function usePreviewAudio(): UsePreviewAudioReturn {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentSongIdRef = useRef<string | null>(null);

  // Access main player to pause it when starting preview
  const mainAudioElement = useAtomValue(audioElementAtom);
  const mainPlaybackState = useAtomValue(playbackStateAtom);
  const mainVolume = useAtomValue(effectiveVolumeAtom);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  // Initialize volume from main player (mainVolume is 0-1, we store as 0-100)
  const [volume, setVolumeState] = useState(() => Math.round(mainVolume * 100));

  // Sync initial volume to audio element when it's created
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = mainVolume;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only sync on mount
  }, []);

  // Create audio element on mount
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    // Set initial volume from main player
    audio.volume = mainVolume;
    audioRef.current = audio;

    // Event listeners
    const handleTimeUpdate = () => {
      if (audio.duration > 0) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };
    const handleCanPlay = () => setIsLoading(false);
    const handleWaiting = () => setIsLoading(true);
    const handleError = () => {
      setIsLoading(false);
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("error", handleError);

    return () => {
      audio.pause();
      audio.src = "";
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("error", handleError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount, mainVolume is captured at init time
  }, []);

  const play = (songId: string, startPosition: number = 30) => {
    const audio = audioRef.current;
    const client = getClient();
    if (!audio || !client) return;

    // Pause main player if playing
    if (mainPlaybackState === "playing" && mainAudioElement) {
      mainAudioElement.pause();
    }

    // If same song, just resume
    if (currentSongIdRef.current === songId && audio.src) {
      audio.play().catch(console.error);
      return;
    }

    // Load new song
    setIsLoading(true);
    currentSongIdRef.current = songId;

    const streamUrl = client.getStreamUrl(songId);
    audio.src = streamUrl;

    // Seek to start position after metadata loads
    const handleLoadedMetadata = () => {
      if (audio.duration > 0) {
        const seekTime = (startPosition / 100) * audio.duration;
        audio.currentTime = seekTime;
        setProgress(startPosition);
      }
      audio.play().catch(console.error);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.load();
  };

  // Play a URL directly (for staged files or other non-library audio)
  const playUrl = (url: string, id: string, startPosition: number = 0) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Pause main player if playing
    if (mainPlaybackState === "playing" && mainAudioElement) {
      mainAudioElement.pause();
    }

    // If same id, just resume
    if (currentSongIdRef.current === id && audio.src) {
      audio.play().catch(console.error);
      return;
    }

    // Load new audio
    setIsLoading(true);
    currentSongIdRef.current = id;
    audio.src = url;

    // Seek to start position after metadata loads
    const handleLoadedMetadata = () => {
      if (audio.duration > 0 && startPosition > 0) {
        const seekTime = (startPosition / 100) * audio.duration;
        audio.currentTime = seekTime;
        setProgress(startPosition);
      }
      audio.play().catch(console.error);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.load();
  };

  const pause = () => {
    audioRef.current?.pause();
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  };

  const seek = (position: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;

    const newTime = (position / 100) * audio.duration;
    audio.currentTime = newTime;
    setProgress(position);
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    currentSongIdRef.current = null;
    setProgress(0);
    setIsPlaying(false);
  };

  const setVolume = (newVolume: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const clampedVolume = Math.max(0, Math.min(100, newVolume));
    audio.volume = clampedVolume / 100;
    setVolumeState(clampedVolume);
  };

  return {
    isPlaying,
    progress,
    isLoading,
    volume,
    play,
    playUrl,
    pause,
    toggle,
    seek,
    setVolume,
    stop,
  };
}
