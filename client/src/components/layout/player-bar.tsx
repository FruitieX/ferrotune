"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { usePathname } from "next/navigation";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  type AnimationPlaybackControls,
} from "framer-motion";
import Link from "next/link";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Repeat,
  Repeat1,
  Shuffle,
  ListMusic,
  Maximize2,
  Heart,
  MoreHorizontal,
  Cast,
  Monitor,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";
import {
  hapticTap,
  hapticConfirm,
  hapticToggle,
  hapticDouble,
} from "@/lib/utils/haptic";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useAudioEngine,
  useVolumeControl,
  useRepeatMode,
  useShuffle,
} from "@/lib/audio/hooks";
import { useCast } from "@/lib/hooks/use-cast";
import { effectivePlaybackStateAtom } from "@/lib/store/player";
import {
  currentSongAtom,
  queueWindowAtom,
  serverQueueStateAtom,
} from "@/lib/store/server-queue";
import {
  queuePanelOpenAtom,
  fullscreenPlayerOpenAtom,
  fullscreenOpenDragY,
  progressBarStyleAtom,
} from "@/lib/store/ui";
import { serverConnectionAtom } from "@/lib/store/auth";
import { isOfflineModeAtom } from "@/lib/store/downloads";
import { useStarred } from "@/lib/store/starred";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import {
  shouldShowVolumeAtom,
  followerSessionNameAtom,
  followerSessionClientNameAtom,
} from "@/lib/store/session";
import { isCastClientName } from "@/lib/cast/constants";
import { ResponsiveDropdownMenu } from "@/components/shared/responsive-context-menu";
import { ConnectedClientsMenuItems } from "@/components/layout/account-menu-items";

import {
  SongContextMenu,
  SongDropdownMenu,
} from "@/components/browse/song-context-menu";
import { CoverImage } from "@/components/shared/cover-image";
import { WaveformProgressBar } from "@/components/player/waveform-progress-bar";
import { SimpleProgressBar } from "@/components/player/simple-progress-bar";
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
import {
  claimGestureAxis,
  getDominantGestureAxis,
  releaseGestureAxisSoon,
  watchNextTapAfterGesture,
  type GestureAxis,
} from "@/lib/utils/gesture";
import { startFullscreenOpenAnimation } from "@/components/layout/swipeable-footer";

// ============================================================================
// Memoized Sub-Components
// These components are split out so frequently changing atoms only re-render the controls that need them
// ============================================================================

interface NowPlayingInfoProps {
  track: Song | null;
  isEnded: boolean;
}

/** Now playing track info - only re-renders when track changes */
function NowPlayingInfo({ track, isEnded }: NowPlayingInfoProps) {
  const isSmallScreen = useIsSmallScreen();
  const setFullscreenOpen = useSetAtom(fullscreenPlayerOpenAtom);
  const { next, previousForce } = useAudioEngine();
  const isOfflineMode = useAtomValue(isOfflineModeAtom);

  // Use global starred state
  const { isStarred, toggleStar } = useStarred(
    track?.id ?? "",
    !!track?.starred,
  );

  // Get cover art URL
  const coverArtUrl = track?.coverArt
    ? isOfflineMode
      ? null
      : getClient()?.getCoverArtUrl(track.coverArt, 96)
    : null;

  if (!track || isEnded) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-md bg-muted" />
        <div>
          <p className="text-sm text-muted-foreground">Not playing</p>
        </div>
      </div>
    );
  }

  // Mobile: entire area is clickable to open fullscreen, swipeable to change tracks
  // Show swipeable controls only on small screens where playback buttons are hidden
  if (isSmallScreen) {
    return (
      <SwipeableNowPlaying
        track={track}
        coverArtUrl={coverArtUrl}
        onOpenFullscreen={() => setFullscreenOpen(true)}
        onNext={next}
        onPrevious={previousForce}
      />
    );
  }

  // Desktop: links to album/artist pages
  return (
    <SongContextMenu song={track} collisionPadding={{ bottom: 200 }}>
      <div className="flex items-center gap-3 min-w-0">
        <motion.div
          key={track.id}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="shrink-0 album-glow cursor-pointer"
          onClick={() => {
            hapticTap();
            setFullscreenOpen(true);
          }}
        >
          <CoverImage
            src={coverArtUrl}
            inlineData={track.coverArtData}
            alt={track.album || "Album cover"}
            colorSeed={track.album || track.title}
            type="song"
            size="sm"
            className="w-14 h-14"
          />
        </motion.div>
        <div className="min-w-0">
          <Link
            href={`/library/albums/details?id=${track.albumId}&songId=${track.id}`}
            className="block text-sm font-medium text-foreground truncate hover:underline"
          >
            {track.title}
          </Link>
          <Link
            href={`/library/artists/details?id=${track.artistId}`}
            className="block text-xs text-muted-foreground truncate hover:underline"
          >
            {track.artist}
          </Link>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:flex shrink-0 h-8 w-8"
          onClick={() => {
            // toggleStar fires its own star/unstar haptic pattern
            toggleStar();
          }}
        >
          <Heart
            className={cn("w-4 h-4", isStarred && "fill-red-500 text-red-500")}
          />
        </Button>
        <div className="hidden lg:block">
          <SongDropdownMenu song={track} />
        </div>
      </div>
    </SongContextMenu>
  );
}

