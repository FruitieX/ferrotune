"use client";

import { useRef, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { cn } from "@/lib/utils";
import { hapticConfirm } from "@/lib/utils/haptic";
import {
  currentTimeAtom,
  durationAtom,
  playbackStateAtom,
  bufferedAtom,
} from "@/lib/store/player";
import { currentSongAtom } from "@/lib/store/server-queue";
import {
  accentColorRgbAtom,
  progressTimeLabelVisibilityAtom,
} from "@/lib/store/ui";
import { useAudioEngine, getGlobalAudio } from "@/lib/audio/hooks";
import { getCurrentStreamTimeOffset } from "@/lib/audio/seeking-control";
import { hasNativeAudio } from "@/lib/tauri";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { isRemoteControllingAtom } from "@/lib/store/session";
import { ProgressTimeOverlay } from "@/components/player/progress-time-overlay";
import { formatDuration } from "@/lib/utils/format";

interface SimpleProgressBarProps {
  className?: string;
}

export function SimpleProgressBar({ className }: SimpleProgressBarProps) {
  const currentTrack = useAtomValue(currentSongAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const buffered = useAtomValue(bufferedAtom);
  const primaryColor = useAtomValue(accentColorRgbAtom);
  const progressTimeLabelVisibility = useAtomValue(
    progressTimeLabelVisibilityAtom,
  );
  const { seekPercent } = useAudioEngine();
  const isRemoteControlling = useAtomValue(isRemoteControllingAtom);

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Smooth progress tracking
  const smoothProgressRef = useRef<number>(0);
  const progressAnimationRef = useRef<number | null>(null);
  const [displayProgress, setDisplayProgress] = useState(0);

  const isEnded = playbackState === "ended";
  const atomProgress = isEnded
    ? 0
    : duration > 0
      ? (currentTime / duration) * 100
      : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  const hoverTime =
    hoverPercent !== null && duration > 0
      ? (hoverPercent / 100) * duration
      : null;

  // Smooth progress animation loop
  useEffect(() => {
    const isPlaying = playbackState === "playing";
    const isNative = hasNativeAudio();

    if (isPlaying) {
      const animateProgress = () => {
        if (isNative || isRemoteControlling) {
          // Native audio and remote controlling: use atom-based progress
          smoothProgressRef.current = atomProgress;
        } else {
          const audio = getGlobalAudio();
          const audioTime = audio
            ? audio.currentTime + getCurrentStreamTimeOffset()
            : 0;
          if (audio && duration > 0 && Number.isFinite(audioTime)) {
            smoothProgressRef.current = Math.max(
              0,
              Math.min(100, (audioTime / duration) * 100),
            );
          } else {
            smoothProgressRef.current = atomProgress;
          }
        }
        setDisplayProgress(smoothProgressRef.current);
        progressAnimationRef.current = requestAnimationFrame(animateProgress);
      };

      progressAnimationRef.current = requestAnimationFrame(animateProgress);
    } else {
      if (progressAnimationRef.current !== null) {
        cancelAnimationFrame(progressAnimationRef.current);
        progressAnimationRef.current = null;
      }
      smoothProgressRef.current = atomProgress;
      // Schedule the update via RAF to avoid synchronous setState in effect
      progressAnimationRef.current = requestAnimationFrame(() => {
        setDisplayProgress(atomProgress);
        progressAnimationRef.current = null;
      });
    }

    return () => {
      if (progressAnimationRef.current !== null) {
        cancelAnimationFrame(progressAnimationRef.current);
        progressAnimationRef.current = null;
      }
    };
  }, [playbackState, atomProgress, duration, isRemoteControlling]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    hapticConfirm();
    seekPercent(percent);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    setHoverPercent(Math.max(0, Math.min(100, percent)));
  };

  const handleMouseEnter = () => {
    setIsHovering(true);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    setHoverPercent(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      seekPercent(Math.min(100, smoothProgressRef.current + step));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekPercent(Math.max(0, smoothProgressRef.current - step));
    }
  };

  const hasTrack =
    !!currentTrack && playbackState !== "idle" && playbackState !== "ended";
  const isSmallScreen = useIsSmallScreen();
  const barHeight = isSmallScreen ? 8 : 4; // pixels
  const displayTime = isEnded ? 0 : currentTime;
  const displayDuration = isEnded ? 0 : duration;
  const timeOverlayVisible = hasTrack && (isHovering || isFocused);

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-label="Playback progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(displayProgress)}
      aria-valuetext={`${formatDuration(displayTime)} of ${formatDuration(displayDuration)}`}
      tabIndex={hasTrack ? 0 : -1}
      className={cn(
        "absolute left-0 right-0 cursor-pointer group",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        !hasTrack && "opacity-50 cursor-default",
        className,
      )}
      style={{
        top: `-${barHeight / 2}px`,
        height: `${barHeight}px`,
        zIndex: 100,
      }}
      onClick={hasTrack ? handleClick : undefined}
      onKeyDown={hasTrack ? handleKeyDown : undefined}
      onFocus={hasTrack ? () => setIsFocused(true) : undefined}
      onBlur={() => setIsFocused(false)}
      onMouseMove={hasTrack ? handleMouseMove : undefined}
      onMouseEnter={hasTrack ? handleMouseEnter : undefined}
      onMouseLeave={handleMouseLeave}
    >
      {/* Expand click target area */}
      <div className="absolute inset-0 -top-3 -bottom-3" />

      <ProgressTimeOverlay
        currentTime={displayTime}
        currentPercent={displayProgress}
        duration={displayDuration}
        scrubPercent={hoverPercent}
        scrubTime={hoverTime}
        hasTrack={hasTrack}
        interactionVisible={timeOverlayVisible}
        currentLabelVisibility={progressTimeLabelVisibility}
      />

      {/* Background track */}
      <div className="absolute inset-0 rounded-full bg-muted/50 overflow-hidden">
        {/* Buffered indicator */}
        <div
          className="absolute inset-y-0 left-0 bg-muted transition-[width] duration-300"
          style={{ width: `${bufferedPercent}%` }}
        />

        {/* Progress indicator */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${displayProgress}%`,
            backgroundColor: primaryColor,
          }}
        />
      </div>

      {/* Hover indicator line */}
      {isHovering && hoverPercent !== null && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 md:h-3 bg-foreground/80 pointer-events-none"
          style={{ left: `${hoverPercent}%` }}
        />
      )}
    </div>
  );
}
