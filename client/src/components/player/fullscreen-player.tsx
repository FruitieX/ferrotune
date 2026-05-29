"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  type AnimationPlaybackControls,
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
  Cast,
  Monitor,
  Smartphone,
} from "lucide-react";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import { hapticTap, hapticConfirm } from "@/lib/utils/haptic";
import {
  cleanUpHistoryState,
  isHistoryCleanup,
} from "@/lib/hooks/use-back-button-close";
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
  effectivePlaybackStateAtom,
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
import {
  shouldShowVolumeAtom,
  followerSessionNameAtom,
  followerSessionClientNameAtom,
} from "@/lib/store/session";
import { getClient } from "@/lib/api/client";
import { SongDropdownMenu } from "@/components/browse/song-context-menu";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { cancelFullscreenOpen } from "@/components/layout/swipeable-footer";
import {
  useClippingIndicator,
  formatClippingTooltip,
} from "@/components/player/clipping-indicator";
import { AlertTriangle } from "lucide-react";
import { isCastClientName } from "@/lib/cast/constants";
import { ResponsiveDropdownMenu } from "@/components/shared/responsive-context-menu";
import { ConnectedClientsMenuItems } from "@/components/layout/account-menu-items";
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
      onClick={() => {
        hapticTap();
        setIsMuted(!isMuted);
      }}
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

type AlbumArtPreviewDirection = "previous" | "next";