// ============================================================================
// SwipeableNowPlaying - Advanced swipe gestures with preview animations
// ============================================================================

interface SwipeableNowPlayingProps {
  track: Song;
  coverArtUrl: string | null | undefined;
  onOpenFullscreen: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

// Module-level flag to skip animation after swipe
// This is NOT React state, so it can be read/written during render without issues
let skipNextAnimation = false;

function SwipeableNowPlaying({
  track,
  coverArtUrl,
  onOpenFullscreen,
  onNext,
  onPrevious,
}: SwipeableNowPlayingProps) {
  // Get adjacent tracks for preview
  const queueWindow = useAtomValue(queueWindowAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const [isAnimating, setIsAnimating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(250);
  // Track ID we're waiting to transition away from (for race condition fix)
  const pendingTrackChangeFromId = useRef<string | null>(null);

  // Read the module-level skip animation flag
  const shouldSkipAnimation = skipNextAnimation;

  // Motion values for drag tracking - declared early so useEffect can reference it
  const dragX = useMotionValue(0);
  const dragCaptureX = useMotionValue(0);
  const horizontalDismissAnimationRef =
    useRef<AnimationPlaybackControls | null>(null);
  const horizontalDismissAnimationSettledRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerStartXRef = useRef(0);
  const lastPointerRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );
  const velocityRef = useRef({ x: 0, y: 0 });
  const removePointerListenersRef = useRef<(() => void) | null>(null);
  // Track vertical offset during drag to dampen horizontal movement
  const dragStartY = useRef(0);
  // Track whether drag has been "dismissed" (user swiped up far enough for fullscreen)
  const isDragDismissed = useRef(false);
  // Track maximum horizontal distance traveled during this drag gesture
  const maxHorizontalDistance = useRef(0);
  // Track maximum vertical distance traveled during this drag gesture (for tap detection after fullscreen dismiss)
  const maxVerticalDistance = useRef(0);
  const currentUpwardOffset = useRef(0);
  const gestureAxisRef = useRef<GestureAxis | null>(null);

  // Measure container width on mount and resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Track the previous track id to detect track changes
  const prevTrackIdRef = useRef(track.id);

  // Handle drag position reset when track changes after a swipe gesture
  useLayoutEffect(() => {
    if (track.id !== prevTrackIdRef.current) {
      // Track changed - reset drag position if we were waiting for this
      if (pendingTrackChangeFromId.current !== null) {
        dragX.set(0);
        dragCaptureX.set(0);
        pendingTrackChangeFromId.current = null;
      }
      prevTrackIdRef.current = track.id;
    }
  }, [track.id, dragX, dragCaptureX]);

  // Clean up isAnimating state after track change
  const prevTrackIdForAnimationRef = useRef(track.id);
  useLayoutEffect(() => {
    if (track.id !== prevTrackIdForAnimationRef.current) {
      prevTrackIdForAnimationRef.current = track.id;
      // setIsAnimating is only called after track change, not on every render
      // This is a valid use case - synchronizing with external prop change
      setIsAnimating(false);
    }
  }, [track.id]);

  // Reset the skip animation flag after the render has used it
  // This effect runs after the render where shouldSkipAnimation was read
  useLayoutEffect(() => {
    if (shouldSkipAnimation) {
      skipNextAnimation = false;
    }
  }, [shouldSkipAnimation]);

  // Timeout to recover from failed track changes (network errors, etc.)
  // If track doesn't change within 3 seconds, reset the swipe state
  useEffect(() => {
    if (pendingTrackChangeFromId.current === null || !isAnimating) return;

    const timeout = setTimeout(() => {
      // Track change timed out, reset state to allow retrying
      pendingTrackChangeFromId.current = null;
      skipNextAnimation = false;
      dragX.set(0);
      dragCaptureX.set(0);
      setIsAnimating(false);
    }, 3000);

    return () => clearTimeout(timeout);
  }, [isAnimating, dragX, dragCaptureX]);

  const prevTrack =
    queueWindow?.songs.find(
      (s) => s.position === (queueState?.currentIndex ?? 0) - 1,
    )?.song ?? null;
  const nextTrack =
    queueWindow?.songs.find(
      (s) => s.position === (queueState?.currentIndex ?? 0) + 1,
    )?.song ?? null;

  const prevCoverUrl = prevTrack?.coverArt
    ? getClient()?.getCoverArtUrl(prevTrack.coverArt, 96)
    : null;
  const nextCoverUrl = nextTrack?.coverArt
    ? getClient()?.getCoverArtUrl(nextTrack.coverArt, 96)
    : null;

  // Preload adjacent track images so they're cached before we need them
  useEffect(() => {
    const urls = [prevCoverUrl, nextCoverUrl].filter(Boolean) as string[];
    urls.forEach((url) => {
      const img = new window.Image();
      img.src = url;
    });
  }, [prevCoverUrl, nextCoverUrl]);

  // Swipe thresholds and distances
  const SWIPE_THRESHOLD = 50;
  const VELOCITY_THRESHOLD = 300;
  // Threshold for considering gesture a "drag" not a "tap" (based on max distance traveled)
  const TAP_MAX_DISTANCE = 20;
  // Threshold for upward swipe to dismiss horizontal drag (fullscreen trigger threshold)
  const VERTICAL_DISMISS_THRESHOLD = 50;
  // Swipe distance is container width - this is how far the current track animates
  const SWIPE_DISTANCE = containerWidth;
  // Preview padding - how much gap between preview and current track
  const PREVIEW_PADDING = 16;

  // Transform drag distance to opacity (current track fades out as it moves)
  const currentOpacity = useTransform(
    dragX,
    [-SWIPE_DISTANCE, 0, SWIPE_DISTANCE],
    [0, 1, 0],
  );

  // Preview tracks: start just outside container (width + padding), end at position 0
  // This ensures no visual snap when the track changes and dragX resets to 0
  // Previous track starts offscreen left at -(containerWidth + padding), ends at 0
  const prevPreviewX = useTransform(
    dragX,
    [0, SWIPE_DISTANCE],
    [-(SWIPE_DISTANCE + PREVIEW_PADDING), 0],
  );
  const prevPreviewOpacity = useTransform(
    dragX,
    [0, SWIPE_THRESHOLD, SWIPE_DISTANCE],
    [0, 0.5, 1],
  );

  // Next track starts offscreen right at +(containerWidth + padding), ends at 0
  const nextPreviewX = useTransform(
    dragX,
    [-SWIPE_DISTANCE, 0],
    [0, SWIPE_DISTANCE + PREVIEW_PADDING],
  );
  const nextPreviewOpacity = useTransform(
    dragX,
    [-SWIPE_DISTANCE, -SWIPE_THRESHOLD, 0],
    [1, 0.5, 0],
  );

  const stopHorizontalDismissAnimation = () => {
    horizontalDismissAnimationRef.current?.stop();
    horizontalDismissAnimationRef.current = null;
  };

  const animateHorizontalDragToRest = () => {
    stopHorizontalDismissAnimation();
    horizontalDismissAnimationSettledRef.current = false;
    horizontalDismissAnimationRef.current = animate(dragX, 0, {
      type: "spring",
      stiffness: 500,
      damping: 30,
      onComplete: () => {
        horizontalDismissAnimationRef.current = null;
        if (isDragDismissed.current) {
          horizontalDismissAnimationSettledRef.current = true;
          dragX.set(0);
        }
      },
    });
  };

  const cleanupPointerListeners = () => {
    removePointerListenersRef.current?.();
    removePointerListenersRef.current = null;
  };

  useEffect(() => {
    return () => {
      horizontalDismissAnimationRef.current?.stop();
      horizontalDismissAnimationRef.current = null;
      cleanupPointerListeners();
    };
  }, []);

  const resetPointerGesture = () => {
    stopHorizontalDismissAnimation();
    dragCaptureX.set(0);
    // Reset state for new gesture
    isDragDismissed.current = false;
    horizontalDismissAnimationSettledRef.current = false;
    maxHorizontalDistance.current = 0;
    maxVerticalDistance.current = 0;
    currentUpwardOffset.current = 0;
    gestureAxisRef.current = null;
    velocityRef.current = { x: 0, y: 0 };
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointerIdRef.current) return;

    event.preventDefault();
    dragCaptureX.set(0);

    const now = performance.now();
    const lastPointer = lastPointerRef.current;
    if (lastPointer) {
      const elapsedMs = Math.max(1, now - lastPointer.time);
      velocityRef.current = {
        x: ((event.clientX - lastPointer.x) / elapsedMs) * 1000,
        y: ((event.clientY - lastPointer.y) / elapsedMs) * 1000,
      };
    }
    lastPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: now,
    };

    const offsetX = event.clientX - pointerStartXRef.current;

    // Track maximum horizontal distance for tap detection
    maxHorizontalDistance.current = Math.max(
      maxHorizontalDistance.current,
      Math.abs(offsetX),
    );

    // Only consider UPWARD movement (dragStartY - currentY > 0)
    // Downward movement should not affect horizontal drag
    const upwardOffset = Math.max(0, dragStartY.current - event.clientY);
    currentUpwardOffset.current = upwardOffset;

    // Track max vertical distance for tap detection
    maxVerticalDistance.current = Math.max(
      maxVerticalDistance.current,
      upwardOffset,
    );

    const axis = getDominantGestureAxis(
      offsetX,
      upwardOffset,
      gestureAxisRef.current,
      { minDistance: 6, dominanceRatio: 1 },
    );
    gestureAxisRef.current = axis;

    if (!axis) {
      fullscreenOpenDragY.set(0);
      dragX.set(0);
      return;
    }

    if (axis === "horizontal") {
      claimGestureAxis("horizontal");
      fullscreenOpenDragY.set(0);
      dragX.set(offsetX);
      return;
    }

    claimGestureAxis("vertical");

    dragX.set(0);
    // Update the shared fullscreenOpenDragY so the fullscreen player preview
    // follows the finger both upward and back down to zero.
    fullscreenOpenDragY.set(-upwardOffset);

    // Check if we've crossed the threshold to dismiss the horizontal drag
    if (
      upwardOffset >= VERTICAL_DISMISS_THRESHOLD &&
      !isDragDismissed.current
    ) {
      // Dismiss the horizontal drag once and ignore further horizontal movement.
      isDragDismissed.current = true;
      animateHorizontalDragToRest();
      return;
    }
  };

