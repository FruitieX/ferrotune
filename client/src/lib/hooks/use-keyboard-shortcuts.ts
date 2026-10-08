import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAtomValue } from "jotai";
import {
  useAudioEngine,
  useVolumeControl,
  useShuffle,
  useRepeatMode,
} from "@/lib/audio/hooks";
import {
  playbackStateAtom,
  audioElementAtom,
  durationAtom,
} from "@/lib/store/player";
import { serverQueueStateAtom } from "@/lib/store/server-queue";
import { resolveShortcut } from "@/lib/hooks/keyboard-shortcut-target";

/**
 * Global keyboard shortcuts hook.
 * Should be called once in a top-level component.
 *
 * Shortcuts (see `resolveShortcut` for when focus keeps the key):
 * - Space: Play/Pause
 * - Arrow Left / Right: Seek 5 seconds (Shift: 30 seconds)
 * - Ctrl/Cmd + Arrow Up / Down: Volume up/down 5% (plain arrows scroll)
 * - M: Mute/Unmute
 * - N / MediaTrackNext: Next track
 * - P / MediaTrackPrevious: Previous track
 * - S: Toggle shuffle
 * - R: Cycle repeat mode
 * - / or Ctrl+K: Focus search
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const playbackState = useAtomValue(playbackStateAtom);
  const audioElement = useAtomValue(audioElementAtom);
  const duration = useAtomValue(durationAtom);
  const queueState = useAtomValue(serverQueueStateAtom);

  const { togglePlayPause, next, previous, seek } = useAudioEngine();
  const { changeVolume, volume, toggleMute } = useVolumeControl();
  const { toggleShuffle } = useShuffle();
  const { cycleRepeatMode } = useRepeatMode();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(
        event,
        event.target instanceof HTMLElement ? event.target : null,
      );
      if (!action) return;
      event.preventDefault();

      const seekAmount = event.shiftKey ? 30 : 5;
      switch (action) {
        case "search": {
          // Focus the page's search input, or open the search page.
          const searchInput = document.querySelector<HTMLInputElement>(
            'input[type="text"][placeholder*="Search"]',
          );
          if (searchInput) {
            searchInput.focus();
          } else {
            navigate("/search");
          }
          break;
        }
        case "togglePlay":
          if (
            (queueState && queueState.totalCount > 0) ||
            playbackState === "playing" ||
            playbackState === "paused"
          ) {
            togglePlayPause();
          }
          break;
        case "seekBack":
          if (audioElement && duration > 0) {
            seek(Math.max(0, audioElement.currentTime - seekAmount));
          }
          break;
        case "seekForward":
          if (audioElement && duration > 0) {
            seek(Math.min(duration, audioElement.currentTime + seekAmount));
          }
          break;
        case "volumeUp":
          changeVolume(Math.min(1, volume + 0.05));
          break;
        case "volumeDown":
          changeVolume(Math.max(0, volume - 0.05));
          break;
        case "mute":
          toggleMute();
          break;
        case "next":
          next();
          break;
        case "previous":
          previous();
          break;
        case "shuffle":
          toggleShuffle();
          break;
        case "repeat":
          cycleRepeatMode();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    audioElement,
    duration,
    queueState,
    playbackState,
    togglePlayPause,
    next,
    previous,
    seek,
    changeVolume,
    volume,
    toggleMute,
    toggleShuffle,
    cycleRepeatMode,
    navigate,
  ]);
}
