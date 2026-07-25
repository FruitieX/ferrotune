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
import { PROGRESS_UPDATE_INTERVAL_MS } from "@/components/player/progress-constants";

interface SimpleProgressBarProps {
  className?: string;
  active?: boolean;
}

export function SimpleProgressBar({
  className,
  active = true,
}: SimpleProgressBarProps) {
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
  const progressIndicatorRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const isEnded = playbackState === "ended";
  const atomProgress = isEnded
    ? 0
    : duration > 0
      ? (currentTime / duration) * 100
      : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  // Progress is painted by CSS. Keep the latest values in refs so the timer
  // does not need to restart on every audio timeupdate.
  const smoothProgressRef = useRef<number>(0);
  const atomProgressRef = useRef(atomProgress);
  const durationRef = useRef(duration);
  const remoteControllingRef = useRef(isRemoteControlling);

  const hoverTime =
    hoverPercent !== null && duration > 0
      ? (hoverPercent / 100) * duration
      : null;

  useEffect(() => {
    atomProgressRef.current = atomProgress;
    durationRef.current = duration;
    remoteControllingRef.current = isRemoteControlling;
  }, [atomProgress, duration, isRemoteControlling]);

  // Update the CSS progress value at a modest rate. The CSS transition on the
  // indicator fills the gap between timer ticks without React renders.
  useEffect(() => {
    if (!active) return;

    const updateProgress = () => {
      const isPlaying = playbackState === "playing";
      let nextProgress = atomProgressRef.current;

      if (isPlaying && !hasNativeAudio() && !remoteControllingRef.current) {
        const audio = getGlobalAudio();
        const audioTime = audio
          ? audio.currentTime + getCurrentStreamTimeOffset()
          : 0;
        if (audio && durationRef.current > 0 && Number.isFinite(audioTime)) {
          nextProgress = Math.max(
            0,
            Math.min(100, (audioTime / durationRef.current) * 100),
          );
        }
      }

      smoothProgressRef.current = nextProgress;
      progressIndicatorRef.current?.style.setProperty(
        "--progress-percent",
        `${nextProgress}%`,
      );
    };

    updateProgress();
    if (playbackState !== "playing") return;

    const interval = window.setInterval(
      updateProgress,
      PROGRESS_UPDATE_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [active, playbackState]);

  useEffect(() => {
    if (!active || playbackState === "playing") return;

    smoothProgressRef.current = atomProgress;
    progressIndicatorRef.current?.style.setProperty(
      "--progress-percent",
      `${atomProgress}%`,
    );
  }, [active, atomProgress, playbackState]);

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
      data-playback-progress-control="true"
      aria-label="Playback progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(atomProgress)}
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
      onPointerDown={(event) => event.stopPropagation()}
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
        currentPercent={atomProgress}
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
          ref={progressIndicatorRef}
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-linear"
          style={{
            width: "var(--progress-percent, 0%)",
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