  const finishPointerGesture = async () => {
    dragCaptureX.set(0);
    const velocity = velocityRef.current;
    const gestureAxis = gestureAxisRef.current;
    const shouldOpenFullscreen =
      gestureAxis === "vertical" &&
      currentUpwardOffset.current >= VERTICAL_DISMISS_THRESHOLD &&
      velocity.y <= VELOCITY_THRESHOLD;

    if (isDragDismissed.current) {
      if (shouldOpenFullscreen) {
        startFullscreenOpenAnimation(onOpenFullscreen);
        dragCaptureX.set(0);
      } else {
        await animate(fullscreenOpenDragY, 0, {
          type: "spring",
          stiffness: 500,
          damping: 30,
        });
        dragCaptureX.set(0);
      }
      currentUpwardOffset.current = 0;
      isDragDismissed.current = false;
      horizontalDismissAnimationSettledRef.current = false;
      gestureAxisRef.current = null;
      releaseGestureAxisSoon(gestureAxis ?? undefined);
      return;
    }

    if (isAnimating) {
      animate(fullscreenOpenDragY, 0, {
        type: "spring",
        stiffness: 500,
        damping: 30,
      });
      return;
    }

    // Only trigger track skip if the gesture was primarily horizontal.
    // This prevents vertical swipes (to open/dismiss fullscreen) from
    // accidentally skipping tracks due to incidental horizontal velocity.
    const wasPrimarilyHorizontal =
      gestureAxis === "horizontal" &&
      maxHorizontalDistance.current > maxVerticalDistance.current;

    // Only consider it a horizontal swipe if the movement is significant
    // Use the actual dragX value (which may be dampened) for threshold check
    const currentDragX = dragX.get();
    const shouldGoNext =
      wasPrimarilyHorizontal &&
      (currentDragX < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD);
    const shouldGoPrev =
      wasPrimarilyHorizontal &&
      (currentDragX > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD);

    if (shouldGoNext && nextTrack) {
      watchNextTapAfterGesture("now-playing-horizontal-swipe");
      // Animate current track off to the left, then change track
      setIsAnimating(true);
      await animate(dragX, -SWIPE_DISTANCE, {
        type: "spring",
        stiffness: 500,
        damping: 40,
      });
      // Mark that we're waiting for this track to change
      // The useEffect will reset dragX when track.id actually changes
      pendingTrackChangeFromId.current = track.id;
      // Skip the enter animation for the new track (preview is already in position)
      skipNextAnimation = true;
      hapticConfirm();
      onNext();
    } else if (shouldGoPrev && prevTrack) {
      watchNextTapAfterGesture("now-playing-horizontal-swipe");
      // Animate current track off to the right, then change track
      setIsAnimating(true);
      await animate(dragX, SWIPE_DISTANCE, {
        type: "spring",
        stiffness: 500,
        damping: 40,
      });
      // Mark that we're waiting for this track to change
      pendingTrackChangeFromId.current = track.id;
      // Skip the enter animation for the new track (preview is already in position)
      skipNextAnimation = true;
      hapticConfirm();
      onPrevious();
    } else {
      // Snap back to center with animation
      animate(dragX, 0, { type: "spring", stiffness: 500, damping: 30 });
      animate(fullscreenOpenDragY, 0, {
        type: "spring",
        stiffness: 500,
        damping: 30,
      });
    }
    currentUpwardOffset.current = 0;
    gestureAxisRef.current = null;
    releaseGestureAxisSoon(gestureAxis ?? undefined);
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== activePointerIdRef.current) return;

