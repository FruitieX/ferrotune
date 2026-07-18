/**
 * Preview Audio Hook
 *
 * A standalone audio preview system. It pauses the main playback engine and
 * enforces one active preview element before starting preview audio.
 */

import { useState, useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { getClient } from "@/lib/api/client";
import {
  audioElementAtom,
  effectiveVolumeAtom,
  volumeAtom,
} from "@/lib/store/player";
import { linearToLogVolume } from "@/lib/audio/volume";
import { nativePause } from "@/lib/audio/native-engine";
import { hasNativeAudio } from "@/lib/tauri";

let activePreviewAudio: HTMLAudioElement | null = null;

function claimPreviewAudio(audio: HTMLAudioElement): void {
  if (activePreviewAudio && activePreviewAudio !== audio) {
    activePreviewAudio.pause();
  }
  activePreviewAudio = audio;
}

function releasePreviewAudio(audio: HTMLAudioElement): void {
  if (activePreviewAudio === audio) {
    activePreviewAudio = null;
  }
}

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
  const mainEffectiveVolume = useAtomValue(effectiveVolumeAtom);
  const mainLinearVolume = useAtomValue(volumeAtom);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  // Initialize volume from main player (mainLinearVolume is 0-1, we store as 0-100)
  const [volume, setVolumeState] = useState(() =>
    Math.round(mainLinearVolume * 100),
  );

  const pauseMainPlayer = async (): Promise<void> => {
    if (hasNativeAudio()) {
      await nativePause();
    } else {
      mainAudioElement?.pause();
    }
  };

  const startPreviewPlayback = (audio: HTMLAudioElement) => {
    claimPreviewAudio(audio);
    void pauseMainPlayer()
      .then(() => {
        // A different hook instance may have claimed preview playback while
        // the native pause command was in flight.
        if (activePreviewAudio === audio) {
          return audio.play();
        }
      })
      .catch(console.error);
  };

  // Sync initial volume to audio element when it's created
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = mainEffectiveVolume;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only sync on mount
  }, []);

  // Create audio element on mount
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    // Set initial volume from main player (already log-scaled)
    audio.volume = mainEffectiveVolume;
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
      releasePreviewAudio(audio);
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

    claimPreviewAudio(audio);
    void pauseMainPlayer().catch(console.error);

    // If same song, just resume
    if (currentSongIdRef.current === songId && audio.src) {
      startPreviewPlayback(audio);
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
      startPreviewPlayback(audio);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.load();
  };

  // Play a URL directly (for staged files or other non-library audio)
  const playUrl = (url: string, id: string, startPosition: number = 0) => {
    const audio = audioRef.current;
    if (!audio) return;

    claimPreviewAudio(audio);
    void pauseMainPlayer().catch(console.error);

    // If same id, just resume
    if (currentSongIdRef.current === id && audio.src) {
      startPreviewPlayback(audio);
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
      startPreviewPlayback(audio);
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
      startPreviewPlayback(audio);
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
    releasePreviewAudio(audio);
    audio.currentTime = 0;
    currentSongIdRef.current = null;
    setProgress(0);
    setIsPlaying(false);
  };

  const setVolume = (newVolume: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const clampedVolume = Math.max(0, Math.min(100, newVolume));
    // Apply logarithmic curve for natural-feeling volume control
    audio.volume = linearToLogVolume(clampedVolume / 100);
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
