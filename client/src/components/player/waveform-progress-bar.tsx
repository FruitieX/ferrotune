"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useAtomValue } from "jotai";
import { cn } from "@/lib/utils";
import { currentTimeAtom, durationAtom, playbackStateAtom, bufferedAtom } from "@/lib/store/player";
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
  buffered: { light: "#a1a1aa", dark: "#71717a" }, // zinc-400 / zinc-500
  unbuffered: { light: "#d4d4d8", dark: "#52525b" }, // zinc-300 / zinc-600
};

// Animation configuration
const ANIMATION_DURATION_MS = 600;
const ANIMATION_STAGGER_MS = 3; // Stagger per bar for full track change
const CHUNK_FADE_DURATION_MS = 300; // Duration for chunk fade-in animation
const CHUNK_STAGGER_TOTAL_MS = 150; // Total stagger spread across a chunk

// Bar sizing constraints
const MIN_BAR_WIDTH = 2; // Minimum width per bar in pixels
const BAR_GAP = 1; // Gap between bars in pixels

/**
 * Downsample waveform heights array by averaging adjacent bars.
 * This ensures playback position still aligns correctly with visual bars.
 */
function downsampleHeights(heights: number[], sourceCount: number, targetCount: number): number[] {
  if (targetCount >= sourceCount) {
    return heights.slice(0, targetCount);
  }
  
  const result = new Array(targetCount);
  const ratio = sourceCount / targetCount;
  
  for (let i = 0; i < targetCount; i++) {
    // Map target bar to source range
    const sourceStart = i * ratio;
    const sourceEnd = (i + 1) * ratio;
    
    // Average the source bars that fall within this target bar's range
    const startIdx = Math.floor(sourceStart);
    const endIdx = Math.min(Math.ceil(sourceEnd), sourceCount);
    
    let sum = 0;
    let count = 0;
    for (let j = startIdx; j < endIdx; j++) {
      sum += heights[j] ?? FLAT_BAR_HEIGHT;
      count++;
    }
    
    result[i] = count > 0 ? sum / count : FLAT_BAR_HEIGHT;
  }
  
  return result;
}

/**
 * Calculate maximum number of bars that can fit in a given width.
 */