    cleanupPointerListeners();
    activePointerIdRef.current = null;
    void finishPointerGesture();
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== activePointerIdRef.current) return;

    cleanupPointerListeners();
    activePointerIdRef.current = null;
    dragX.set(0);
    fullscreenOpenDragY.set(0);
    currentUpwardOffset.current = 0;
    gestureAxisRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;

    cleanupPointerListeners();
    resetPointerGesture();
    activePointerIdRef.current = event.pointerId;
    pointerStartXRef.current = event.clientX;
    dragStartY.current = event.clientY;
    lastPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    removePointerListenersRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  };

  return (
    <SongContextMenu
      song={track}
      collisionPadding={{ bottom: 200 }}
      className="flex-1 min-w-0"
    >
      <div
        ref={containerRef}
        className="relative flex items-center w-full overflow-visible"
      >
        {/* Previous track preview (slides in from left on right swipe) */}
        {prevTrack && (
          <motion.div
            className="absolute inset-0 flex items-center gap-3 pointer-events-none"
            style={{
              x: prevPreviewX,
              opacity: prevPreviewOpacity,
            }}
          >
            <CoverImage
              src={prevCoverUrl}
              inlineData={prevTrack.coverArtData}
              alt={prevTrack.album || "Previous album"}
              colorSeed={prevTrack.album || prevTrack.title}
              type="song"
              size="sm"
              className="w-14 h-14 shrink-0"
            />
            <div className="min-w-0 overflow-hidden">
              <span className="block text-sm font-medium text-foreground truncate">
                {prevTrack.title}
              </span>
              <span className="block text-xs text-muted-foreground truncate">
                {prevTrack.artist}
              </span>
            </div>
          </motion.div>
        )}

        {/* Next track preview (slides in from right on left swipe) */}
        {nextTrack && (
          <motion.div
            className="absolute inset-0 flex items-center gap-3 pointer-events-none"
            style={{
              x: nextPreviewX,
              opacity: nextPreviewOpacity,
            }}
          >
            <CoverImage
              src={nextCoverUrl}
              inlineData={nextTrack.coverArtData}
              alt={nextTrack.album || "Next album"}
              colorSeed={nextTrack.album || nextTrack.title}
              type="song"
              size="sm"
              className="w-14 h-14 shrink-0"
            />
            <div className="min-w-0 overflow-hidden">
              <span className="block text-sm font-medium text-foreground truncate">
                {nextTrack.title}
              </span>
              <span className="block text-xs text-muted-foreground truncate">
                {nextTrack.artist}
              </span>
            </div>
          </motion.div>
        )}

        {/* Current track (main draggable element) */}
        <motion.button
          type="button"
          data-now-playing-gesture="true"
          onPointerDown={(event) => {
            // Reset all gesture state at the start of any interaction
            // This ensures a fresh tap isn't blocked by stale values from previous gestures
            handlePointerDown(event);
          }}
          onClick={() => {
            // Only open fullscreen if this was a tap, not a drag
            // Check both horizontal and vertical distance - if either exceeds threshold, it's a drag
            const wasTap =
              maxHorizontalDistance.current < TAP_MAX_DISTANCE &&
              maxVerticalDistance.current < TAP_MAX_DISTANCE;
            if (wasTap) {
              // Match the swipe-up gesture haptic so both entry paths feel consistent
              hapticConfirm();
              onOpenFullscreen();
            }
          }}
          className="flex flex-1 items-center gap-3 min-w-0 text-left relative z-10"
          style={{
            touchAction: "none",
            x: dragCaptureX,
          }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        >
          <motion.div
            className="flex flex-1 items-center gap-3 min-w-0 w-full"
            data-testid="now-playing-swipe-target"
            style={{
              x: dragX,
              opacity: currentOpacity,
            }}
          >
            <motion.div
              key={track.id}
              // Skip animation when coming from a swipe - the preview was already in position
              initial={shouldSkipAnimation ? false : { scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="shrink-0 album-glow"
            >
              <CoverImage
                src={coverArtUrl}
                inlineData={track.coverArtData}
                alt={track.album || "Album cover"}
                colorSeed={track.album || track.title}
                type="song"
                size="sm"
                className="w-14 h-14"
              />
            </motion.div>
            <div className="min-w-0">
              <span className="block text-sm font-medium text-foreground truncate">
                {track.title}
              </span>
              <span className="block text-xs text-muted-foreground truncate">
                {track.artist}
              </span>
            </div>
          </motion.div>
        </motion.button>
      </div>
    </SongContextMenu>
  );
}

interface PlaybackControlsProps {
  hasTrack: boolean;
  playbackState: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
}

/** Play/pause and skip buttons - only re-renders when playback state changes */
function PlaybackControls({ hasTrack, playbackState }: PlaybackControlsProps) {
  const { togglePlayPause, next, previous } = useAudioEngine();
  const { isShuffled, toggleShuffle } = useShuffle();
  const { repeatMode, cycleRepeatMode } = useRepeatMode();

  const isPlaying = playbackState === "playing";
  const isLoading = playbackState === "loading";
  const RepeatIcon = repeatMode === "one" ? Repeat1 : Repeat;
  const playPauseLabel = isLoading ? "Loading" : isPlaying ? "Pause" : "Play";
  const playPauseDisabled = playbackState === "idle" || isLoading;

  const handlePlayPause = () => {
    hapticTap();
    togglePlayPause();
  };
  const handleNext = () => {
    hapticTap();
    next();
  };
  const handlePrevious = () => {
    hapticTap();
    previous();
  };
  const handleShuffle = () => {
    hapticToggle();
    toggleShuffle();
  };
  const handleRepeat = () => {
    hapticToggle();
    cycleRepeatMode();
  };

  return (
    <div className="flex items-center gap-1 md:gap-2">
      {/* Shuffle - hidden on mobile, shown in more menu */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "hidden md:flex h-8 w-8",
          isShuffled && "text-primary hover:text-primary",
        )}
        onClick={handleShuffle}
        aria-label="Shuffle"
        aria-pressed={isShuffled}
      >
        <Shuffle className="w-4 h-4" />
      </Button>

      {/* Previous - hidden on mobile, shown in more menu */}
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:flex h-8 w-8 md:h-9 md:w-9"
        onClick={handlePrevious}
        disabled={!hasTrack}
        aria-label="Previous"
      >
        <SkipBack className="w-4 h-4 md:w-5 md:h-5" />
      </Button>

      {/* Play/pause - ghost variant on mobile, default (filled) on desktop */}
      <Button
        variant="ghost"
        size="icon"
        className="flex md:hidden h-9 w-9 rounded-full"
        onClick={handlePlayPause}
        disabled={playPauseDisabled}
        aria-label={playPauseLabel}
      >
        {isLoading ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-4 h-4 border-2 border-foreground border-t-transparent rounded-full"
          />
        ) : isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </Button>
      <Button
        variant="default"
        size="icon"
        className="hidden md:flex h-10 w-10 rounded-full"
        onClick={handlePlayPause}
        disabled={playPauseDisabled}
        aria-label={playPauseLabel}
      >
        {isLoading ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full"
          />
        ) : isPlaying ? (
          <Pause className="w-5 h-5" />
        ) : (
          <Play className="w-5 h-5 ml-0.5" />
        )}
      </Button>

      {/* Next - hidden on mobile, shown in more menu */}
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:flex h-8 w-8 md:h-9 md:w-9"
        onClick={handleNext}
        disabled={!hasTrack}
        aria-label="Next"
      >
        <SkipForward className="w-4 h-4 md:w-5 md:h-5" />
      </Button>

      {/* Repeat - hidden on mobile, shown in more menu */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "hidden md:flex h-8 w-8",
          repeatMode !== "off" && "text-primary hover:text-primary",
        )}
        onClick={handleRepeat}
        aria-label="Repeat"
        aria-pressed={repeatMode !== "off"}
        data-repeat-mode={repeatMode}
      >
        <RepeatIcon className="w-4 h-4" />
      </Button>
    </div>
  );
}

