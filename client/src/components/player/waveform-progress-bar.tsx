"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
import { lastChunkInfoAtom } from "@/lib/store/waveform";
import { useAudioEngine, getGlobalAudio } from "@/lib/audio/hooks";
import { useWaveform } from "@/lib/hooks/use-waveform";
import { FLAT_BAR_HEIGHT } from "@/lib/store/waveform";

interface WaveformProgressBarProps {
  className?: string;
}

// Colors for different bar states
const COLORS = {
  buffered: { light: "#a1a1aa", dark: "#71717a" },
  unbuffered: { light: "#d4d4d8", dark: "#52525b" },
};

// Animation configuration
const WAVE_WIDTH = 0.15; // Width of transition wave (fraction of total)
const PROGRESS_GAP = 0.4; // Gap between outgoing and incoming (fraction of total)
const ANIMATION_SPEED = 0.5; // Progress per second (0.5 = 2 seconds for full animation)
const TARGET_CHUNK_BUFFER = 3; // Aim to stay 2-4 chunks behind the data
const MIN_CHUNK_BUFFER = 2; // Minimum chunks ahead before continuing
const MAX_CHUNK_BUFFER = 4; // Maximum chunks ahead before speeding up
const NORMALIZATION_LERP_SPEED = 0.05; // Speed of height normalization adjustment per frame

// Bar sizing
const MIN_BAR_WIDTH = 2;
const BAR_GAP = 1;