function calculateMaxBars(containerWidth: number): number {
  // Each bar needs MIN_BAR_WIDTH + BAR_GAP (except last bar doesn't need gap after it)
  // containerWidth = n * MIN_BAR_WIDTH + (n-1) * BAR_GAP
  // containerWidth = n * MIN_BAR_WIDTH + n * BAR_GAP - BAR_GAP
  // containerWidth + BAR_GAP = n * (MIN_BAR_WIDTH + BAR_GAP)
  // n = (containerWidth + BAR_GAP) / (MIN_BAR_WIDTH + BAR_GAP)
  const maxBars = Math.floor((containerWidth + BAR_GAP) / (MIN_BAR_WIDTH + BAR_GAP));
  return Math.max(1, maxBars);
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
  const { heights: sourceHeights, barCount: sourceBarCount } = useWaveform();
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [containerWidth, setContainerWidth] = useState(600); // Default to a reasonable width
  
  // Calculate how many bars we can display based on container width
  const displayBarCount = useMemo(() => {
    const maxBars = calculateMaxBars(containerWidth);
    // Don't use more bars than we have data for
    return Math.min(maxBars, sourceBarCount);
  }, [containerWidth, sourceBarCount]);
  
  // Downsample heights to match display bar count
  const heights = useMemo(() => {
    return downsampleHeights(sourceHeights, sourceBarCount, displayBarCount);
  }, [sourceHeights, sourceBarCount, displayBarCount]);
  
  // Use displayBarCount for rendering
  const barCount = displayBarCount;
  
  // Track container width with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const updateWidth = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0) {
        setContainerWidth(rect.width);
      }
    };
    
    // Initial measurement
    updateWidth();
    
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);
    
    return () => resizeObserver.disconnect();
  }, []);
  
  // Smooth progress tracking - read directly from audio element for 60fps updates
  const smoothProgressRef = useRef<number>(0);
  const progressAnimationRef = useRef<number | null>(null);
  
  // Format time as h:mm:ss or mm:ss depending on duration
  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };
  
  // Calculate hover time
  const hoverTime = hoverPercent !== null && duration > 0 
    ? (hoverPercent / 100) * duration 
    : null;
  
  // Animation state for bar heights - use refs that we resize as needed
  const animatedHeightsRef = useRef<Float32Array | null>(null);
  const targetHeightsRef = useRef<Float32Array | null>(null);
  const startHeightsRef = useRef<Float32Array | null>(null);
  const barAnimationStartRef = useRef<Float32Array | null>(null);
  const barAnimationFrameRef = useRef<number | null>(null);
  const drawWaveformRef = useRef<((progress: number) => void) | null>(null);
  const prevBarCountRef = useRef<number>(0);
  
  // Resize animation buffers when bar count changes
  if (barCount !== prevBarCountRef.current) {
    animatedHeightsRef.current = new Float32Array(barCount).fill(FLAT_BAR_HEIGHT);
    targetHeightsRef.current = new Float32Array(barCount).fill(FLAT_BAR_HEIGHT);
    startHeightsRef.current = new Float32Array(barCount).fill(FLAT_BAR_HEIGHT);
    barAnimationStartRef.current = new Float32Array(barCount).fill(0);
    prevBarCountRef.current = barCount;
  }
  
  // Ensure buffers exist (for initial render)
  if (!animatedHeightsRef.current) {
    animatedHeightsRef.current = new Float32Array(barCount).fill(FLAT_BAR_HEIGHT);
    targetHeightsRef.current = new Float32Array(barCount).fill(FLAT_BAR_HEIGHT);
    startHeightsRef.current = new Float32Array(barCount).fill(FLAT_BAR_HEIGHT);
    barAnimationStartRef.current = new Float32Array(barCount).fill(0);
  }
  
  const isEnded = playbackState === "ended";
  // Fallback progress from atom (used when not playing)
  const atomProgress = isEnded ? 0 : (duration > 0 ? (currentTime / duration) * 100 : 0);
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
  
  // Detect dark mode for bar colors
  useEffect(() => {
    const updateDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark") || 
                    !document.documentElement.classList.contains("light"));
    };
    
    updateDarkMode();
    
    // Watch for theme changes
    const observer = new MutationObserver(updateDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ["class"] 
    });
    
    return () => observer.disconnect();
  }, []);
  
  // Easing function for smooth animation
  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  };
  
  // Track the track ID for reset detection
  const currentTrackIdRef = useRef<string | null>(null);
  
  // Track the last processed chunk to detect new chunks
  const lastChunkTimestampRef = useRef<number>(0);
  
  // Get current track ID for reset detection
  const trackId = currentTrack?.id ?? null;
  
  // Animate to new heights when they change
  useEffect(() => {
    // Ensure refs exist
    if (!animatedHeightsRef.current || !targetHeightsRef.current || 
        !startHeightsRef.current || !barAnimationStartRef.current) return;
        
    // Detect track change
    const trackChanged = trackId !== currentTrackIdRef.current;
    currentTrackIdRef.current = trackId;
    
    // Detect if we have a new chunk (for staggered chunk animation)
    const hasNewChunk = lastChunkInfo && lastChunkInfo.timestamp > lastChunkTimestampRef.current;
    if (lastChunkInfo) {
      lastChunkTimestampRef.current = lastChunkInfo.timestamp;
    }
    
    // Map source chunk indices to display indices
    const ratio = sourceBarCount / barCount;
    const displayChunkStart = hasNewChunk ? Math.floor(lastChunkInfo.startIndex / ratio) : 0;
    const displayChunkEnd = hasNewChunk ? Math.ceil(lastChunkInfo.endIndex / ratio) : 0;
    const chunkBarCount = displayChunkEnd - displayChunkStart;
    
    // Calculate per-bar stagger for chunk animation (spread across CHUNK_STAGGER_TOTAL_MS)
    const chunkStaggerPerBar = chunkBarCount > 1 ? CHUNK_STAGGER_TOTAL_MS / (chunkBarCount - 1) : 0;
    
    const now = performance.now();
    
    for (let i = 0; i < barCount; i++) {
      const newTarget = heights[i] ?? FLAT_BAR_HEIGHT;
      const currentTarget = targetHeightsRef.current[i];
      
      // Check if this bar's target changed
      if (Math.abs(newTarget - currentTarget) > 0.001 || trackChanged) {
        // Start this bar's animation from its current animated position
        startHeightsRef.current[i] = animatedHeightsRef.current[i];
        targetHeightsRef.current[i] = newTarget;
        
        // Determine stagger timing based on context
        if (trackChanged) {
          // Full track change: stagger all bars from left to right
          barAnimationStartRef.current[i] = now + i * ANIMATION_STAGGER_MS;
        } else if (hasNewChunk && i >= displayChunkStart && i < displayChunkEnd) {
          // New chunk: stagger bars with a fixed total duration spread
          // This makes chunk loading feel smooth regardless of chunk size
          const positionInChunk = i - displayChunkStart;
          barAnimationStartRef.current[i] = now + positionInChunk * chunkStaggerPerBar;
        } else {
          // Other height changes (e.g., re-normalization): no stagger
          barAnimationStartRef.current[i] = now;
        }
      }
    }
    
    // Cancel existing animation frame
    if (barAnimationFrameRef.current !== null) {
      cancelAnimationFrame(barAnimationFrameRef.current);
    }
    
    const animate = (animNow: number) => {
      // Safety check for refs
      if (!animatedHeightsRef.current || !targetHeightsRef.current || 
          !startHeightsRef.current || !barAnimationStartRef.current) return;
          
      let allComplete = true;
      const currentBarCount = animatedHeightsRef.current.length;
      
      // Animate each bar independently
      for (let i = 0; i < currentBarCount; i++) {
        const barStart = barAnimationStartRef.current[i];
        const elapsed = Math.max(0, animNow - barStart);
        const t = Math.min(1, elapsed / ANIMATION_DURATION_MS);
        
        if (t < 1) {
          allComplete = false;
          const easedT = easeOutCubic(t);
          const start = startHeightsRef.current[i];
          const target = targetHeightsRef.current[i];
          animatedHeightsRef.current[i] = start + (target - start) * easedT;
        } else {
          // Animation complete for this bar - snap to target
          animatedHeightsRef.current[i] = targetHeightsRef.current[i];
        }
      }
      
      // Force redraw via ref (avoids stale closure)
      drawWaveformRef.current?.(smoothProgressRef.current);
      
      if (!allComplete) {
        barAnimationFrameRef.current = requestAnimationFrame(animate);
      }
    };
    
    barAnimationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (barAnimationFrameRef.current !== null) {
        cancelAnimationFrame(barAnimationFrameRef.current);
      }
    };
  }, [heights, barCount, sourceBarCount, trackId, lastChunkInfo]);
  
  // Helper function to draw all bars with a given color
  const drawBars = (
    ctx: CanvasRenderingContext2D, 
    rect: DOMRect, 
    color: string,
    barWidth: number,
    barGap: number,
    centerY: number,
    currentBarCount: number
  ) => {
    if (!animatedHeightsRef.current) return;
    
    ctx.fillStyle = color;
    for (let i = 0; i < currentBarCount; i++) {
      const x = i * (barWidth + barGap);
      const displayHeight = animatedHeightsRef.current[i] ?? FLAT_BAR_HEIGHT;
      const barHeight = Math.max(2, displayHeight * rect.height);
      const y = centerY - barHeight / 2;
      
      ctx.beginPath();
      const radius = Math.min(barWidth / 2, barHeight / 2, 2);
      ctx.roundRect(x, y, barWidth, barHeight, radius);
      ctx.fill();
    }
  };
  
  // Draw waveform on canvas with smooth clip-based progress fill
  const drawWaveform = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Get the current bar count from the ref
    const currentBarCount = animatedHeightsRef.current?.length ?? barCount;
    
    // Get actual pixel dimensions
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width * dpr;
    const height = rect.height * dpr;
    
    // Set canvas size only if dimensions changed
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);
    } else {
      // Reset transform if size didn't change
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    
    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    // Calculate bar dimensions - ensure bar width doesn't go negative
    const barGap = BAR_GAP;
    const totalGaps = Math.max(0, currentBarCount - 1);
    const availableWidth = rect.width - totalGaps * barGap;
    const barWidth = currentBarCount > 0 ? Math.max(MIN_BAR_WIDTH, availableWidth / currentBarCount) : MIN_BAR_WIDTH;
    const centerY = rect.height / 2;
    
    // Choose colors based on theme
    const bufferedColor = isDarkMode ? COLORS.buffered.dark : COLORS.buffered.light;
    const unbufferedColor = isDarkMode ? COLORS.unbuffered.dark : COLORS.unbuffered.light;
    
    // Calculate progress X position for smooth fill
    const progressX = (progress / 100) * rect.width;
    const bufferedX = (bufferedPercent / 100) * rect.width;
    
    // Pass 1: Draw unbuffered bars (lightest gray)
    if (bufferedX < rect.width) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(bufferedX, 0, rect.width - bufferedX, rect.height);
      ctx.clip();
      drawBars(ctx, rect, unbufferedColor, barWidth, barGap, centerY, currentBarCount);
      ctx.restore();
    }
    
    // Pass 2: Draw buffered bars (medium gray) - only the portion not yet played
    if (bufferedX > progressX) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(progressX, 0, bufferedX - progressX, rect.height);
      ctx.clip();
      drawBars(ctx, rect, bufferedColor, barWidth, barGap, centerY, currentBarCount);
      ctx.restore();
    }
    
    // Pass 3: Draw played bars (accent color) with smooth clip
    if (progressX > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, progressX, rect.height);
      ctx.clip();
      drawBars(ctx, rect, primaryColor, barWidth, barGap, centerY, currentBarCount);
      ctx.restore();
    }
    
    // Draw hover indicator line (taller, no bar coloring)
    if (isHovering && hoverPercent !== null) {
      const x = (hoverPercent / 100) * rect.width;
      const cursorHeight = rect.height + 8; // 4px above and below
      const cursorY = -4;
      ctx.fillStyle = isDarkMode ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)";
      ctx.fillRect(x - 1.5, cursorY, 2, cursorHeight);
    }
  }, [barCount, bufferedPercent, hoverPercent, isHovering, primaryColor, isDarkMode]);
  
  // Keep ref updated so animation loop can call latest version
  useEffect(() => {
    drawWaveformRef.current = drawWaveform;
  }, [drawWaveform]);
  
  // Smooth progress animation loop - runs during playback for 60fps updates
  useEffect(() => {
    const isPlaying = playbackState === "playing";
    
    if (isPlaying) {
      const animateProgress = () => {
        const audio = getGlobalAudio();
        if (audio && audio.duration > 0) {
          smoothProgressRef.current = (audio.currentTime / audio.duration) * 100;
        } else {
          smoothProgressRef.current = atomProgress;
        }
        drawWaveformRef.current?.(smoothProgressRef.current);
        progressAnimationRef.current = requestAnimationFrame(animateProgress);
      };
      
      progressAnimationRef.current = requestAnimationFrame(animateProgress);
    } else {
      // When not playing, use atom-based progress and cancel animation loop
      if (progressAnimationRef.current !== null) {
        cancelAnimationFrame(progressAnimationRef.current);
        progressAnimationRef.current = null;
      }
      smoothProgressRef.current = atomProgress;
      drawWaveformRef.current?.(atomProgress);
    }
    
    return () => {
      if (progressAnimationRef.current !== null) {
        cancelAnimationFrame(progressAnimationRef.current);
        progressAnimationRef.current = null;
      }
    };
  }, [playbackState, atomProgress]);
  
  // Redraw when visual dependencies change (but not progress - that's handled by animation loop)
  useEffect(() => {
    drawWaveform(smoothProgressRef.current);
  }, [drawWaveform]);
  
  // Handle click to seek
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    seekPercent(percent);
  }, [seekPercent]);
  
  // Handle mouse move for hover indicator
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    setHoverPercent(Math.max(0, Math.min(100, percent)));
  }, []);
  
  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, []);
  
  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setHoverPercent(null);
  }, []);
  
  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      seekPercent(Math.min(100, smoothProgressRef.current + step));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekPercent(Math.max(0, smoothProgressRef.current - step));
    }
  }, [seekPercent]);
  
  const hasTrack = !!currentTrack && playbackState !== "idle" && playbackState !== "ended";

  // Total height of the waveform container (bars are centered on the border)
  const waveformHeight = 16; // pixels, centered on border
  
  return (
    <>
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
          className
        )}
        style={{
          top: `-${waveformHeight / 2}px`,
          height: `${waveformHeight}px`,
          zIndex: 100, // Ensure above sidebar (z-40) - parent footer is z-50 with relative
        }}
        onClick={hasTrack ? handleClick : undefined}
        onKeyDown={hasTrack ? handleKeyDown : undefined}
        onMouseMove={hasTrack ? handleMouseMove : undefined}
        onMouseEnter={hasTrack ? handleMouseEnter : undefined}
        onMouseLeave={handleMouseLeave}
      >
        {/* Expand click target area */}
        <div className="absolute inset-0 -top-2 -bottom-2" />
        
        {/* Hardware-accelerated canvas for waveform */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ 
            imageRendering: "pixelated",
          }}
        />
        
        {/* Hover time tooltip */}
        {isHovering && hoverPercent !== null && hoverTime !== null && (
          <div
            ref={tooltipRef}
            className="absolute bottom-full mb-2 px-2 py-1 text-xs font-medium rounded bg-popover text-popover-foreground shadow-md border border-border whitespace-nowrap pointer-events-none"
            style={{
              left: `${hoverPercent}%`,
              transform: "translateX(-50%)",
            }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
      </div>
    </>
  );
}