/** Volume controls - separated to avoid re-renders from time updates */
function VolumeControls() {
  const { volume, isMuted, toggleMute, changeVolume } = useVolumeControl();
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const { isClipping, peakOverDbAt100, peakDbAtCurrent, volumePercent } =
    useClippingIndicator();
  const shouldShowVolume = useAtomValue(shouldShowVolumeAtom);

  const VolumeIcon =
    isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

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
      changeVolume(newVolume);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [volume, changeVolume]);

  // Hide volume controls when the session owner is a native/mobile client
  if (!shouldShowVolume) return null;

  const volumeButton = (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => {
        hapticToggle();
        toggleMute();
      }}
      aria-label={isMuted ? "Unmute" : "Mute"}
    >
      {isClipping ? (
        <AlertTriangle className="w-4 h-4 text-red-500" />
      ) : (
        <VolumeIcon className="w-4 h-4" />
      )}
    </Button>
  );

  return (
    // Desktop volume - hidden on mobile (mobile uses more menu for volume)
    <div
      ref={volumeContainerRef}
      className="hidden md:flex items-center gap-2 w-32"
    >
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
        value={[isMuted ? 0 : volume * 100]}
        max={100}
        step={1}
        className="flex-1"
        onValueChange={([value]) => changeVolume(value / 100)}
        aria-label="Volume"
      />
    </div>
  );
}

