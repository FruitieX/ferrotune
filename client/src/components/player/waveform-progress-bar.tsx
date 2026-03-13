"use client";

import { useState, useRef, useEffect } from "react";
import { useAtomValue } from "jotai";
import { cn } from "@/lib/utils";
import {
  currentTimeAtom,
  durationAtom,
  playbackStateAtom,
  bufferedAtom,
} from "@/lib/store/player";
import { currentSongAtom } from "@/lib/store/server-queue";
import { accentColorRgbAtom } from "@/lib/store/ui";
import { useAudioEngine } from "@/lib/audio/hooks";
import { useWaveform } from "@/lib/hooks/use-waveform";
import { FLAT_BAR_HEIGHT } from "@/lib/store/waveform";
import { SimpleProgressBar } from "@/components/player/simple-progress-bar";

interface WaveformProgressBarProps {
  className?: string;
}

// Colors for different bar states
const COLORS = {
  buffered: { light: "#a1a1aa", dark: "#71717a" },
  unbuffered: { light: "#d4d4d8", dark: "#52525b" },
};

// Animation configuration
const WAVE_WIDTH = 0.15;
const PROGRESS_GAP = 0.4;
const ANIMATION_SPEED = 1;

// Bar sizing
const MIN_BAR_WIDTH = 2;
const BAR_GAP = 1;

/** Downsample source heights to target count by averaging bins */
function downsample(source: number[], targetCount: number): number[] {
  if (source.length === 0 || targetCount <= 0)
    return new Array(Math.max(0, targetCount)).fill(FLAT_BAR_HEIGHT);
  if (targetCount >= source.length) {
    const result = new Array(targetCount);
    for (let i = 0; i < targetCount; i++) {
      result[i] = source[Math.floor((i * source.length) / targetCount)];
    }
    return result;
  }
  const result = new Array(targetCount);
  const ratio = source.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.ceil((i + 1) * ratio), source.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += source[j];
    result[i] = sum / (end - start);
  }
  return result;
}

