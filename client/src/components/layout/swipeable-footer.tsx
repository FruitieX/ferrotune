"use client";

import { ReactNode, useRef } from "react";
import {
  motion,
  animate,
  type PanInfo,
  type AnimationPlaybackControls,
} from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { fullscreenPlayerOpenAtom, fullscreenOpenDragY } from "@/lib/store/ui";
import { currentSongAtom } from "@/lib/store/server-queue";

// Module-level handle for the open animation so the fullscreen player
// can cancel it when the user dismisses during the opening spring.
let openAnimationControls: AnimationPlaybackControls | null = null;

/**
 * Cancel a pending fullscreen-open animation (if any).
 * Called by the fullscreen player when the user swipes down to dismiss
 * before the open animation has completed.
 */
export function cancelFullscreenOpen() {
  if (openAnimationControls) {
    openAnimationControls.stop();
    openAnimationControls = null;
  }
  fullscreenOpenDragY.set(0);
}

interface SwipeableFooterProps {
  children: ReactNode;
}

/**
 * Wrapper component for the footer (player bar + mobile nav) that enables
 * swipe-up gesture to open the fullscreen player on mobile.
 *
 * On small screens, the entire footer becomes a swipe target for opening
 * the fullscreen player. The footer stays in place while the fullscreen
 * player sheet slides up following the gesture.
 */
export function SwipeableFooter({ children }: SwipeableFooterProps) {
  const isSmallScreen = useIsSmallScreen();
  const currentTrack = useAtomValue(currentSongAtom);
  const setFullscreenOpen = useSetAtom(fullscreenPlayerOpenAtom);

  // Track if we're currently in an opening gesture
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const currentUpwardOffsetRef = useRef(0);

  // Thresholds for gesture detection
  const SWIPE_THRESHOLD = 50;
  const VELOCITY_THRESHOLD = 300;

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

  // Handle drag start
  const handleDragStart = (event: MouseEvent | TouchEvent | PointerEvent) => {
    if (openAnimationControls) {
      openAnimationControls.stop();
      openAnimationControls = null;
    }
    dragStartYRef.current = getPointerClientY(event);
    currentUpwardOffsetRef.current = 0;
    isDraggingRef.current = true;
  };

  // Handle drag updates - directly update the shared MotionValue
  const handleDrag = (
    event: MouseEvent | TouchEvent | PointerEvent,
    _info: PanInfo,
  ) => {
    const upwardOffset = Math.max(
      0,
      dragStartYRef.current - getPointerClientY(event),
    );
    currentUpwardOffsetRef.current = upwardOffset;

    // Directly set the shared motion value - no React re-renders.
    // Clamp downward return to 0 so dragging back down cannot leave the
    // fullscreen preview parked at an old upward position.
    fullscreenOpenDragY.set(-upwardOffset);
  };

  // Handle drag end to determine if we should open fullscreen
  const handleDragEnd = (
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    isDraggingRef.current = false;
    const { velocity } = info;
    const upwardOffset = Math.max(
      0,
      dragStartYRef.current - getPointerClientY(event),
    );
    currentUpwardOffsetRef.current = upwardOffset;
    const isCancellingOpen = velocity.y > VELOCITY_THRESHOLD;
    const shouldOpenFullscreen =
      !isCancellingOpen &&
      (upwardOffset > SWIPE_THRESHOLD ||
        (upwardOffset > 0 && velocity.y < -VELOCITY_THRESHOLD));

    if (shouldOpenFullscreen && currentTrack) {
      // Animate to fully open position then set state
      openAnimationControls = animate(
        fullscreenOpenDragY,
        -window.innerHeight,
        {
          type: "spring",
          stiffness: 400,
          damping: 35,
          onComplete: () => {
            openAnimationControls = null;
            setFullscreenOpen(true);
            // Reset immediately - the fullscreen player's animate prop uses instant
            // transition during gesture mode so this won't cause a visible animation
            fullscreenOpenDragY.set(0);
          },
        },
      );
    } else {
      // Snap back - animate the motion value back to 0
      animate(fullscreenOpenDragY, 0, {
        type: "spring",
        stiffness: 500,
        damping: 30,
      });
    }
    currentUpwardOffsetRef.current = 0;
  };

  // On large screens or when there's no track, render children directly
  if (!isSmallScreen || !currentTrack) {
    return <div className="shrink-0">{children}</div>;
  }

  // On small screens with a track, wrap in draggable container
  // The footer itself doesn't move - only the fullscreen player follows the gesture
  return (
    <motion.div
      className="shrink-0"
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.3, bottom: 0 }}
      dragDirectionLock
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      // Don't actually move the footer - just capture the gesture
      style={{ y: 0 }}
    >
      {children}
    </motion.div>
  );
}
