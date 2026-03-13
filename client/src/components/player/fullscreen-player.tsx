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
  queueWindowAtom,
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
import { appResumeRepaintEvent } from "@/lib/utils/app-resume-repaint";
import { hasNativeAudio } from "@/lib/tauri";
import { getClient } from "@/lib/api/client";
import { SongDropdownMenu } from "@/components/browse/song-context-menu";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { cancelFullscreenOpen } from "@/components/layout/swipeable-footer";
import {
  useClippingIndicator,
  formatClippingTooltip,
} from "@/components/player/clipping-indicator";
import { AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Background component that only re-renders when the cover art changes.
 * Isolated from currentTime updates to prevent unnecessary re-renders and
 * spurious network requests from CSS background-image being re-applied.
 */
function FullscreenBackground({
  coverArt,
}: {
  coverArt: string | null | undefined;
}) {
  const coverArtUrl = coverArt
    ? getClient()?.getCoverArtUrl(coverArt, 500)
    : undefined;

  return (
    <>
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
    </>
  );
}

/** Fullscreen volume controls with clipping indicator integration */
function FullscreenVolumeControls({
  volumeContainerRef,
  volume,
  isMuted,
  setVolume,
  setIsMuted,
}: {
  volumeContainerRef: React.RefObject<HTMLDivElement | null>;
  volume: number;
  isMuted: boolean;
  setVolume: (v: number) => void;
  setIsMuted: (v: boolean) => void;
}) {
  const { isClipping, peakOverDbAt100, peakDbAtCurrent, volumePercent } =
    useClippingIndicator();

  const volumeButton = (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0 rounded-full h-8 w-8"
      onClick={() => setIsMuted(!isMuted)}
    >
      {isClipping ? (
        <AlertTriangle className="w-4 h-4 text-red-500" />
      ) : isMuted || volume === 0 ? (
        <VolumeX className="w-4 h-4" />
      ) : (
        <Volume2 className="w-4 h-4" />
      )}
    </Button>
  );

  return (
    <div ref={volumeContainerRef} className="flex items-center gap-2 w-32">
      {isClipping ? (
        <Tooltip>
          <TooltipTrigger asChild>{volumeButton}</TooltipTrigger>
          <TooltipContent side="top" className="whitespace-pre-line">
            {formatClippingTooltip(
              peakOverDbAt100,
              peakDbAtCurrent,
              volumePercent,
            )}
          </TooltipContent>
        </Tooltip>
      ) : (
        volumeButton
      )}
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
  );
}

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

  // Ref to track whether a close gesture animation is pending (can be cancelled on re-open)
  const closePendingRef = useRef(false);

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

  // Album art horizontal swipe state
  const queueWindow = useAtomValue(queueWindowAtom);
  const albumArtDragX = useMotionValue(0);
  const albumArtContainerRef = useRef<HTMLDivElement>(null);
  const [isSwipingAlbumArt, setIsSwipingAlbumArt] = useState(false);

  // Get adjacent tracks for album art swipe preview
  const prevTrack =
    queueWindow?.songs.find(
      (s) => s.position === (queueState?.currentIndex ?? 0) - 1,
    )?.song ?? null;
  const nextTrack =
    queueWindow?.songs.find(
      (s) => s.position === (queueState?.currentIndex ?? 0) + 1,
    )?.song ?? null;

  const prevCoverArtUrl = prevTrack?.coverArt
    ? getClient()?.getCoverArtUrl(prevTrack.coverArt, 500)
    : undefined;
  const nextCoverArtUrl = nextTrack?.coverArt
    ? getClient()?.getCoverArtUrl(nextTrack.coverArt, 500)
    : undefined;

  // Album art swipe transforms
  const SWIPE_THRESHOLD = 50;
  const VELOCITY_THRESHOLD = 300;

  const albumArtOpacity = useTransform(
    albumArtDragX,
    [-200, 0, 200],
    [0.3, 1, 0.3],
  );

  const prevAlbumArtX = useTransform(albumArtDragX, (v) =>
    v > 0 ? v - (albumArtContainerRef.current?.offsetWidth ?? 300) - 16 : -9999,
  );
  const prevAlbumArtOpacity = useTransform(
    albumArtDragX,
    [0, SWIPE_THRESHOLD, 200],
    [0, 0.5, 1],
  );

  const nextAlbumArtX = useTransform(albumArtDragX, (v) =>
    v < 0 ? v + (albumArtContainerRef.current?.offsetWidth ?? 300) + 16 : 9999,
  );
  const nextAlbumArtOpacity = useTransform(
    albumArtDragX,
    [-200, -SWIPE_THRESHOLD, 0],
    [1, 0.5, 0],
  );

  // Reset albumArtDragX when track changes
  const prevTrackIdRef = useRef(currentTrack?.id);
  useLayoutEffect(() => {
    if (currentTrack?.id !== prevTrackIdRef.current) {
      prevTrackIdRef.current = currentTrack?.id;
      albumArtDragX.set(0);
    }
  }, [currentTrack?.id, albumArtDragX]);

  const handleAlbumArtDragEnd = async (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    const currentDragX = albumArtDragX.get();
    const shouldGoNext =
      (currentDragX < -SWIPE_THRESHOLD ||
        info.velocity.x < -VELOCITY_THRESHOLD) &&
      nextTrack;
    const shouldGoPrev =
      (currentDragX > SWIPE_THRESHOLD ||
        info.velocity.x > VELOCITY_THRESHOLD) &&
      prevTrack;

    if (shouldGoNext) {
      const width = albumArtContainerRef.current?.offsetWidth ?? 300;
      await animate(albumArtDragX, -width, {
        type: "spring",
        stiffness: 500,
        damping: 40,
      });
      next();
    } else if (shouldGoPrev) {
      const width = albumArtContainerRef.current?.offsetWidth ?? 300;
      await animate(albumArtDragX, width, {
        type: "spring",
        stiffness: 500,
        damping: 40,
      });
      previous();
    } else {
      animate(albumArtDragX, 0, {
        type: "spring",
        stiffness: 500,
        damping: 30,
      });
    }
    setIsSwipingAlbumArt(false);
  };

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
  // Also cancel any pending close animation timeout to prevent stale closes
  useLayoutEffect(() => {
    if (isOpen) {
      // Reset the open gesture motion value now that fullscreen has taken over.
      // Done in useLayoutEffect (after render, before paint) so style.y has
      // already switched from openGestureY to dragY — avoids a visible snap
      // to offscreen when the MotionValue transform returns "100%" at value 0.
      fullscreenOpenDragY.set(0);

      setQueuePanelOpen(false);
      // Cancel any pending gesture-close animation so it doesn't
      // close the drawer after the user re-opened it
      if (closePendingRef.current) {
        closePendingRef.current = false;
        // Defer setState to avoid synchronous set-state-in-effect lint rule.
        // The derived useCloseGestureStyles uses && !isOpen, so render is
        // correct even before this microtask fires.
        queueMicrotask(() => setIsClosingViaGesture(false));
      }
      // Always reset dragY when opening — a previous close gesture may have
      // left it at window.innerHeight if the close and open raced.
      dragY.set(0);
    }
  }, [isOpen, setQueuePanelOpen, dragY]);

  // Reset drag position when closed (like queue sheet does)
  // Guard with isClosingViaGesture to avoid snapping dragY back during gesture close
  useEffect(() => {
    if (!isOpen && !isClosingViaGesture) {
      dragY.set(0);
      // Safety: clear any lingering open gesture state so shouldRender goes false
      queueMicrotask(() => setIsOpeningWithGesture(false));
    }
  }, [isOpen, isClosingViaGesture, dragY]);

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

  // Nudge the motion layer when the app-wide resume repaint runs so the
  // fullscreen compositor follows the shared Android redraw path as well.
  useEffect(() => {
    if (!isOpen) return;

    const handleResumeRepaint = () => {
      dragY.set(dragY.get());
    };

    window.addEventListener(appResumeRepaintEvent, handleResumeRepaint);
    return () =>
      window.removeEventListener(appResumeRepaintEvent, handleResumeRepaint);
  }, [isOpen, dragY]);

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
      // If isOpen is still false we're dismissing during the opening gesture.
      // Cancel the open spring so its onComplete never fires, then let the
      // component unmount naturally via shouldRender going false.
      if (!isOpen) {
        cancelFullscreenOpen();
        // fullscreenOpenDragY is already reset to 0 by cancelFullscreenOpen,
        // which will cause isOpeningWithGesture → false → shouldRender → false
        // and AnimatePresence will handle the exit.
        dragY.set(0);
        return;
      }

      // Mark that we're closing via gesture so we use motion values instead of AnimatePresence
      setIsClosingViaGesture(true);
      closePendingRef.current = true;
      // Animate off-screen then close. The .then() fires exactly when
      // the animation finishes, avoiding setTimeout timing issues.
      animate(dragY, window.innerHeight, {
        type: "tween",
        duration: 0.4,
        ease: [0.32, 0.72, 0, 1],
      }).then(() => {
        // If cancelled (user re-opened), bail out
        if (!closePendingRef.current) return;
        closePendingRef.current = false;
        // Close first while isClosingViaGesture is still true so the exit render
        // uses the instant exit path (useCloseGestureStyles = true)
        setIsOpen(false);
        // Reset gesture state and dragY after the exit render
        requestAnimationFrame(() => {
          setIsClosingViaGesture(false);
          dragY.set(0);
        });
      });
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
  const useCloseGestureStyles = isClosingViaGesture && !isOpen;
  // Use motion value for backdrop during drag OR close animation
  // Include isClosingViaGesture (not just useCloseGestureStyles) because isOpen is still
  // true during the close animation timeout, but we still need the backdrop to fade
  const useDragBackdrop = isDraggingSheet || isClosingViaGesture;

  // Safety: ensure all state is clean after AnimatePresence finishes exit
  const handleExitComplete = () => {
    closePendingRef.current = false;
    setIsClosingViaGesture(false);
    setIsOpeningWithGesture(false);
    setIsDraggingSheet(false);
    dragY.set(0);
  };

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {shouldRender && (
        <>
          {/* Backdrop - fades in/out */}
          <motion.div
            key="fullscreen-backdrop"
            initial={useOpenGestureBackdrop ? { opacity: 0 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={
              useCloseGestureStyles
                ? { transition: { duration: 0 } } // Skip exit animation - already handled by closeBackdropOpacity
                : { opacity: 0 }
            }
            transition={
              useOpenGestureBackdrop || useDragBackdrop
                ? { duration: 0 } // Instant - motion value controls opacity during gestures
                : { duration: 0.3 }
            }
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
            initial={useGestureAnimation ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={
              useCloseGestureStyles
                ? { transition: { duration: 0 } } // Skip exit animation - already handled by dragY
                : { y: "100%" }
            }
            transition={
              useGestureAnimation || isClosingViaGesture
                ? { duration: 0 } // Instant - motion value controls position during gestures
                : { type: "tween", duration: 0.4, ease: [0.32, 0.72, 0, 1] }
            }
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
            {/* Background - isolated to prevent re-renders on currentTime changes */}
            <FullscreenBackground coverArt={currentTrack?.coverArt} />

            {/* Content wrapper - pt-safe pushes UI below status bar while blur extends into it */}
            <div className="relative z-10 flex flex-col h-full w-full pt-safe">
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
                  <div className="text-center min-w-0 flex-1 mx-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      {isEnded ? "Queue Ended" : "Playing from"}
                    </p>
                    <p className="text-sm font-medium truncate">
                      {queueState?.source?.name ||
                        (queueState?.source?.type === "library"
                          ? "Library"
                          : "Queue")}
                    </p>
                  </div>
                  <SongDropdownMenu
                    song={currentTrack}
                    onNavigate={() => setIsOpen(false)}
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
                <div
                  ref={albumArtContainerRef}
                  className="flex-1 flex items-center justify-center py-6 xl:py-10 min-h-0 overflow-hidden relative"
                >
                  {/* Previous track preview (swipe right) */}
                  {isSmallScreen && prevTrack && isSwipingAlbumArt && (
                    <motion.div
                      className="absolute w-full max-w-[min(80vh,600px)] xl:max-w-[min(60vh,800px)] aspect-square pointer-events-none"
                      style={{ x: prevAlbumArtX, opacity: prevAlbumArtOpacity }}
                    >
                      <CoverImage
                        src={prevCoverArtUrl}
                        alt={prevTrack.album ?? prevTrack.title}
                        colorSeed={prevTrack.album ?? undefined}
                        type="song"
                        size="full"
                        className="rounded-lg shadow-2xl w-full h-full object-cover"
                      />
                    </motion.div>
                  )}

                  {/* Current track album art */}
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="w-full max-w-[min(80vh,600px)] xl:max-w-[min(60vh,800px)] max-h-full aspect-square"
                    style={
                      isSmallScreen
                        ? {
                            x: albumArtDragX,
                            opacity: albumArtOpacity,
                            touchAction: "pan-y",
                          }
                        : undefined
                    }
                    drag={isSmallScreen ? "x" : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.5}
                    dragDirectionLock
                    onDragStart={() => setIsSwipingAlbumArt(true)}
                    onDragEnd={
                      isSmallScreen ? handleAlbumArtDragEnd : undefined
                    }
                    onPointerDown={(e) => e.stopPropagation()}
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

                  {/* Next track preview (swipe left) */}
                  {isSmallScreen && nextTrack && isSwipingAlbumArt && (
                    <motion.div
                      className="absolute w-full max-w-[min(80vh,600px)] xl:max-w-[min(60vh,800px)] aspect-square pointer-events-none"
                      style={{ x: nextAlbumArtX, opacity: nextAlbumArtOpacity }}
                    >
                      <CoverImage
                        src={nextCoverArtUrl}
                        alt={nextTrack.album ?? nextTrack.title}
                        colorSeed={nextTrack.album ?? undefined}
                        type="song"
                        size="full"
                        className="rounded-lg shadow-2xl w-full h-full object-cover"
                      />
                    </motion.div>
                  )}
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
                  <div className="relative h-6 md:h-4">
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
                      queueState?.isShuffled &&
                        "text-primary hover:text-primary",
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
                      repeatMode !== "off" && "text-primary hover:text-primary",
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
                  {/* Volume - hidden on native audio (Android) where system volume is used */}
                  {!hasNativeAudio() && (
                    <FullscreenVolumeControls
                      volumeContainerRef={volumeContainerRef}
                      volume={volume}
                      isMuted={isMuted}
                      setVolume={setVolume}
                      setIsMuted={setIsMuted}
                    />
                  )}

                  {/* Queue button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto rounded-full gap-2"
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
