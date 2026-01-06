"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Repeat,
  Repeat1,
  Shuffle,
  Volume2,
  VolumeX,
  ListMusic,
  Heart,
  MoreHorizontal,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { CoverImage } from "@/components/shared/cover-image";
import { WaveformProgressBar } from "@/components/player/waveform-progress-bar";
import {
  fullscreenPlayerOpenAtom,
  queuePanelOpenAtom,
  progressBarStyleAtom,
} from "@/lib/store/ui";
import {
  currentSongAtom,
  serverQueueStateAtom,
  toggleShuffleAtom,
} from "@/lib/store/server-queue";
import {
  playbackStateAtom,
  currentTimeAtom,
  durationAtom,
  volumeAtom,
  repeatModeAtom,
  isMutedAtom,
} from "@/lib/store/player";
import { useStarred } from "@/lib/store/starred";
import { useAudioEngine } from "@/lib/audio/hooks";
import { formatDuration } from "@/lib/utils/format";
import { getClient } from "@/lib/api/client";
import { SongDropdownMenu } from "@/components/browse/song-context-menu";

export function FullscreenPlayer() {
  const [isOpen, setIsOpen] = useAtom(fullscreenPlayerOpenAtom);
  const currentTrack = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const [volume, setVolume] = useAtom(volumeAtom);
  const [repeatMode, setRepeatMode] = useAtom(repeatModeAtom);
  const [isMuted, setIsMuted] = useAtom(isMutedAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const toggleShuffle = useSetAtom(toggleShuffleAtom);
  const setQueuePanelOpen = useSetAtom(queuePanelOpenAtom);
  const progressBarStyle = useAtomValue(progressBarStyleAtom);
  const audioDuration = useAtomValue(durationAtom);
  const volumeContainerRef = useRef<HTMLDivElement>(null);

  const { togglePlayPause, seek, next, previous } = useAudioEngine();
  const { isStarred, toggleStar } = useStarred(
    currentTrack?.id ?? "",
    !!currentTrack?.starred,
  );
  const [localProgress, setLocalProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const duration = currentTrack?.duration ?? audioDuration ?? 0;
  const progress = isDragging ? localProgress : currentTime;

  // Close queue panel when fullscreen opens to avoid showing it on top unexpectedly
  useEffect(() => {
    if (isOpen) {
      setQueuePanelOpen(false);
    }
  }, [isOpen, setQueuePanelOpen]);

  // Handle Escape key to close fullscreen
  // Only close if there are no higher-priority overlays that should handle Escape first
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Check if there are any overlays that should handle Escape first
        // (sheets, dialogs, menus, popovers, dropdown menus)
        const higherPriorityOverlay = document.querySelector(
          '[data-state="open"][data-slot="sheet-content"], ' +
            '[data-state="open"][data-slot="dialog-content"], ' +
            '[data-state="open"][data-slot="context-menu-content"], ' +
            '[data-state="open"][data-slot="dropdown-menu-content"], ' +
            '[data-state="open"][data-slot="popover-content"]',
        );

        // If there's a higher priority overlay, let it handle Escape
        if (higherPriorityOverlay) {
          return;
        }

        e.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setIsOpen]);

  // Manage browser history state for back button navigation (Android)
  // Push a history entry when fullscreen opens, handle popstate to close
  useEffect(() => {
    // Only on mobile devices with back button
    const isMobileOrTablet =
      typeof window !== "undefined" &&
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );

    if (!isMobileOrTablet) return;
    if (!isOpen) return;

    // Push a history state so back button doesn't navigate away
    window.history.pushState({ fullscreenPlayer: true }, "");

    const handlePopState = (_event: PopStateEvent) => {
      // Check if there are any higher priority overlays open
      const higherPriorityOverlay = document.querySelector(
        '[data-state="open"][data-slot="sheet-content"], ' +
          '[data-state="open"][data-slot="dialog-content"], ' +
          '[data-state="open"][data-slot="context-menu-content"], ' +
          '[data-state="open"][data-slot="dropdown-menu-content"], ' +
          '[data-state="open"][data-slot="popover-content"]',
      );

      // If there's a higher priority overlay, let it handle the back button
      // (the back button hook or the overlay itself will handle it)
      if (higherPriorityOverlay) {
        // Re-push our state since we still want to intercept the next back
        window.history.pushState({ fullscreenPlayer: true }, "");
        return;
      }

      // Close the fullscreen player
      setIsOpen(false);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // When component unmounts or isOpen becomes false, we don't need to do anything
      // The history state will naturally be left behind (back button will just navigate)
    };
  }, [isOpen, setIsOpen]);

  // Get cover art URL
  const coverArtUrl = currentTrack?.coverArt
    ? getClient()?.getCoverArtUrl(currentTrack.coverArt, 500)
    : undefined;

  const handleProgressChange = (value: number[]) => {
    setLocalProgress(value[0]);
    setIsDragging(true);
  };

  const handleProgressCommit = (value: number[]) => {
    seek(value[0]);
    setIsDragging(false);
  };

  const cycleRepeat = () => {
    const modes: (typeof repeatMode)[] = ["off", "all", "one"];
    const currentIndex = modes.indexOf(repeatMode);
    setRepeatMode(modes[(currentIndex + 1) % modes.length]);
  };

  // Handle scroll wheel to adjust volume using native event listener with passive: false
  useEffect(() => {
    const container = volumeContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Scroll up = increase volume, scroll down = decrease
      // Use small step (5%) for fine control
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const newVolume = Math.max(0, Math.min(1, volume + delta));
      setVolume(newVolume);
      if (newVolume > 0) setIsMuted(false);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [volume, setVolume, setIsMuted]);

  const openQueue = () => {
    // Open queue drawer directly without closing fullscreen
    // On desktop in fullscreen mode, we show the mobile drawer as an exception
    setQueuePanelOpen(true);
  };

  const isEnded = playbackState === "ended";

  if (!currentTrack) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{
            type: "spring",
            damping: 25,
            stiffness: 300,
            mass: 0.8,
          }}
          data-fullscreen-player="true"
          className="fixed inset-0 z-50 bg-linear-to-b from-background/95 to-background flex flex-col"
          style={{
            backgroundImage: coverArtUrl
              ? `linear-gradient(to bottom, rgba(0,0,0,0.1), var(--background)), url(${coverArtUrl})`
              : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundBlendMode: "multiply",
          }}
        >
          {/* Blur overlay */}
          <div className="absolute inset-0 backdrop-blur-3xl bg-background/70" />

          {/* Content */}
          <div className="relative z-10 flex flex-col h-full max-w-lg xl:max-w-6xl mx-auto w-full px-6 py-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="rounded-full"
              >
                <ChevronDown className="w-6 h-6" />
              </Button>
              <div className="text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {isEnded ? "Queue Ended" : "Now Playing"}
                </p>
                <p className="text-sm font-medium">
                  {(queueState?.currentIndex ?? 0) + 1} /{" "}
                  {queueState?.totalCount ?? 0}
                </p>
              </div>
              <SongDropdownMenu
                song={currentTrack}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="w-5 h-5" />
                    <span className="sr-only">More options</span>
                  </Button>
                }
              />
            </div>

            {/* Album Art */}
            <div className="flex-1 flex items-center justify-center py-4 xl:py-8 min-h-0 overflow-hidden">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="w-full max-w-[min(80vh,500px)] xl:max-w-[min(60vh,800px)] aspect-square"
              >
                <CoverImage
                  src={coverArtUrl}
                  alt={currentTrack.album ?? currentTrack.title}
                  colorSeed={currentTrack.album ?? undefined}
                  type="song"
                  size="full"
                  className="rounded-lg shadow-2xl w-full h-full object-cover"
                  priority
                />
              </motion.div>
            </div>

            {/* Track Info */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex items-center justify-between mb-6"
            >
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold truncate">
                  {currentTrack.title}
                </h2>
                <p className="text-muted-foreground truncate">
                  {currentTrack.artist}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full shrink-0"
                onClick={toggleStar}
              >
                <Heart
                  className={cn(
                    "w-6 h-6",
                    isStarred && "fill-red-500 text-red-500",
                  )}
                />
              </Button>
            </motion.div>

            {/* Progress */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="space-y-2 mb-6"
            >
              {/* Progress bar - waveform or simple based on preference */}
              <div className="relative h-4">
                {progressBarStyle === "waveform" ? (
                  <WaveformProgressBar className="absolute inset-x-0 top-1/2" />
                ) : (
                  <Slider
                    value={[isEnded ? 0 : progress]}
                    max={duration}
                    step={1}
                    onValueChange={handleProgressChange}
                    onValueCommit={handleProgressCommit}
                    className="w-full cursor-pointer absolute inset-x-0 top-1/2 -translate-y-1/2"
                    disabled={isEnded}
                  />
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {formatDuration(isEnded ? 0 : Math.floor(progress))}
                </span>
                <span className="tabular-nums">
                  {formatDuration(isEnded ? 0 : duration)}
                </span>
              </div>
            </motion.div>

            {/* Controls */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex items-center justify-center gap-6 mb-8"
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "rounded-full",
                  queueState?.isShuffled && "text-primary",
                )}
                onClick={() => toggleShuffle()}
              >
                <Shuffle className="w-5 h-5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="rounded-full w-12 h-12"
                onClick={previous}
              >
                <SkipBack className="w-7 h-7" />
              </Button>

              <Button
                size="icon"
                className="rounded-full w-16 h-16 bg-primary hover:bg-primary/80"
                onClick={togglePlayPause}
              >
                {playbackState === "playing" ? (
                  <Pause className="w-8 h-8" />
                ) : (
                  <Play className="w-8 h-8 ml-1" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="rounded-full w-12 h-12"
                onClick={next}
              >
                <SkipForward className="w-7 h-7" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "rounded-full",
                  repeatMode !== "off" && "text-primary",
                )}
                onClick={cycleRepeat}
              >
                {repeatMode === "one" ? (
                  <Repeat1 className="w-5 h-5" />
                ) : (
                  <Repeat className="w-5 h-5" />
                )}
              </Button>
            </motion.div>

            {/* Bottom bar */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex items-center justify-between pb-4"
            >
              {/* Volume */}
              <div
                ref={volumeContainerRef}
                className="flex items-center gap-2 w-32"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-full h-8 w-8"
                  onClick={() => setIsMuted(!isMuted)}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </Button>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  step={0.01}
                  onValueChange={([v]) => {
                    setVolume(v);
                    if (v > 0) setIsMuted(false);
                  }}
                  className="w-full"
                />
              </div>

              {/* Queue button */}
              <Button
                variant="outline"
                size="sm"
                className="rounded-full gap-2"
                onClick={openQueue}
              >
                <ListMusic className="w-4 h-4" />
                Queue
              </Button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