/** Queue button - separated to avoid re-renders */
function QueueButton() {
  const [queuePanelOpen, setQueuePanelOpen] = useAtom(queuePanelOpenAtom);

  const toggleQueue = () => {
    hapticDouble();
    setQueuePanelOpen(!queuePanelOpen);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={toggleQueue}
      aria-label="Queue"
    >
      <ListMusic className="w-4 h-4" />
    </Button>
  );
}

/** Mobile more options menu - separated to avoid re-renders */
function MobileMoreMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const setFullscreenOpen = useSetAtom(fullscreenPlayerOpenAtom);
  const { isShuffled, toggleShuffle } = useShuffle();
  const { repeatMode, cycleRepeatMode } = useRepeatMode();
  const { volume, isMuted, toggleMute, changeVolume } = useVolumeControl();
  const { togglePlayPause, next, previous } = useAudioEngine();
  const { isAvailable, isCasting, castDeviceName, requestCast, stopCasting } =
    useCast();
  const playbackState = useAtomValue(effectivePlaybackStateAtom);
  const shouldShowVolume = useAtomValue(shouldShowVolumeAtom);

  const isPlaying = playbackState === "playing";
  const RepeatIcon = repeatMode === "one" ? Repeat1 : Repeat;
  const VolumeIcon =
    isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const handleFullscreen = () => {
    setIsOpen(false);
    hapticTap();
    setFullscreenOpen(true);
  };

  const handleCast = () => {
    setIsOpen(false);
    hapticToggle();
    if (isCasting) {
      stopCasting();
    } else {
      requestCast();
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden"
          aria-label="More options"
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-auto p-2">
        <div className="flex flex-col gap-1">
          {/* Playback controls row */}
          <div className="flex items-center justify-center gap-1 pb-1 border-b border-border mb-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                hapticTap();
                previous();
              }}
              aria-label="Previous"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                hapticTap();
                togglePlayPause();
              }}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                hapticTap();
                next();
              }}
              aria-label="Next"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>
          {/* Volume - hidden when session owner uses native/system volume */}
          {shouldShowVolume && (
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 p-0"
                onClick={() => {
                  hapticToggle();
                  toggleMute();
                }}
              >
                <VolumeIcon className="w-4 h-4" />
              </Button>
              <Slider
                value={[isMuted ? 0 : volume * 100]}
                max={100}
                step={1}
                className="w-24"
                onValueChange={([value]) => changeVolume(value / 100)}
                aria-label="Volume"
              />
            </div>
          )}
          {isAvailable && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "justify-start gap-2",
                isCasting && "text-primary hover:text-primary",
              )}
              onClick={handleCast}
            >
              <Cast className="w-4 h-4" />
              {isCasting
                ? `Casting to ${castDeviceName ?? "device"}`
                : "Cast to device"}
            </Button>
          )}
          {/* Shuffle */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "justify-start gap-2",
              isShuffled && "text-primary hover:text-primary",
            )}
            onClick={() => {
              hapticToggle();
              toggleShuffle();
            }}
          >
            <Shuffle className="w-4 h-4" />
            Shuffle {isShuffled && "On"}
          </Button>
          {/* Repeat */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "justify-start gap-2",
              repeatMode !== "off" && "text-primary hover:text-primary",
            )}
            onClick={() => {
              hapticToggle();
              cycleRepeatMode();
            }}
          >
            <RepeatIcon className="w-4 h-4" />
            Repeat{" "}
            {repeatMode === "one"
              ? "One"
              : repeatMode === "all"
                ? "All"
                : "Off"}
          </Button>
          {/* Fullscreen */}
          <Button
            variant="ghost"
            size="sm"
            className="justify-start gap-2"
            onClick={handleFullscreen}
          >
            <Maximize2 className="w-4 h-4" />
            Fullscreen
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Cast button - shows cast icon when Chromecast devices are available */
function CastButton() {
  const { isAvailable, isCasting, castDeviceName, requestCast, stopCasting } =
    useCast();

  if (!isAvailable) return null;

  const handleCastClick = () => {
    hapticToggle();
    if (isCasting) {
      stopCasting();
    } else {
      requestCast();
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("hidden md:flex h-8 w-8", isCasting && "text-primary")}
          onClick={handleCastClick}
          aria-label={isCasting ? "Stop casting" : "Cast"}
        >
          <Cast className="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isCasting
          ? `Casting to ${castDeviceName ?? "device"}`
          : "Cast to device"}
      </TooltipContent>
    </Tooltip>
  );
}