function downsampleHeights(
  heights: number[],
  sourceCount: number,
  targetCount: number,
): number[] {
  if (targetCount >= sourceCount) return heights.slice(0, targetCount);
  const result = new Array(targetCount);
  const ratio = sourceCount / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const startIdx = Math.floor(i * ratio);
    const endIdx = Math.min(Math.ceil((i + 1) * ratio), sourceCount);
    let sum = 0,
      count = 0;
    for (let j = startIdx; j < endIdx; j++) {
      sum += heights[j] ?? FLAT_BAR_HEIGHT;
      count++;
    }
    result[i] = count > 0 ? sum / count : FLAT_BAR_HEIGHT;
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

export function WaveformProgressBar({ className }: WaveformProgressBarProps) {
  const currentTrack = useAtomValue(currentSongAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const buffered = useAtomValue(bufferedAtom);
  const primaryColor = useAtomValue(accentColorRgbAtom);
  const lastChunkInfo = useAtomValue(lastChunkInfoAtom);
  const { seekPercent } = useAudioEngine();
  const {
    heights: sourceHeights,
    barCount: sourceBarCount,
    isLoaded,
  } = useWaveform();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0); // Start at 0, update on mount

  // Animation state in a single ref object for atomic updates
  const anim = useRef({
    // Visual heights for each bar
    heights: null as Float32Array | null,
    // Target heights for incoming/outgoing (smoothly lerped)
    incoming: null as Float32Array | null,
    outgoing: null as Float32Array | null,
    // Wave positions (0-1+, where > 1 means past the end)
    inProgress: 0,
    outProgress: 0,
    // Data tracking - chunk-based
    receivedChunks: 0,
    lastChunkEndIndex: 0, // Track last chunk's end index
    loadComplete: false,
    // Current track
    trackId: null as string | null,
    // RAF state
    rafId: null as number | null,
    lastTime: 0,
  });

  // Playback progress (separate from waveform animation)
  const smoothProgressRef = useRef(0);
  const progressRafRef = useRef<number | null>(null);

  // Derived values - handle zero width gracefully during SSR and before mount
  const displayBarCount = useMemo(() => {
    if (containerWidth === 0) return sourceBarCount; // Use source count until measured
    const maxBars = calculateMaxBars(containerWidth);
    return Math.min(maxBars, sourceBarCount);
  }, [containerWidth, sourceBarCount]);

  const heights = useMemo(() => {
    return downsampleHeights(sourceHeights, sourceBarCount, displayBarCount);
  }, [sourceHeights, sourceBarCount, displayBarCount]);

  const trackId = currentTrack?.id ?? null;
  const isEnded = playbackState === "ended";
  const atomProgress = isEnded
    ? 0
    : duration > 0
      ? (currentTime / duration) * 100
      : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  // Ensure buffers are correctly sized
  useEffect(() => {
    const a = anim.current;
    if (!a.heights || a.heights.length !== displayBarCount) {
      a.heights = new Float32Array(displayBarCount).fill(FLAT_BAR_HEIGHT);
      a.incoming = new Float32Array(displayBarCount).fill(FLAT_BAR_HEIGHT);
      a.outgoing = new Float32Array(displayBarCount).fill(FLAT_BAR_HEIGHT);
    }
  }, [displayBarCount]);

  // Track container width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0) setContainerWidth(rect.width);
    };
    // Initial measurement
    updateWidth();
    // Use requestAnimationFrame to ensure layout is complete
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

  // Draw function
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const a = anim.current;
    if (!canvas || !container || !a.heights) return;

    const rect = container.getBoundingClientRect();
    // Don't render if container has no size yet (prevents wrong initial render)
    if (rect.width === 0 || rect.height === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width * dpr;
    const height = rect.height * dpr;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const barCount = a.heights.length;
    const totalGaps = Math.max(0, barCount - 1);
    const availableWidth = rect.width - totalGaps * BAR_GAP;
    const barWidth =
      barCount > 0
        ? Math.max(MIN_BAR_WIDTH, availableWidth / barCount)
        : MIN_BAR_WIDTH;
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
        const barHeight = Math.max(
          2,
          (a.heights![i] ?? FLAT_BAR_HEIGHT) * rect.height,
        );
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
  }, [isDarkMode, bufferedPercent, primaryColor, isHovering, hoverPercent]);

  // Update heights based on wave positions
  const updateHeights = useCallback(() => {
    const a = anim.current;
    if (!a.heights || !a.incoming || !a.outgoing) return;

    const barCount = a.heights.length;
    const endPos = 1 + WAVE_WIDTH;

    for (let i = 0; i < barCount; i++) {
      const barPos = i / barCount;

      // Calculate outgoing wave effect (fading to flat)
      let outT = 0; // 0 = original height, 1 = flat
      if (a.outProgress > 0 && a.outProgress < endPos) {
        const waveT = (a.outProgress - barPos) / WAVE_WIDTH;
        outT = easeOutCubic(Math.max(0, Math.min(1, waveT)));
      } else if (a.outProgress >= endPos) {
        outT = 1; // Fully faded to flat
      }

      // Calculate incoming wave effect (fading from flat to target)
      let inT = 0; // 0 = flat, 1 = target height
      if (a.inProgress > 0) {
        const waveT = (a.inProgress - barPos) / WAVE_WIDTH;
        inT = easeOutCubic(Math.max(0, Math.min(1, waveT)));
      }

      // Blend both effects: outgoing fades to flat, incoming fades from flat
      // Start from outgoing height, fade toward flat, then from flat toward incoming
      const outHeight = a.outgoing[i];
      const inHeight = a.incoming[i];

      // outT: 0 = outgoing visible, 1 = flat
      // inT: 0 = flat, 1 = incoming visible
      // Result: lerp(lerp(outHeight, FLAT, outT), inHeight, inT)
      const afterOut = outHeight * (1 - outT) + FLAT_BAR_HEIGHT * outT;
      a.heights[i] = afterOut * (1 - inT) + inHeight * inT;
    }
  }, []);

  // Animation loop
  const animate = useCallback(
    (time: number) => {
      const a = anim.current;
      const delta = a.lastTime === 0 ? 16 : time - a.lastTime;
      a.lastTime = time;

      const barCount = a.heights?.length ?? 0;
      if (barCount === 0) {
        a.rafId = requestAnimationFrame(animate);
        return;
      }

      const endPos = 1 + WAVE_WIDTH;
      const speed = (ANIMATION_SPEED * delta) / 1000;
      let changed = false;

      // Advance outgoing wave
      if (a.outProgress > 0 && a.outProgress < endPos) {
        a.outProgress = Math.min(endPos, a.outProgress + speed);
        changed = true;
      }

      // Start incoming when outgoing has advanced enough AND we have sufficient data buffered
      // Use chunk-based buffer: need at least MIN_CHUNK_BUFFER chunks
      const hasEnoughData =
        a.loadComplete || a.receivedChunks >= MIN_CHUNK_BUFFER;
      if (
        a.inProgress === 0 &&
        hasEnoughData &&
        a.outProgress >= PROGRESS_GAP
      ) {
        a.inProgress = 0.001;
      }

      // Advance incoming wave
      if (a.inProgress > 0 && a.inProgress < endPos) {
        // Calculate how far we can animate based on chunk buffer
        const dataProgress = a.lastChunkEndIndex / barCount;

        // Adaptive speed based on chunk buffer
        let inSpeed = speed;
        if (a.loadComplete) {
          // All data loaded - animate at full speed
          inSpeed = speed;
        } else {
          // Calculate chunks ahead of animation
          const animatedBarIndex = a.inProgress * barCount;
          const chunksAhead =
            a.receivedChunks -
            Math.floor(
              (animatedBarIndex / a.lastChunkEndIndex) * a.receivedChunks,
            );

          if (chunksAhead < MIN_CHUNK_BUFFER) {
            // Too close to data edge - pause/very slow
            inSpeed *= 0.05;
          } else if (chunksAhead < TARGET_CHUNK_BUFFER) {
            // Below target - slow down
            inSpeed *= 0.3;
          } else if (chunksAhead > MAX_CHUNK_BUFFER) {
            // Too far ahead - speed up
            inSpeed *= 1.5;
          }
          // else: in sweet spot, use base speed
        }

        // Only advance if we have data ahead or loading is complete
        const maxProgress = a.loadComplete ? endPos : dataProgress;
        if (a.inProgress < maxProgress || a.loadComplete) {
          a.inProgress = Math.min(endPos, a.inProgress + inSpeed);
          changed = true;
        }
      }

      // Check if done - both waves must have completed their full animation
      const outComplete = a.outProgress >= endPos;
      const inComplete = a.inProgress >= endPos;

      // Only stop when both are complete (or outgoing was never started, which shouldn't happen)
      if (outComplete && inComplete) {
        // Reset for next track change
        a.outProgress = 0;
        a.rafId = null;
        a.lastTime = 0;
        return;
      }

      if (changed) {
        updateHeights();
        draw();
      }

      a.rafId = requestAnimationFrame(animate);
    },
    [updateHeights, draw],
  );

  // Start animation
  const startAnim = useCallback(() => {
    const a = anim.current;
    if (a.rafId === null) {
      a.lastTime = 0;
      a.rafId = requestAnimationFrame(animate);
    }
  }, [animate]);

  // Handle track changes
  useEffect(() => {
    const a = anim.current;

    if (trackId !== a.trackId) {
      // Save current heights for outgoing animation
      if (a.heights && a.outgoing) {
        a.outgoing.set(a.heights);
      }

      // Start outgoing wave
      a.outProgress = 0.001;

      // Reset incoming
      a.inProgress = 0;
      if (a.incoming) a.incoming.fill(FLAT_BAR_HEIGHT);

      // Reset data tracking
      a.receivedChunks = 0;
      a.lastChunkEndIndex = 0;
      a.loadComplete = false;

      a.trackId = trackId;
      startAnim();
    }
  }, [trackId, startAnim]);

  // Update incoming heights when data arrives - smooth lerp to avoid jarring changes
  useEffect(() => {
    const a = anim.current;
    if (!a.incoming || trackId !== a.trackId) return;

    // Smoothly lerp incoming heights toward new target heights
    // This prevents jarring stutters from normalization changes
    const lerpToNewHeights = () => {
      if (!a.incoming) return;

      let hasChanges = false;
      for (let i = 0; i < displayBarCount; i++) {
        const target = heights[i] ?? FLAT_BAR_HEIGHT;
        const current = a.incoming[i];
        const diff = target - current;

        if (Math.abs(diff) > 0.001) {
          a.incoming[i] = current + diff * NORMALIZATION_LERP_SPEED;
          hasChanges = true;
        } else {
          a.incoming[i] = target;
        }
      }

      if (hasChanges && a.rafId !== null) {
        // Request redraw if animation is active
        requestAnimationFrame(() => {
          const a2 = anim.current;
          if (!a2.heights || !a2.incoming || !a2.outgoing) return;

          for (let i = 0; i < displayBarCount; i++) {
            const barPos = i / displayBarCount;
            const endPos = 1 + WAVE_WIDTH;

            let outT = 0;
            if (a2.outProgress > 0 && a2.outProgress < endPos) {
              const waveT = (a2.outProgress - barPos) / WAVE_WIDTH;
              outT = easeOutCubic(Math.max(0, Math.min(1, waveT)));
            } else if (a2.outProgress >= endPos) {
              outT = 1;
            }

            let inT = 0;
            if (a2.inProgress > 0) {
              const waveT = (a2.inProgress - barPos) / WAVE_WIDTH;
              inT = easeOutCubic(Math.max(0, Math.min(1, waveT)));
            }

            const outHeight = a2.outgoing[i];
            const inHeight = a2.incoming[i];
            const afterOut = outHeight * (1 - outT) + FLAT_BAR_HEIGHT * outT;
            a2.heights[i] = afterOut * (1 - inT) + inHeight * inT;
          }
        });
      }
    };

    // Start lerping
    const lerpInterval = setInterval(lerpToNewHeights, 16);
    return () => clearInterval(lerpInterval);
  }, [heights, displayBarCount, trackId]);

  // Handle chunk arrivals
  useEffect(() => {
    if (!lastChunkInfo) return;

    const a = anim.current;
    const ratio = sourceBarCount / displayBarCount;

    // Track chunk count (chunks arrive approximately every 30 seconds of audio)
    if (lastChunkInfo.endIndex > a.lastChunkEndIndex) {
      a.receivedChunks++;
      a.lastChunkEndIndex = Math.ceil(lastChunkInfo.endIndex / ratio);
    }

    a.loadComplete = isLoaded || lastChunkInfo.endIndex >= sourceBarCount - 1;

    // Kickstart incoming if we have enough chunks buffered
    const hasEnoughData =
      a.loadComplete || a.receivedChunks >= MIN_CHUNK_BUFFER;
    if (hasEnoughData && a.inProgress === 0) {
      if (a.outProgress === 0 || a.outProgress >= PROGRESS_GAP) {
        a.inProgress = 0.001;
      }
    }

    startAnim();
  }, [lastChunkInfo, sourceBarCount, displayBarCount, isLoaded, startAnim]);

  // Cleanup
  useEffect(() => {
    return () => {
      const a = anim.current;
      if (a.rafId !== null) {
        cancelAnimationFrame(a.rafId);
        a.rafId = null;
      }
    };
  }, []);

  // Playback progress animation (separate from waveform height animation)
  useEffect(() => {
    const isPlaying = playbackState === "playing";

    if (isPlaying) {
      const animateProgress = () => {
        const audio = getGlobalAudio();
        if (audio && audio.duration > 0) {
          smoothProgressRef.current =
            (audio.currentTime / audio.duration) * 100;
        } else {
          smoothProgressRef.current = atomProgress;
        }
        draw();
        progressRafRef.current = requestAnimationFrame(animateProgress);
      };
      progressRafRef.current = requestAnimationFrame(animateProgress);
    } else {
      if (progressRafRef.current !== null) {
        cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = null;
      }
      smoothProgressRef.current = atomProgress;
      draw();
    }

    return () => {
      if (progressRafRef.current !== null) {
        cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = null;
      }
    };
  }, [playbackState, atomProgress, draw]);

  // Redraw on visual changes or container resize
  useEffect(() => {
    draw();
  }, [draw, containerWidth]);

  // Event handlers
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      seekPercent(((e.clientX - rect.left) / rect.width) * 100);
    },
    [seekPercent],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPercent(
      Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
    );
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 10 : 2;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seekPercent(Math.min(100, smoothProgressRef.current + step));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekPercent(Math.max(0, smoothProgressRef.current - step));
      }
    },
    [seekPercent],
  );

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

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-label="Playback progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(smoothProgressRef.current)}
      tabIndex={hasTrack ? 0 : -1}
      className={cn(
        "absolute left-0 right-0 cursor-pointer overflow-visible",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        !hasTrack && "opacity-50 cursor-default",
        className,
      )}
      style={{
        top: `-${waveformHeight / 2}px`,
        height: `${waveformHeight}px`,
        zIndex: 100,
      }}
      onClick={hasTrack ? handleClick : undefined}
      onKeyDown={hasTrack ? handleKeyDown : undefined}
      onMouseMove={hasTrack ? handleMouseMove : undefined}
      onMouseEnter={hasTrack ? () => setIsHovering(true) : undefined}
      onMouseLeave={() => {
        setIsHovering(false);
        setHoverPercent(null);
      }}
    >
      <div className="absolute inset-0 -top-2 -bottom-2" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: "pixelated" }}
      />
      {isHovering && hoverPercent !== null && hoverTime !== null && (
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
