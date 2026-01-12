"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  animate,
  type PanInfo,
} from "framer-motion";
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
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { CoverImage } from "@/components/shared/cover-image";
import { WaveformProgressBar } from "@/components/player/waveform-progress-bar";
import {
  fullscreenPlayerOpenAtom,
  fullscreenOpenDragY,
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
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";

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
  const isSmallScreen = useIsSmallScreen();

  // Track if we're in the middle of a gesture-based close animation
  // This is set to true when the user releases a drag that should close
  const [isClosingViaGesture, setIsClosingViaGesture] = useState(false);

  // Track if user is actively dragging the sheet (for backdrop opacity)
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);

  // Track if we're currently opening via gesture (shared motion value is being dragged)
  const [isOpeningWithGesture, setIsOpeningWithGesture] = useState(false);

  const { togglePlayPause, seek, next, previous } = useAudioEngine();
  const { isStarred, toggleStar } = useStarred(
    currentTrack?.id ?? "",
    !!currentTrack?.starred,
  );
  const [localProgress, setLocalProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Motion values for swipe-to-close
  const dragY = useMotionValue(0);

  // Backdrop opacity during close gesture - fades as user drags down
  const closeBackdropOpacity = useTransform(
    dragY,
    [0, typeof window !== "undefined" ? window.innerHeight : 800],
    [1, 0],
  );

  // Backdrop opacity during open gesture - fades in as user swipes up
  const openBackdropOpacity = useTransform(fullscreenOpenDragY, (latest) => {
    if (latest >= 0) return 0;
    const windowHeight =
      typeof window !== "undefined" ? window.innerHeight : 800;
    const progress = Math.min(1, Math.abs(latest) / windowHeight);
    return progress;
  });

  // Transform the shared open gesture drag value to Y position for the sheet
  // fullscreenOpenDragY is negative (upward swipe), we need to convert to Y position
  // When dragY is 0, sheet is at 100% (offscreen), when dragY is -innerHeight, sheet is at 0% (visible)
  const openGestureY = useTransform(fullscreenOpenDragY, (latest) => {
    if (latest >= 0) return "100%";
    const progress = Math.min(
      1,
      Math.abs(latest) /
        (typeof window !== "undefined" ? window.innerHeight : 800),
    );
    return `${(1 - progress) * 100}%`;
  });

  const duration = currentTrack?.duration ?? audioDuration ?? 0;
  const progress = isDragging ? localProgress : currentTime;

  // Subscribe to the shared motion value to know when we're opening via gesture
  useEffect(() => {
    const unsubscribe = fullscreenOpenDragY.on("change", (latest) => {
      // We're opening when the drag value is negative (swiping up)
      const opening = latest < -10; // Small threshold to avoid flickering
      setIsOpeningWithGesture(opening);
    });
    return unsubscribe;
  }, []);

  // Close queue panel when fullscreen opens to avoid showing it on top unexpectedly
  useLayoutEffect(() => {
    if (isOpen) {
      setQueuePanelOpen(false);
    }
  }, [isOpen, setQueuePanelOpen]);

  // Reset drag position when closed (like queue sheet does)
  useEffect(() => {
    if (!isOpen) {
      dragY.set(0);
    }
  }, [isOpen, dragY]);

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

  // Handler for swipe-to-close gesture end
  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    setIsDraggingSheet(false);
    const { offset, velocity } = info;
    const shouldClose = offset.y > 100 || velocity.y > 500;

    if (shouldClose) {
      // Mark that we're closing via gesture so we use motion values instead of AnimatePresence
      setIsClosingViaGesture(true);
      // Animate off-screen then close
      const animDuration = 400; // ms
      animate(dragY, window.innerHeight, {
        type: "tween",
        duration: animDuration / 1000,
        ease: [0.32, 0.72, 0, 1],
      });
      // Schedule the close after animation completes
      setTimeout(() => {
        // Reset gesture state and close
        setIsClosingViaGesture(false);
        setIsOpen(false);
      }, animDuration);
    } else {
      // Snap back to origin
      animate(dragY, 0, { type: "spring", stiffness: 500, damping: 30 });
    }
  };

  // Handler for drag start
  const handleDragStart = () => {
    setIsDraggingSheet(true);
  };

  const isEnded = playbackState === "ended";

  // Should we render the player? Either when open or during opening gesture
  // Note: During gesture close, isOpen is still true until the animation completes
  const shouldRender = isOpen || isOpeningWithGesture;

  if (!currentTrack) return null;

  // Determine animation state:
  // - During opening gesture: use the shared motion value for smooth 60fps animation
  // - During closing gesture: use dragY motion value
  // - Button open/close: use AnimatePresence (initial/animate/exit)
  const useGestureAnimation = isOpeningWithGesture && !isOpen;

  // Only use motion value styles for gesture-based interactions
  // For button-triggered open/close, let AnimatePresence handle everything
  const useOpenGestureBackdrop = useGestureAnimation;
  // Use close gesture styles only when actively animating the close (not during drag)
  // During drag, animate prop stays active and framer-motion handles the coordination
  const useCloseGestureStyles = isClosingViaGesture;
  // Use motion value for backdrop during drag OR close animation
  const useDragBackdrop = isDraggingSheet || isClosingViaGesture;

  return (
    <AnimatePresence>
      {shouldRender && (
        <>
          {/* Backdrop - fades in/out */}
          <motion.div
            key="fullscreen-backdrop"
            initial={{ opacity: 0 }}
            animate={
              useOpenGestureBackdrop || useCloseGestureStyles
                ? undefined // Let style.opacity (motion value) control it during gesture open/close
                : { opacity: 1 }
            }
            exit={
              isClosingViaGesture
                ? { transition: { duration: 0 } } // Skip exit animation - already handled by closeBackdropOpacity
                : { opacity: 0 }
            }
            transition={{
              duration: 0.3,
            }}
            style={
              useOpenGestureBackdrop
                ? { opacity: openBackdropOpacity }
                : useDragBackdrop
                  ? { opacity: closeBackdropOpacity }
                  : undefined
            }
            className="fixed inset-0 z-50 bg-black/60"
          />

          {/* Content - slides up/down, also draggable to close on small screens */}
          <motion.div
            key="fullscreen-content"
            initial={{ y: "100%" }}
            animate={
              useGestureAnimation || useCloseGestureStyles
                ? undefined // Let style.y (motion value) control it during gesture open/close
                : { y: 0 } // Normal open animation - framer-motion coordinates with style.y motion value
            }
            exit={
              isClosingViaGesture
                ? { transition: { duration: 0 } } // Skip exit animation - already handled by dragY
                : { y: "100%" }
            }
            transition={{
              type: "tween",
              duration: 0.4,
              ease: [0.32, 0.72, 0, 1],
            }}
            style={
              useGestureAnimation
                ? {
                    y: openGestureY,
                    touchAction: isSmallScreen ? "none" : "auto",
                  }
                : isSmallScreen
                  ? {
                      // Always use dragY on small screens - framer-motion's drag will sync it
                      y: dragY,
                      touchAction: "none",
                    }
                  : {
                      touchAction: "auto",
                    }
            }
            drag={isSmallScreen ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            dragDirectionLock
            onDragStart={isSmallScreen ? handleDragStart : undefined}
            onDragEnd={isSmallScreen ? handleDragEnd : undefined}
            data-fullscreen-player="true"
            className="fixed inset-0 z-50 bg-linear-to-b from-background/95 to-background flex flex-col"
          >
            {/* Background with cover art */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: coverArtUrl
                  ? `linear-gradient(to bottom, rgba(0,0,0,0.1), var(--background)), url(${coverArtUrl})`
                  : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundBlendMode: "multiply",
              }}
            />
            {/* Blur overlay */}
            <div className="absolute inset-0 backdrop-blur-3xl bg-background/70" />

            {/* Content wrapper */}
            <div className="relative z-10 flex flex-col h-full w-full">
              {/* Inner container with max-width and padding */}
              <div className="flex flex-col h-full max-w-lg md:max-w-2xl lg:max-w-4xl xl:max-w-6xl mx-auto w-full px-6 py-4">
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
                    className="w-full max-w-[min(80vh,600px)] xl:max-w-[min(60vh,800px)] aspect-square"
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
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