/** Follower session indicator - shows when listening on another device */
function FollowerIndicator() {
  const isOfflineMode = useAtomValue(isOfflineModeAtom);
  const sessionName = useAtomValue(followerSessionNameAtom);
  const clientName = useAtomValue(followerSessionClientNameAtom);

  if (isOfflineMode) {
    return (
      <div className="pointer-events-none relative z-110 flex w-full items-center justify-center bg-amber-500/10 pt-2 pb-0.5 text-amber-600 dark:text-amber-400 text-xs">
        <div className="flex max-w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-2">
          <WifiOff className="w-3 h-3 shrink-0" />
          <span className="truncate">
            Offline mode: playing downloaded music
          </span>
        </div>
      </div>
    );
  }

  if (!sessionName) return null;

  const Icon = isCastClientName(clientName)
    ? Cast
    : clientName === "ferrotune-mobile"
      ? Smartphone
      : Monitor;

  return (
    <div className="pointer-events-none relative z-110 flex w-full items-center justify-center bg-primary/10 pt-2 pb-0.5 text-primary text-xs">
      <ResponsiveDropdownMenu
        trigger={
          <button
            type="button"
            className="pointer-events-auto flex max-w-full min-w-0 touch-manipulation items-center justify-center gap-1.5 rounded-md px-2 hover:bg-primary/15 active:bg-primary/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={`Open playback clients, currently playing on ${sessionName}`}
          >
            <Icon className="w-3 h-3 shrink-0" />
            <span className="truncate">Playing on {sessionName}</span>
          </button>
        }
        triggerWrapperClassName="pointer-events-auto mx-auto w-fit max-w-[calc(100%-1rem)]"
        renderMenuContent={(components) => (
          <ConnectedClientsMenuItems components={components} />
        )}
        contentClassName="w-64"
        align="center"
        side="top"
        drawerTitle="Playback Clients"
      />
    </div>
  );
}

