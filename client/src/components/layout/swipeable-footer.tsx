"use client";

import { ReactNode, useRef } from "react";
import { motion, animate, type PanInfo } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { fullscreenPlayerOpenAtom, fullscreenOpenDragY } from "@/lib/store/ui";
import { currentSongAtom } from "@/lib/store/server-queue";

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

  // Thresholds for gesture detection
  const SWIPE_THRESHOLD = 50;
  const VELOCITY_THRESHOLD = 300;

  // Handle drag start
  const handleDragStart = () => {
    isDraggingRef.current = true;
  };

  // Handle drag updates - directly update the shared MotionValue
  const handleDrag = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    // Only update for upward drags (negative offset)
    if (info.offset.y < 0) {
      // Directly set the shared motion value - no React re-renders
      fullscreenOpenDragY.set(info.offset.y);
    }
  };

  // Handle drag end to determine if we should open fullscreen
  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    isDraggingRef.current = false;
    const { offset, velocity } = info;
    const shouldOpenFullscreen =
      offset.y < -SWIPE_THRESHOLD || velocity.y < -VELOCITY_THRESHOLD;

    if (shouldOpenFullscreen && currentTrack) {
      // Animate to fully open position then set state
      animate(fullscreenOpenDragY, -window.innerHeight, {
        type: "spring",
        stiffness: 400,
        damping: 35,
        onComplete: () => {
          setFullscreenOpen(true);
          // Reset after fullscreen takes over (it will animate from 0)
          setTimeout(() => fullscreenOpenDragY.set(0), 50);
        },
      });
    } else {
      // Snap back - animate the motion value back to 0
      animate(fullscreenOpenDragY, 0, {
        type: "spring",
        stiffness: 500,
        damping: 30,
      });
    }
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
