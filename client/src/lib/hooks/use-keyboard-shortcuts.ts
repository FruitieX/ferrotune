"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAtomValue, useSetAtom } from "jotai";
import { useAudioEngine, useVolumeControl, useShuffle, useRepeatMode } from "@/lib/audio/hooks";
import { playbackStateAtom, audioElementAtom, durationAtom } from "@/lib/store/player";
import { serverQueueStateAtom } from "@/lib/store/server-queue";

/**
 * Global keyboard shortcuts hook.
 * Should be called once in a top-level component.
 * 
 * Shortcuts:
 * - Space: Play/Pause (when not in input)
 * - Arrow Left: Seek backwards 5 seconds
 * - Arrow Right: Seek forwards 5 seconds
 * - Arrow Up: Volume up 5%
 * - Arrow Down: Volume down 5%
 * - M: Mute/Unmute
 * - N / MediaTrackNext: Next track
 * - P / MediaTrackPrevious: Previous track
 * - S: Toggle shuffle
 * - R: Cycle repeat mode
 * - / or Ctrl+K: Focus search
 */
export function useKeyboardShortcuts() {
  const router = useRouter();
  const playbackState = useAtomValue(playbackStateAtom);
  const audioElement = useAtomValue(audioElementAtom);
  const duration = useAtomValue(durationAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  
  const { togglePlayPause, next, previous } = useAudioEngine();
  const { changeVolume, volume, toggleMute } = useVolumeControl();
  const { toggleShuffle } = useShuffle();
  const { cycleRepeatMode } = useRepeatMode();

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't handle shortcuts when user is typing
    const target = event.target as HTMLElement;
    const isInputFocused = 
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      target.role === "textbox";

    // Handle search shortcut even when typing
    if ((event.key === "/" && !isInputFocused) || (event.key === "k" && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      // Focus search input on search page, or navigate to search
      const searchInput = document.querySelector('input[type="text"][placeholder*="Search"]') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
      } else {
        router.push("/search");
      }
      return;
    }

    // Skip other shortcuts when in input
    if (isInputFocused) return;

    // Media control shortcuts
    switch (event.key) {
      case " ": // Space - Play/Pause
        event.preventDefault();
        if ((queueState && queueState.totalCount > 0) || playbackState === "playing" || playbackState === "paused") {
          togglePlayPause();
        }
        break;

      case "ArrowLeft": // Seek backwards
        event.preventDefault();
        if (audioElement && duration > 0) {
          const seekAmount = event.shiftKey ? 30 : 5;
          audioElement.currentTime = Math.max(0, audioElement.currentTime - seekAmount);
        }
        break;

      case "ArrowRight": // Seek forwards
        event.preventDefault();
        if (audioElement && duration > 0) {
          const seekAmount = event.shiftKey ? 30 : 5;
          audioElement.currentTime = Math.min(duration, audioElement.currentTime + seekAmount);
        }
        break;

      case "ArrowUp": // Volume up
        event.preventDefault();
        changeVolume(Math.min(1, volume + 0.05));
        break;

      case "ArrowDown": // Volume down
        event.preventDefault();
        changeVolume(Math.max(0, volume - 0.05));
        break;

      case "m":
      case "M": // Mute
        event.preventDefault();
        toggleMute();
        break;

      case "n":
      case "N": // Next track
        event.preventDefault();
        next();
        break;

      case "p":
      case "P": // Previous track  
        event.preventDefault();
        previous();
        break;

      case "s":
      case "S": // Toggle shuffle
        if (!event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          toggleShuffle();
        }
        break;

      case "r":
      case "R": // Cycle repeat mode
        if (!event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          cycleRepeatMode();
        }
        break;

      case "MediaPlayPause":
        event.preventDefault();
        togglePlayPause();
        break;

      case "MediaTrackNext":
        event.preventDefault();
        next();
        break;

      case "MediaTrackPrevious":
        event.preventDefault();
        previous();
        break;
    }
  }, [
    audioElement,
    duration,
    queueState,
    playbackState,
    togglePlayPause,
    next,
    previous,
    changeVolume,
    volume,
    toggleMute,
    toggleShuffle,
    cycleRepeatMode,
    router,
  ]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