function calculateMaxBars(containerWidth: number): number {
  return Math.max(
    1,
    Math.floor((containerWidth + BAR_GAP) / (MIN_BAR_WIDTH + BAR_GAP)),
  );
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Stable empty array to avoid creating new references on each render
const EMPTY_HEIGHTS: number[] = [];

export function WaveformProgressBar({ className }: WaveformProgressBarProps) {
  const currentTrack = useAtomValue(currentSongAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const buffered = useAtomValue(bufferedAtom);
  const primaryColor = useAtomValue(accentColorRgbAtom);
  const { seekPercent } = useAudioEngine();
  const { heights: sourceHeights, isAvailable, isLoading } = useWaveform();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);

  // Animation state - simplified: just tracks wave positions and previous track's source data
  const anim = useRef({
    outProgress: 0,
    inProgress: 0,
    trackId: null as string | null,
    rafId: null as number | null,
    lastTime: 0,
    outgoingSource: [] as number[],
  });

  // Preserve previous track's source heights for outgoing animation
  const lastSourceRef = useRef<number[]>([]);
  // Ref for sourceHeights so draw() always has latest data without closure staleness
  const sourceHeightsRef = useRef<number[]>([]);

  const rawTrackId = currentTrack?.id ?? null;
  const isEnded = playbackState === "ended";
  const trackId = isEnded ? null : rawTrackId;

  // Use empty heights when playback has ended so we fade to flat bars
  const effectiveHeights = trackId ? sourceHeights : EMPTY_HEIGHTS;

  useEffect(() => {
    sourceHeightsRef.current = effectiveHeights;
  }, [effectiveHeights]);

  const smoothProgressRef = useRef(0);
  const progressRafRef = useRef<number | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const animateRef = useRef<(time: number) => void>(() => {});
  const atomProgress = isEnded
    ? 0
    : duration > 0
      ? (currentTime / duration) * 100
      : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  // Track container width — on resize, cancel any animation and redraw immediately
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let initialMeasure = true;
    const updateWidth = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      setContainerWidth(rect.width);
      if (!initialMeasure) {
        // Cancel animation on resize so waveform shows immediately
        const a = anim.current;
        if (a.rafId !== null) {
          cancelAnimationFrame(a.rafId);
          a.rafId = null;
        }
        a.outProgress = 0;
        a.inProgress = 0;
        a.lastTime = 0;
        drawRef.current();
      }
      initialMeasure = false;
    };
    updateWidth();
    const rafId = requestAnimationFrame(updateWidth);
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);
    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, []);

  // Detect dark mode
  useEffect(() => {
    const updateDarkMode = () => {
      setIsDarkMode(
        document.documentElement.classList.contains("dark") ||
          !document.documentElement.classList.contains("light"),
      );
    };
    updateDarkMode();
    const observer = new MutationObserver(updateDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Draw function - computes display heights from source data each frame
  // Reads sourceHeights from ref and computes barCount from actual container
  // width to avoid stale closure issues during resize.
  const draw = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const barCount = calculateMaxBars(rect.width);
    if (barCount === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const a = anim.current;
    const isAnimating = a.outProgress > 0 || a.inProgress > 0;
    const endPos = 1 + WAVE_WIDTH;
    const heights = sourceHeightsRef.current;

    // Compute display heights from source data (handles resize automatically)
    const incoming = downsample(heights, barCount);
    let displayHeights: number[];

    if (isAnimating) {
      const outgoing = downsample(a.outgoingSource, barCount);
      displayHeights = new Array(barCount);
      for (let i = 0; i < barCount; i++) {
        const barPos = i / barCount;

        let outT = 0;
        if (a.outProgress > 0 && a.outProgress < endPos) {
          outT = easeOutCubic(
            Math.max(0, Math.min(1, (a.outProgress - barPos) / WAVE_WIDTH)),
          );
        } else if (a.outProgress >= endPos) {
          outT = 1;
        }

        let inT = 0;
        if (a.inProgress > 0) {
          inT = easeOutCubic(
            Math.max(0, Math.min(1, (a.inProgress - barPos) / WAVE_WIDTH)),
          );
        }

        const afterOut = outgoing[i] * (1 - outT) + FLAT_BAR_HEIGHT * outT;
        displayHeights[i] = afterOut * (1 - inT) + incoming[i] * inT;
      }
    } else {
      displayHeights = incoming;
    }

    const totalGaps = Math.max(0, barCount - 1);
    const availableWidth = rect.width - totalGaps * BAR_GAP;
    const barWidth = Math.max(MIN_BAR_WIDTH, availableWidth / barCount);
    const centerY = rect.height / 2;

    const bufferedColor = isDarkMode
      ? COLORS.buffered.dark
      : COLORS.buffered.light;
    const unbufferedColor = isDarkMode
      ? COLORS.unbuffered.dark
      : COLORS.unbuffered.light;
    const progress = smoothProgressRef.current;
    const progressX = (progress / 100) * rect.width;
    const bufferedX = (bufferedPercent / 100) * rect.width;

    const drawBars = (color: string, clipX: number, clipWidth: number) => {
      if (clipWidth <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, 0, clipWidth, rect.height);
      ctx.clip();
      ctx.fillStyle = color;
      for (let i = 0; i < barCount; i++) {
        const x = i * (barWidth + BAR_GAP);
        const barHeight = Math.max(2, displayHeights[i] * rect.height);
        const y = centerY - barHeight / 2;
        ctx.beginPath();
        ctx.roundRect(
          x,
          y,
          barWidth,
          barHeight,
          Math.min(barWidth / 2, barHeight / 2, 2),
        );
        ctx.fill();
      }
      ctx.restore();
    };

    if (bufferedX < rect.width)
      drawBars(unbufferedColor, bufferedX, rect.width - bufferedX);
    if (bufferedX > progressX)
      drawBars(bufferedColor, progressX, bufferedX - progressX);
    if (progressX > 0) drawBars(primaryColor, 0, progressX);

    if (isHovering && hoverPercent !== null) {
      const x = (hoverPercent / 100) * rect.width;
      ctx.fillStyle = isDarkMode ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)";
      ctx.fillRect(x - 1.5, -4, 2, rect.height + 8);
    }
  };

  useEffect(() => {
    drawRef.current = draw;
  });

  // Animation loop
  useEffect(() => {
    animateRef.current = (time: number) => {
      const a = anim.current;
      const delta = a.lastTime === 0 ? 16 : time - a.lastTime;
      a.lastTime = time;

      const endPos = 1 + WAVE_WIDTH;
      const speed = (ANIMATION_SPEED * delta) / 1000;
      let changed = false;

      if (a.outProgress > 0 && a.outProgress < endPos) {
        a.outProgress = Math.min(endPos, a.outProgress + speed);
        changed = true;
      }

      if (a.inProgress === 0 && a.outProgress >= PROGRESS_GAP) {
        a.inProgress = 0.001;
      }

      if (a.inProgress > 0 && a.inProgress < endPos) {
        a.inProgress = Math.min(endPos, a.inProgress + speed);
        changed = true;
      }

      if (a.outProgress >= endPos && a.inProgress >= endPos) {
        a.outProgress = 0;
        a.inProgress = 0;
        a.rafId = null;
        a.lastTime = 0;
        drawRef.current();
        return;
      }

      if (changed) drawRef.current();
      a.rafId = requestAnimationFrame(animateRef.current);
    };
  });

  const startAnim = () => {
    const a = anim.current;
    if (a.rafId === null) {
      a.lastTime = 0;
      a.rafId = requestAnimationFrame(animateRef.current);
    }
  };

  // Handle track changes — animate crossfade between tracks
  // Skip animation on initial mount (show waveform immediately)
  const hasMountedRef = useRef(false);
  useEffect(() => {
    const a = anim.current;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      a.trackId = trackId;
      return;
    }
    if (trackId === a.trackId) return;

    a.outgoingSource = lastSourceRef.current;
    a.outProgress = 0.001;
    a.inProgress = 0;
    a.trackId = trackId;
    startAnim();
  }, [trackId]);

  // Keep lastSourceRef in sync with loaded waveform data
  useEffect(() => {
    if (sourceHeights.length > 0) {
      lastSourceRef.current = sourceHeights;
    }
  });

  // Cleanup
  useEffect(() => {
    const a = anim.current;
    return () => {
      if (a.rafId !== null) {
        cancelAnimationFrame(a.rafId);
        a.rafId = null;
      }
    };
  }, []);

  // Playback progress animation (separate from waveform height animation)
  // Use requestAnimationFrame for smooth visual updates, but get the actual
  // progress from atomProgress (which correctly handles transcoding time offsets)
  useEffect(() => {
    const isPlaying = playbackState === "playing";

    if (isPlaying) {
      const animateProgress = () => {
        // Use atomProgress which correctly accounts for stream time offset
        // when using timeOffset-based seeking with transcoding
        smoothProgressRef.current = atomProgress;
        drawRef.current();
        progressRafRef.current = requestAnimationFrame(animateProgress);
      };
      progressRafRef.current = requestAnimationFrame(animateProgress);
    } else {
      if (progressRafRef.current !== null) {
        cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = null;
      }
      smoothProgressRef.current = atomProgress;
      drawRef.current();
    }

    return () => {
      if (progressRafRef.current !== null) {
        cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = null;
      }
    };
  }, [playbackState, atomProgress]);

  // Redraw on visual changes, container resize, or new waveform data
  useEffect(() => {
    drawRef.current();
  }, [containerWidth, primaryColor, isDarkMode, effectiveHeights]);

  // Event handlers
  const getPercentFromEvent = (clientX: number) => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(100, ((clientX - rect.left) / rect.width) * 100),
    );
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    setIsDragging(true);
    const percent = getPercentFromEvent(e.clientX);
    setHoverPercent(percent);
    seekPercent(percent);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault(); // Prevent synthetic mouse events
    setIsDragging(true);
    setIsHovering(true);
    const percent = getPercentFromEvent(touch.clientX);
    setHoverPercent(percent);
    seekPercent(percent);
  };

  // Handle mouse/touch move during drag (global listeners)
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const percent = getPercentFromEvent(e.clientX);
      setHoverPercent(percent);
      seekPercent(percent);
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      e.preventDefault(); // Prevent scrolling during drag
      const percent = getPercentFromEvent(touch.clientX);
      setHoverPercent(percent);
      seekPercent(percent);
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    const handleGlobalTouchEnd = () => {
      setIsDragging(false);
      setIsHovering(false);
      setHoverPercent(null);
    };

    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    window.addEventListener("touchmove", handleGlobalTouchMove, {
      passive: false,
    });
    window.addEventListener("touchend", handleGlobalTouchEnd);
    window.addEventListener("touchcancel", handleGlobalTouchEnd);

    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
      window.removeEventListener("touchmove", handleGlobalTouchMove);
      window.removeEventListener("touchend", handleGlobalTouchEnd);
      window.removeEventListener("touchcancel", handleGlobalTouchEnd);
    };
  }, [isDragging, seekPercent]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPercent(
      Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
    );
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

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return hrs > 0
      ? `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
      : `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const hoverTime =
    hoverPercent !== null && duration > 0
      ? (hoverPercent / 100) * duration
      : null;
  const hasTrack =
    !!currentTrack && playbackState !== "idle" && playbackState !== "ended";
  const waveformHeight = 16;

  // Fall back to simple progress bar when no waveform data is available
  if (!isAvailable && !isLoading) {
    return <SimpleProgressBar className={className} />;
  }

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-label="Playback progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(atomProgress)}
      tabIndex={hasTrack ? 0 : -1}
      className={cn(
        "absolute left-0 right-0 cursor-pointer overflow-visible",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        !hasTrack && "opacity-50 cursor-default",
        isDragging && "cursor-grabbing",
        className,
      )}
      style={{
        top: `-${waveformHeight / 2}px`,
        height: `${waveformHeight}px`,
        zIndex: 10,
      }}
      onMouseDown={hasTrack ? handleMouseDown : undefined}
      onTouchStart={hasTrack ? handleTouchStart : undefined}
      onKeyDown={hasTrack ? handleKeyDown : undefined}
      onMouseMove={hasTrack && !isDragging ? handleMouseMove : undefined}
      onMouseEnter={hasTrack ? () => setIsHovering(true) : undefined}
      onMouseLeave={() => {
        if (!isDragging) {
          setIsHovering(false);
          setHoverPercent(null);
        }
      }}
    >
      <div className="absolute inset-0 -top-2 -bottom-2" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: "pixelated" }}
      />
      {(isHovering || isDragging) &&
        hoverPercent !== null &&
        hoverTime !== null && (
          <div
            className="absolute bottom-full mb-2 px-2 py-1 text-xs font-medium rounded bg-popover text-popover-foreground shadow-md border border-border whitespace-nowrap pointer-events-none"
            style={{ left: `${hoverPercent}%`, transform: "translateX(-50%)" }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
    </div>
  );
}