export function FullscreenPlayer() {
  const [isOpen, setIsOpen] = useAtom(fullscreenPlayerOpenAtom);
  const currentTrack = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(effectivePlaybackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const [volume, setVolume] = useAtom(volumeAtom);
  const [repeatMode, setRepeatMode] = useAtom(repeatModeAtom);
  const [isMuted, setIsMuted] = useAtom(isMutedAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const toggleShuffle = useSetAtom(toggleShuffleAtom);
  const queuePanelOpen = useAtomValue(queuePanelOpenAtom);
  const setQueuePanelOpen = useSetAtom(queuePanelOpenAtom);
  const progressBarStyle = useAtomValue(progressBarStyleAtom);
  const audioDuration = useAtomValue(durationAtom);
  const shouldShowVolume = useAtomValue(shouldShowVolumeAtom);
  const followerSessionName = useAtomValue(followerSessionNameAtom);
  const followerClientName = useAtomValue(followerSessionClientNameAtom);
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const isSmallScreen = useIsSmallScreen();

  // Track if we're in the middle of a gesture-based close animation
  // This is set to true when the user releases a drag that should close
  const [isClosingViaGesture, setIsClosingViaGesture] = useState(false);

  // Ref to track whether a close gesture animation is pending (can be cancelled on re-open)
  const closePendingRef = useRef(false);
  const closeAnimationFallbackRef = useRef<number | null>(null);

  // Track if user is actively dragging the sheet (for backdrop opacity)
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);

  // Track if we're currently opening via gesture (shared motion value is being dragged)
  const [isOpeningWithGesture, setIsOpeningWithGesture] = useState(false);
  const isOpeningWithGestureRef = useRef(false);
  const openGestureWasActiveRef = useRef(false);
  const [isClosedAnimationSettled, setIsClosedAnimationSettled] =
    useState(true);

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
  const albumArtDragCaptureX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const albumArtContainerRef = useRef<HTMLDivElement>(null);
  const [isSwipingAlbumArt, setIsSwipingAlbumArt] = useState(false);
  const [albumArtDismissPreviewDirection, setAlbumArtDismissPreviewDirection] =
    useState<AlbumArtPreviewDirection | null>(null);
  const albumArtDismissAnimationRef = useRef<AnimationPlaybackControls | null>(
    null,
  );
  const albumArtDismissAnimationSettledRef = useRef(false);
  const albumArtMaxHorizontalDistanceRef = useRef(0);
  const albumArtMaxVerticalDistanceRef = useRef(0);
  const albumArtCurrentDownwardDistanceRef = useRef(0);
  const albumArtVerticalCloseRef = useRef(false);
  const albumArtDragStartYRef = useRef(0);

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
  const CLOSE_SWIPE_THRESHOLD = 100;
  const CLOSE_VELOCITY_THRESHOLD = 500;
  const CLOSE_GESTURE_ANIMATION_MS = 400;
  const ALBUM_ART_VERTICAL_CANCEL_THRESHOLD = 40;
  const ALBUM_ART_PREVIEW_GAP = 16;
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : 800;

  const getAlbumArtSwipeDistance = () =>
    (albumArtContainerRef.current?.offsetWidth ?? 300) + ALBUM_ART_PREVIEW_GAP;

  const clampAlbumArtDragX = (value: number) => {
    const swipeDistance = getAlbumArtSwipeDistance();
    const leftLimit = nextTrack ? -swipeDistance : 0;
    const rightLimit = prevTrack ? swipeDistance : 0;
    return Math.min(rightLimit, Math.max(leftLimit, value));
  };

  const getAlbumArtPreviewDirection = (
    value: number,
  ): AlbumArtPreviewDirection | null => {
    if (value > 0) return "previous";
    if (value < 0) return "next";
    return null;
  };

  const albumArtOpacity = useTransform(
    albumArtDragX,
    [-200, 0, 200],
    [0.3, 1, 0.3],
  );

  const prevAlbumArtX = useTransform(albumArtDragX, (v) =>
    v > 0 ? v - getAlbumArtSwipeDistance() : -9999,
  );
  const prevAlbumArtOpacity = useTransform(
    albumArtDragX,
    [0, SWIPE_THRESHOLD, 200],
    [0, 0.5, 1],
  );

  const nextAlbumArtX = useTransform(albumArtDragX, (v) =>
    v < 0 ? v + getAlbumArtSwipeDistance() : 9999,
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
      albumArtDismissAnimationRef.current?.stop();
      albumArtDismissAnimationRef.current = null;
      albumArtDragX.set(0);
      albumArtDragCaptureX.set(0);
      albumArtVerticalCloseRef.current = false;
    }
  }, [currentTrack?.id, albumArtDragX, albumArtDragCaptureX]);

  const stopAlbumArtDismissAnimation = () => {
    albumArtDismissAnimationRef.current?.stop();
    albumArtDismissAnimationRef.current = null;
  };

  const animateAlbumArtToRest = () => {
    stopAlbumArtDismissAnimation();
    albumArtDismissAnimationSettledRef.current = false;
    albumArtDismissAnimationRef.current = animate(albumArtDragX, 0, {
      type: "spring",
      stiffness: 500,
      damping: 50,
      onComplete: () => {
        albumArtDismissAnimationRef.current = null;
        if (albumArtVerticalCloseRef.current) {
          albumArtDismissAnimationSettledRef.current = true;
          albumArtDragX.set(0);
        }
      },
    });
  };

  const resetAlbumArtGesture = () => {
    albumArtMaxHorizontalDistanceRef.current = 0;
    albumArtMaxVerticalDistanceRef.current = 0;
    albumArtCurrentDownwardDistanceRef.current = 0;
    albumArtVerticalCloseRef.current = false;
    albumArtDismissAnimationSettledRef.current = false;
    setAlbumArtDismissPreviewDirection(null);
    albumArtDragStartYRef.current = 0;
  };

  const getPointerClientY = (event: MouseEvent | TouchEvent | PointerEvent) => {
    if ("touches" in event && event.touches.length > 0) {
      return event.touches[0].clientY;
    }
    if ("changedTouches" in event && event.changedTouches.length > 0) {
      return event.changedTouches[0].clientY;
    }
    if ("clientY" in event) return event.clientY;
    return 0;
  };

  const clearGestureCloseFallback = () => {
    if (closeAnimationFallbackRef.current === null) return;

    window.clearTimeout(closeAnimationFallbackRef.current);
    closeAnimationFallbackRef.current = null;
  };

  const settleGestureClosed = () => {
    closePendingRef.current = false;
    clearGestureCloseFallback();
    resetAlbumArtGesture();
    isOpeningWithGestureRef.current = false;
    hapticTap();
    setIsOpen(false);
    setIsOpeningWithGesture(false);
    setIsClosedAnimationSettled(true);
    setIsClosingViaGesture(false);
    setIsDraggingSheet(false);
    setIsSwipingAlbumArt(false);
    requestAnimationFrame(() => {
      fullscreenOpenDragY.set(0);
      stopAlbumArtDismissAnimation();
      albumArtDragX.set(0);
      albumArtDragCaptureX.set(0);
      dragY.set(0);
    });
  };

  const scheduleGestureCloseFallback = () => {
    clearGestureCloseFallback();
    closeAnimationFallbackRef.current = window.setTimeout(() => {
      if (closePendingRef.current) settleGestureClosed();
    }, getGestureCloseDurationMs() + 32);
  };

  const getGestureCloseDurationMs = () => {
    const remainingDistance = Math.max(0, viewportHeight - dragY.get());
    const progressDuration =
      (remainingDistance / viewportHeight) * CLOSE_GESTURE_ANIMATION_MS;
    return Math.min(
      CLOSE_GESTURE_ANIMATION_MS,
      Math.max(120, progressDuration),
    );
  };

  const finishGestureClose = () => {
    // If cancelled (user re-opened), bail out
    if (!closePendingRef.current) return;
    settleGestureClosed();
  };

  const closeWithGestureAnimation = () => {
    // If isOpen is still false we're dismissing during the opening gesture.
    // Cancel the open spring so its onComplete never fires, then let the
    // component settle back to the hidden offscreen state.
    if (!isOpen) {
      cancelFullscreenOpen();
      if (!closePendingRef.current) settleGestureClosed();
      return;
    }

    setIsClosedAnimationSettled(false);
    setIsClosingViaGesture(true);
    setIsDraggingSheet(true);
    closePendingRef.current = true;
    // Keep the logical fullscreen state open while the gesture-owned
    // MotionValue animates the visual sheet out. The atom is closed in
    // settleGestureClosed, after the layer has been hidden.
    dragY.stop();
    const closeDurationMs = getGestureCloseDurationMs();
    animate(dragY, viewportHeight, {
      type: "tween",
      duration: closeDurationMs / 1000,
      ease: [0.32, 0.72, 0, 1],
      onComplete: finishGestureClose,
    }).then(finishGestureClose);
    scheduleGestureCloseFallback();
  };

  const handleAlbumArtDragStart = (
    event: MouseEvent | TouchEvent | PointerEvent,
  ) => {
    stopAlbumArtDismissAnimation();
    albumArtDragCaptureX.set(0);
    resetAlbumArtGesture();
    albumArtDragStartYRef.current = getPointerClientY(event);
    setIsSwipingAlbumArt(true);
  };

  const handleAlbumArtDrag = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    albumArtDragCaptureX.set(0);

    const horizontalDistance = Math.abs(info.offset.x);
    const downwardDistance = Math.max(
      0,
      getPointerClientY(_event) - albumArtDragStartYRef.current,
    );
    albumArtCurrentDownwardDistanceRef.current = downwardDistance;

    albumArtMaxHorizontalDistanceRef.current = Math.max(
      albumArtMaxHorizontalDistanceRef.current,
      horizontalDistance,
    );
    albumArtMaxVerticalDistanceRef.current = Math.max(
      albumArtMaxVerticalDistanceRef.current,
      downwardDistance,
    );

    if (albumArtVerticalCloseRef.current) {
      if (albumArtDismissAnimationSettledRef.current) {
        albumArtDragX.set(0);
      }
      dragY.set(downwardDistance);
      return;
    }

    if (downwardDistance > 0) {
      if (!isDraggingSheet) setIsDraggingSheet(true);
      dragY.set(downwardDistance);
    }

    if (downwardDistance >= ALBUM_ART_VERTICAL_CANCEL_THRESHOLD) {
      if (!albumArtVerticalCloseRef.current) {
        albumArtVerticalCloseRef.current = true;
        setAlbumArtDismissPreviewDirection(
          getAlbumArtPreviewDirection(albumArtDragX.get()) ??
            getAlbumArtPreviewDirection(info.offset.x),
        );
        setIsDraggingSheet(true);
      }
      animateAlbumArtToRest();
      dragY.set(downwardDistance);
      return;
    }

    albumArtDragX.set(clampAlbumArtDragX(info.offset.x));
  };

  const handleAlbumArtDragEnd = async (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    albumArtDragCaptureX.set(0);
    const verticalDistance = albumArtMaxVerticalDistanceRef.current;
    const currentDownwardDistance = albumArtCurrentDownwardDistanceRef.current;
    const horizontalDistance = albumArtMaxHorizontalDistanceRef.current;
    const shouldCloseFullscreen =
      albumArtVerticalCloseRef.current &&
      (currentDownwardDistance > CLOSE_SWIPE_THRESHOLD ||
        (currentDownwardDistance > ALBUM_ART_VERTICAL_CANCEL_THRESHOLD &&
          info.velocity.y > CLOSE_VELOCITY_THRESHOLD));

    if (albumArtVerticalCloseRef.current) {
      setIsSwipingAlbumArt(false);
      resetAlbumArtGesture();

      if (shouldCloseFullscreen) {
        closeWithGestureAnimation();
      } else {
        animate(dragY, 0, { type: "spring", stiffness: 500, damping: 30 }).then(
          () => {
            setIsDraggingSheet(false);
          },
        );
      }
      return;
    }

    const wasPrimarilyHorizontal = horizontalDistance > verticalDistance;
    const currentDragX = clampAlbumArtDragX(albumArtDragX.get());
    const shouldGoNext =
      wasPrimarilyHorizontal &&
      (currentDragX < -SWIPE_THRESHOLD ||
        info.velocity.x < -VELOCITY_THRESHOLD) &&
      nextTrack;
    const shouldGoPrev =
      wasPrimarilyHorizontal &&
      (currentDragX > SWIPE_THRESHOLD ||
        info.velocity.x > VELOCITY_THRESHOLD) &&
      prevTrack;

    if (shouldGoNext) {
      const width = getAlbumArtSwipeDistance();
      await animate(albumArtDragX, -width, {
        type: "spring",
        stiffness: 500,
        damping: 40,
      });
      next();
    } else if (shouldGoPrev) {
      const width = getAlbumArtSwipeDistance();
      await animate(albumArtDragX, width, {
        type: "spring",
        stiffness: 500,
        damping: 40,
      });
      previous();
    } else {
      animateAlbumArtToRest();
    }
    if (dragY.get() > 0) {
      animate(dragY, 0, { type: "spring", stiffness: 500, damping: 30 }).then(
        () => setIsDraggingSheet(false),
      );
    }
    setIsSwipingAlbumArt(false);
    resetAlbumArtGesture();
  };

  useEffect(() => {
    return () => {
      albumArtDismissAnimationRef.current?.stop();
      albumArtDismissAnimationRef.current = null;
    };
  }, []);

  // Backdrop opacity during close gesture - fades as user drags down
  const closeBackdropOpacity = useTransform(dragY, [0, viewportHeight], [1, 0]);
  const closeBackdropBlur = useTransform(
    closeBackdropOpacity,
    (opacity) => `blur(${Math.max(0, opacity) * 4}px)`,
  );

  // Backdrop opacity during open gesture - fades in as user swipes up
  const openBackdropOpacity = useTransform(fullscreenOpenDragY, (latest) => {
    if (latest >= 0) return 0;
    const progress = Math.min(1, Math.abs(latest) / viewportHeight);
    return progress;
  });
  const openBackdropBlur = useTransform(
    openBackdropOpacity,
    (opacity) => `blur(${Math.max(0, opacity) * 4}px)`,
  );

  // Transform the shared open gesture drag value to Y position for the sheet
  // fullscreenOpenDragY is negative (upward swipe), we need to convert to Y position
  // When dragY is 0, sheet is at 100% (offscreen), when dragY is -innerHeight, sheet is at 0% (visible)
  const openGestureY = useTransform(fullscreenOpenDragY, (latest) => {
    if (latest >= 0) return "100%";
    const progress = Math.min(1, Math.abs(latest) / viewportHeight);
    return `${(1 - progress) * 100}%`;
  });

  const duration = currentTrack?.duration ?? audioDuration ?? 0;
  const progress = isDragging ? localProgress : currentTime;

  // Subscribe to the shared motion value to know when we're opening via gesture
  useEffect(() => {
    const unsubscribe = fullscreenOpenDragY.on("change", (latest) => {
      // We're opening when the drag value is negative (swiping up)
      const opening = latest < 0;
      if (isOpeningWithGestureRef.current === opening) return;

      isOpeningWithGestureRef.current = opening;
      setIsOpeningWithGesture(opening);
      if (opening) {
        openGestureWasActiveRef.current = true;
        setIsClosedAnimationSettled(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isOpen) {
      openGestureWasActiveRef.current = false;
      return;
    }

    if (
      !openGestureWasActiveRef.current ||
      isOpeningWithGesture ||
      isClosingViaGesture ||
      isDraggingSheet
    ) {
      return;
    }

    openGestureWasActiveRef.current = false;
    queueMicrotask(() => setIsClosedAnimationSettled(true));
  }, [isOpen, isOpeningWithGesture, isClosingViaGesture, isDraggingSheet]);

  useEffect(() => {
    return () => {
      if (closeAnimationFallbackRef.current !== null) {
        window.clearTimeout(closeAnimationFallbackRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      !isClosedAnimationSettled ||
      (!isOpen && !isClosingViaGesture && !isDraggingSheet)
    ) {
      return;
    }

    queueMicrotask(() => setIsClosedAnimationSettled(false));
  }, [isOpen, isClosingViaGesture, isDraggingSheet, isClosedAnimationSettled]);

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
        // The visual close guard includes isClosingViaGesture, so render is
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
      queueMicrotask(() => {
        isOpeningWithGestureRef.current = false;
        setIsOpeningWithGesture(false);
      });
    }
  }, [isOpen, isClosingViaGesture, dragY]);

  // Handle Escape key to close fullscreen
  // Only close if there are no higher-priority overlays that should handle Escape first
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Check if there are any overlays that should handle Escape first
        // (sheets, dialogs, menus, popovers, dropdown menus, queue panel)
        const higherPriorityOverlay = document.querySelector(
          '[data-state="open"][data-slot="sheet-content"], ' +
            '[data-state="open"][data-slot="dialog-content"], ' +
            '[data-state="open"][data-slot="context-menu-content"], ' +
            '[data-state="open"][data-slot="dropdown-menu-content"], ' +
            '[data-state="open"][data-slot="popover-content"], ' +
            '[data-queue-panel="open"]',
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

  // Track whether fullscreen was closed via the back button (popstate)
  const fsClosedViaPopstateRef = useRef(false);
  // Track whether we've pushed a history entry that needs cleanup
  const fsPushedHistoryRef = useRef(false);

  // Manage browser history state for back button navigation (Android)
  // Push a history entry when fullscreen opens, handle popstate to close.
  // When fullscreen closes via non-back-button means (swipe, chevron),
  // call history.back() to remove the stale entry.
  useEffect(() => {
    // Only on mobile devices with back button
    const isMobileOrTablet =
      typeof window !== "undefined" &&
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );

    if (!isMobileOrTablet || !isOpen) return;

    fsClosedViaPopstateRef.current = false;
    window.history.pushState({ fullscreenPlayer: true }, "");
    fsPushedHistoryRef.current = true;

    const handlePopState = (event: PopStateEvent) => {
      if (isHistoryCleanup(event)) return;

      // Check if there are any higher priority overlays open
      const higherPriorityOverlay = document.querySelector(
        '[data-state="open"][data-slot="sheet-content"], ' +
          '[data-state="open"][data-slot="dialog-content"], ' +
          '[data-state="open"][data-slot="context-menu-content"], ' +
          '[data-state="open"][data-slot="dropdown-menu-content"], ' +
          '[data-state="open"][data-slot="popover-content"], ' +
          '[data-queue-panel="open"]',
      );

      // If there's a higher priority overlay, let it handle the back button
      // (the back button hook or the overlay itself will handle it)
      if (higherPriorityOverlay) {
        // Re-push our state since we still want to intercept the next back
        window.history.pushState({ fullscreenPlayer: true }, "");
        return;
      }

      // Close the fullscreen player
      fsClosedViaPopstateRef.current = true;
      setIsOpen(false);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // Clean up the pushed history entry if fullscreen was closed by
      // something other than the back button (swipe, chevron, programmatic)
      if (fsPushedHistoryRef.current && !fsClosedViaPopstateRef.current) {
        cleanUpHistoryState();
      }
      fsPushedHistoryRef.current = false;
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

  const handleMenuNavigate = () => {
    fsClosedViaPopstateRef.current = true;
    setIsOpen(false);
  };

  // Handler for swipe-to-close gesture end
  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    const { offset, velocity } = info;
    const shouldClose =
      offset.y > CLOSE_SWIPE_THRESHOLD || velocity.y > CLOSE_VELOCITY_THRESHOLD;

    if (shouldClose) {
      hapticConfirm();
      closeWithGestureAnimation();
    } else {
      // Snap back to origin
      animate(dragY, 0, { type: "spring", stiffness: 500, damping: 30 }).then(
        () => setIsDraggingSheet(false),
      );
    }
  };

  // Handler for drag start
  const handleDragStart = () => {
    setIsDraggingSheet(true);
  };

  const isEnded = playbackState === "ended";

  if (!currentTrack) return null;

  // Determine animation state:
  // - During opening gesture: use the shared motion value for smooth 60fps animation
  // - During closing gesture: use dragY motion value
  // - Button open/close: use regular Framer animate state
  const useGestureAnimation = isOpeningWithGesture && !isOpen;
  const useOpenGestureSheetPosition =
    !isOpen &&
    (isOpeningWithGesture ||
      (openGestureWasActiveRef.current && !isClosedAnimationSettled));

  // Only use motion value styles for gesture-based interactions
  // For button-triggered open/close, let animate handle everything
  const useOpenGestureBackdrop = useOpenGestureSheetPosition;
  // Use motion value for backdrop during drag OR close animation
  const useDragBackdrop = isDraggingSheet || isClosingViaGesture;
  const useDragSheetPosition = isDraggingSheet || isClosingViaGesture;
  const isOverlayVisible =
    isOpen ||
    isOpeningWithGesture ||
    isClosingViaGesture ||
    isDraggingSheet ||
    !isClosedAnimationSettled;
  const isInteractive = isOpen && !isClosingViaGesture;
  const shouldCaptureBackdropPointerEvents = isOverlayVisible;
  const sheetOpacity = isOverlayVisible ? 1 : 0;
  const sheetVisibility = isOverlayVisible ? "visible" : "hidden";
  const sheetPointerEvents = isInteractive ? "auto" : "none";
  const backdropPointerEvents = shouldCaptureBackdropPointerEvents
    ? "auto"
    : "none";

  const handleContentAnimationComplete = () => {
    if (!isOpen && !isOpeningWithGesture && !isClosingViaGesture) {
      setIsClosedAnimationSettled(true);
    }
  };

  return (
    <>
      {/* Backdrop - fades in/out */}
      <motion.div
        key="fullscreen-backdrop"
        initial={{ opacity: 0 }}
        animate={{
          opacity: isOpen ? 1 : 0,
          backdropFilter: isOpen ? "blur(4px)" : "blur(0px)",
        }}
        transition={
          useOpenGestureBackdrop || useDragBackdrop
            ? { duration: 0 } // Instant - motion value controls opacity during gestures
            : { duration: 0.3 }
        }
        style={
          useOpenGestureBackdrop
            ? {
                opacity: openBackdropOpacity,
                backdropFilter: openBackdropBlur,
                pointerEvents: backdropPointerEvents,
                visibility: sheetVisibility,
              }
            : useDragBackdrop
              ? {
                  opacity: closeBackdropOpacity,
                  backdropFilter: closeBackdropBlur,
                  pointerEvents: backdropPointerEvents,
                  visibility: sheetVisibility,
                }
              : {
                  pointerEvents: backdropPointerEvents,
                  visibility: sheetVisibility,
                }
        }
        className="fixed inset-0 z-50 bg-black/60"
        data-testid="fullscreen-backdrop"
      />

      {/* Content - slides up/down, also draggable to close on small screens */}
      <motion.div
        key="fullscreen-content"
        initial={false}
        animate={{ y: isOpen ? 0 : "100%" }}
        transition={
          useOpenGestureSheetPosition || useDragSheetPosition
            ? { duration: 0 } // Instant - motion value controls position during gestures
            : { type: "tween", duration: 0.4, ease: [0.32, 0.72, 0, 1] }
        }
        style={
          useOpenGestureSheetPosition
            ? {
                y: openGestureY,
                touchAction: isSmallScreen ? "none" : "auto",
                opacity: sheetOpacity,
                pointerEvents: sheetPointerEvents,
                visibility: sheetVisibility,
              }
            : isSmallScreen && useDragSheetPosition
              ? {
                  y: dragY,
                  touchAction: "none",
                  opacity: sheetOpacity,
                  pointerEvents: sheetPointerEvents,
                  visibility: sheetVisibility,
                }
              : {
                  touchAction: isSmallScreen ? "none" : "auto",
                  opacity: sheetOpacity,
                  pointerEvents: sheetPointerEvents,
                  visibility: sheetVisibility,
                }
        }
        drag={isSmallScreen ? "y" : false}
        dragConstraints={{ top: 0, bottom: viewportHeight }}
        dragElastic={{ top: 0, bottom: 0 }}
        dragDirectionLock
        dragMomentum={false}
        onDragStart={isSmallScreen ? handleDragStart : undefined}
        onDragEnd={isSmallScreen ? handleDragEnd : undefined}
        onAnimationComplete={handleContentAnimationComplete}
        data-fullscreen-player="true"
        data-fullscreen-gesture-phase={
          useGestureAnimation
            ? "opening"
            : isClosingViaGesture
              ? "closing"
              : isOpen
                ? "open"
                : "closed"
        }
        aria-hidden={!isInteractive}
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
                aria-label="Close fullscreen player"
                onClick={() => {
                  hapticTap();
                  setIsOpen(false);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className="rounded-full"
              >
                <ChevronDown className="w-6 h-6" />
              </Button>
              <div className="text-center min-w-0 flex-1 mx-2">
                {followerSessionName ? (
                  <ResponsiveDropdownMenu
                    trigger={
                      <button
                        type="button"
                        className="mx-auto max-w-full touch-manipulation rounded-md px-2 py-1 text-center hover:bg-primary/10 active:bg-primary/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        aria-label={`Open playback clients, currently playing on ${followerSessionName}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                      >
                        <p className="text-xs text-primary uppercase tracking-wider flex items-center justify-center gap-1">
                          {isCastClientName(followerClientName) ? (
                            <Cast className="w-3 h-3" />
                          ) : followerClientName === "ferrotune-mobile" ? (
                            <Smartphone className="w-3 h-3" />
                          ) : (
                            <Monitor className="w-3 h-3" />
                          )}
                          Playing on
                        </p>
                        <p className="text-sm font-medium truncate">
                          {followerSessionName}
                        </p>
                      </button>
                    }
                    renderMenuContent={(components) => (
                      <ConnectedClientsMenuItems components={components} />
                    )}
                    contentClassName="w-64"
                    align="center"
                    side="bottom"
                    drawerTitle="Playback Clients"
                  />
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      {followerSessionName
                        ? "Playing on"
                        : isEnded
                          ? "Queue Ended"
                          : "Playing from"}
                    </p>
                    <p className="text-sm font-medium truncate">
                      {followerSessionName ||
                        queueState?.source?.name ||
                        (queueState?.source?.type === "library"
                          ? "Library"
                          : "Queue")}
                    </p>
                  </>
                )}
              </div>
              <SongDropdownMenu
                song={currentTrack}
                onNavigate={handleMenuNavigate}
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
              {isSmallScreen &&
                !useGestureAnimation &&
                prevTrack &&
                albumArtDismissPreviewDirection !== "next" &&
                isSwipingAlbumArt && (
                  <motion.div
                    className="absolute w-full max-w-[min(80vh,600px)] xl:max-w-[min(60vh,800px)] aspect-square pointer-events-none"
                    style={{
                      x: prevAlbumArtX,
                      opacity: prevAlbumArtOpacity,
                    }}
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
                initial={
                  useGestureAnimation ? false : { scale: 0.9, opacity: 0 }
                }
                animate={{ scale: 1, opacity: 1 }}
                transition={
                  useGestureAnimation ? { duration: 0 } : { delay: 0.1 }
                }
                className="w-full max-w-[min(80vh,600px)] xl:max-w-[min(60vh,800px)] max-h-full aspect-square"
                style={
                  isSmallScreen
                    ? { x: albumArtDragCaptureX, touchAction: "pan-y" }
                    : undefined
                }
                drag={
                  isSmallScreen && !useGestureAnimation && !isClosingViaGesture
                    ? "x"
                    : false
                }
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0}
                dragDirectionLock
                dragMomentum={false}
                onDragStart={handleAlbumArtDragStart}
                onDrag={isSmallScreen ? handleAlbumArtDrag : undefined}
                onDragEnd={isSmallScreen ? handleAlbumArtDragEnd : undefined}
              >
                <motion.div
                  className="w-full h-full"
                  style={
                    isSmallScreen
                      ? { x: albumArtDragX, opacity: albumArtOpacity }
                      : undefined
                  }
                  data-testid="fullscreen-album-art"
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
              </motion.div>

              {/* Next track preview (swipe left) */}
              {isSmallScreen &&
                !useGestureAnimation &&
                nextTrack &&
                albumArtDismissPreviewDirection !== "previous" &&
                isSwipingAlbumArt && (
                  <motion.div
                    className="absolute w-full max-w-[min(80vh,600px)] xl:max-w-[min(60vh,800px)] aspect-square pointer-events-none"
                    style={{
                      x: nextAlbumArtX,
                      opacity: nextAlbumArtOpacity,
                    }}
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
              initial={useGestureAnimation ? false : { y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={
                useGestureAnimation ? { duration: 0 } : { delay: 0.2 }
              }
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
                onClick={() => {
                  hapticTap();
                  toggleStar();
                }}
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
              initial={useGestureAnimation ? false : { y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={
                useGestureAnimation ? { duration: 0 } : { delay: 0.3 }
              }
              className="space-y-2 mb-6"
            >
              {/* Progress bar - waveform or simple based on preference */}
              <div className="relative h-6 md:h-4">
                {progressBarStyle === "waveform" ? (
                  <WaveformProgressBar
                    active={isOverlayVisible && !queuePanelOpen}
                    className="absolute inset-x-0 top-1/2"
                  />
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
              initial={useGestureAnimation ? false : { y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={
                useGestureAnimation ? { duration: 0 } : { delay: 0.4 }
              }
              className="flex items-center justify-center gap-6 mb-8"
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "rounded-full",
                  queueState?.isShuffled && "text-primary hover:text-primary",
                )}
                onClick={() => {
                  hapticTap();
                  toggleShuffle();
                }}
              >
                <Shuffle className="w-5 h-5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="rounded-full w-12 h-12"
                onClick={() => {
                  hapticTap();
                  previous();
                }}
              >
                <SkipBack className="w-7 h-7" />
              </Button>

              <Button
                size="icon"
                className="rounded-full w-16 h-16 bg-primary hover:bg-primary/80"
                onClick={() => {
                  hapticTap();
                  togglePlayPause();
                }}
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
                onClick={() => {
                  hapticTap();
                  next();
                }}
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
                onClick={() => {
                  hapticTap();
                  cycleRepeat();
                }}
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
              initial={useGestureAnimation ? false : { y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={
                useGestureAnimation ? { duration: 0 } : { delay: 0.5 }
              }
              className="flex items-center justify-between pb-4"
            >
              {/* Volume - hidden when session owner uses native/system volume */}
              {shouldShowVolume && (
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
  );
}