/** Fullscreen button - separated to avoid re-renders */
function FullscreenButton() {
  const setFullscreenOpen = useSetAtom(fullscreenPlayerOpenAtom);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="hidden md:flex h-8 w-8"
      onClick={() => {
        hapticTap();
        setFullscreenOpen(true);
      }}
      aria-label="Fullscreen"
    >
      <Maximize2 className="w-4 h-4" />
    </Button>
  );
}

// ============================================================================
// Main PlayerBar Component
// ============================================================================

export function PlayerBar() {
  const pathname = usePathname();
  const currentTrack = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(effectivePlaybackStateAtom);
  const connection = useAtomValue(serverConnectionAtom);
  const progressBarStyle = useAtomValue(progressBarStyleAtom);

  // Don't show on login or setup pages
  if (pathname === "/login" || pathname === "/setup") {
    return null;
  }

  const isEnded = playbackState === "ended";
  const hasTrack = !!currentTrack;

  // During SSR or before hydration, render a static skeleton
  // This prevents layout shift and provides consistent SSR output
  if (!connection) {
    return <PlayerBarSkeleton />;
  }

  return (
    <footer
      data-testid="player-bar"
      className={cn(
        "relative z-50",
        "bg-background/95 backdrop-blur-lg",
        "transition-all duration-200",
      )}
    >
      {/* Progress bar at top - waveform or simple based on preference */}
      {progressBarStyle === "waveform" ? (
        <WaveformProgressBar />
      ) : (
        <SimpleProgressBar />
      )}

      {/* Follower session indicator */}
      <FollowerIndicator />

      <div className="flex items-center h-22 px-4 gap-2 md:gap-4">
        {/* Now Playing Info - takes available space on mobile, fixed width on desktop */}
        <div className="flex items-center gap-3 flex-1 md:flex-none md:w-[30%] min-w-0">
          <NowPlayingInfo track={currentTrack} isEnded={isEnded} />
        </div>

        {/* Center Controls - hidden on mobile (moved to right), visible on desktop */}
        <div className="hidden md:flex flex-col items-center justify-center gap-1 flex-1 max-w-[40%]">
          <PlaybackControls hasTrack={hasTrack} playbackState={playbackState} />
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1 md:gap-2 md:w-[30%] justify-end">
          {/* Mobile-only playback controls - right aligned */}
          <div className="flex md:hidden items-center">
            <PlaybackControls
              hasTrack={hasTrack}
              playbackState={playbackState}
            />
          </div>
          {/* Queue button */}
          <QueueButton />
          {/* Desktop volume controls */}
          <VolumeControls />
          {/* Cast button - shows when Chromecast devices are available */}
          <CastButton />
          {/* Mobile more menu (includes queue, volume, etc.) */}
          <MobileMoreMenu />
          <FullscreenButton />
        </div>
      </div>
    </footer>
  );
}

// Loading skeleton for player bar - also used during SSR
export function PlayerBarSkeleton() {
  return (
    <footer
      data-testid="player-bar-skeleton"
      className={cn("relative z-50", "h-22 bg-background/95 backdrop-blur-lg")}
    >
      {/* Progress bar placeholder */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-muted" />

      <div className="flex items-center h-full px-4 gap-2 md:gap-4">
        {/* Now Playing Info - skeleton */}
        <div className="flex items-center gap-3 flex-1 md:flex-none md:w-[30%] min-w-0">
          <Skeleton className="w-14 h-14 rounded-md shrink-0" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="w-24 h-4" />
            <Skeleton className="w-16 h-3" />
          </div>
        </div>

        {/* Center Controls - hidden on mobile, visible on desktop */}
        <div className="hidden md:flex flex-col items-center justify-center gap-1 flex-1 max-w-[40%]">
          <div className="flex items-center gap-2">
            {/* Shuffle */}
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
              <Shuffle className="w-4 h-4" />
            </Button>
            {/* Previous */}
            <Button variant="ghost" size="icon" className="h-9 w-9" disabled>
              <SkipBack className="w-5 h-5" />
            </Button>
            {/* Play */}
            <Button
              variant="default"
              size="icon"
              className="h-10 w-10 rounded-full"
              disabled
            >
              <Play className="w-5 h-5 ml-0.5" />
            </Button>
            {/* Next */}
            <Button variant="ghost" size="icon" className="h-9 w-9" disabled>
              <SkipForward className="w-5 h-5" />
            </Button>
            {/* Repeat */}
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
              <Repeat className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1 md:gap-2 md:w-[30%] justify-end">
          {/* Mobile-only play button */}
          <Button
            variant="ghost"
            size="icon"
            className="flex md:hidden h-9 w-9 rounded-full"
            disabled
          >
            <Play className="w-4 h-4 ml-0.5" />
          </Button>
          {/* Queue */}
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
            <ListMusic className="w-4 h-4" />
          </Button>
          {/* Volume - desktop */}
          <div className="hidden md:flex items-center gap-2 w-32">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
              <Volume2 className="w-4 h-4" />
            </Button>
            <Slider value={[70]} max={100} className="flex-1" disabled />
          </div>
          {/* More - mobile */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden"
            disabled
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
          {/* Fullscreen - desktop */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:flex h-8 w-8"
            disabled
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </footer>
  );
}
