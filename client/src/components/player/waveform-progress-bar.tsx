"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAtomValue } from "jotai";
import { cn } from "@/lib/utils";
import { currentTimeAtom, durationAtom, playbackStateAtom, bufferedAtom } from "@/lib/store/player";
import { currentTrackAtom } from "@/lib/store/queue";
import { useAudioEngine } from "@/lib/audio/hooks";
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
const ANIMATION_STAGGER_MS = 3; // Stagger per bar

export function WaveformProgressBar({ className }: WaveformProgressBarProps) {
  const currentTrack = useAtomValue(currentTrackAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const buffered = useAtomValue(bufferedAtom);
  const { seekPercent } = useAudioEngine();
  const { heights, barCount } = useWaveform();
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const colorProbeRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#3b82f6");
  const [isDarkMode, setIsDarkMode] = useState(true);
  
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
  
  // Animation state
  const animatedHeightsRef = useRef<Float32Array>(new Float32Array(barCount).fill(FLAT_BAR_HEIGHT));
  const targetHeightsRef = useRef<Float32Array>(new Float32Array(barCount).fill(FLAT_BAR_HEIGHT));
  const startHeightsRef = useRef<Float32Array>(new Float32Array(barCount).fill(FLAT_BAR_HEIGHT));
  const barAnimationStartRef = useRef<Float32Array>(new Float32Array(barCount).fill(0));
  const animationFrameRef = useRef<number | null>(null);
  const drawWaveformRef = useRef<(() => void) | null>(null);
  
  const isEnded = playbackState === "ended";
  const progress = isEnded ? 0 : (duration > 0 ? (currentTime / duration) * 100 : 0);
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
  
  // Get the primary color from a probe element that uses the CSS variable
  useEffect(() => {
    const updateColors = () => {
      const probe = colorProbeRef.current;
      if (probe) {
        const computedColor = getComputedStyle(probe).backgroundColor;
        if (computedColor && computedColor !== "rgba(0, 0, 0, 0)") {
          setPrimaryColor(computedColor);
        }
      }
      setIsDarkMode(document.documentElement.classList.contains("dark") || 
                    !document.documentElement.classList.contains("light"));
    };
    
    updateColors();
    
    // Watch for theme changes
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ["class", "style"] 
    });
    
    return () => observer.disconnect();
  }, []);
  
  // Easing function for smooth animation
  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  };
  
  // Track the track ID for reset detection
  const currentTrackIdRef = useRef<string | null>(null);
  
  // Get current track ID for reset detection
  const trackId = currentTrack?.id ?? null;
  
  // Animate to new heights when they change
  useEffect(() => {
    // Detect track change
    const trackChanged = trackId !== currentTrackIdRef.current;
    currentTrackIdRef.current = trackId;
    
    const now = performance.now();
    
    for (let i = 0; i < barCount; i++) {
      const newTarget = heights[i] ?? FLAT_BAR_HEIGHT;
      const currentTarget = targetHeightsRef.current[i];
      
      // Check if this bar's target changed
      if (Math.abs(newTarget - currentTarget) > 0.001 || trackChanged) {
        // Start this bar's animation from its current animated position
        startHeightsRef.current[i] = animatedHeightsRef.current[i];
        targetHeightsRef.current[i] = newTarget;
        // Reset this bar's animation timer (with stagger for track changes)
        barAnimationStartRef.current[i] = now + (trackChanged ? i * ANIMATION_STAGGER_MS : 0);
      }
    }
    
    // Cancel existing animation frame
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    const animate = (animNow: number) => {
      let allComplete = true;
      
      // Animate each bar independently
      for (let i = 0; i < barCount; i++) {
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
      drawWaveformRef.current?.();
      
      if (!allComplete) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [heights, barCount, trackId]);
  
  // Draw waveform on canvas
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
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
    
    // Calculate bar dimensions
    const barGap = 1;
    const totalGaps = barCount - 1;
    const barWidth = (rect.width - totalGaps * barGap) / barCount;
    const centerY = rect.height / 2;
    
    // Choose colors based on theme
    const bufferedColor = isDarkMode ? COLORS.buffered.dark : COLORS.buffered.light;
    const unbufferedColor = isDarkMode ? COLORS.unbuffered.dark : COLORS.unbuffered.light;
    
    // Draw each bar
    for (let i = 0; i < barCount; i++) {
      const barPercent = ((i + 0.5) / barCount) * 100;
      const isPlayed = barPercent <= progress;
      const isBufferedBar = barPercent <= bufferedPercent;
      const isInHoverRange = hoverPercent !== null && barPercent <= hoverPercent && isHovering;
      
      // Determine color
      let color: string;
      if (isPlayed) {
        color = primaryColor;
      } else if (isInHoverRange) {
        color = primaryColor;
      } else if (isBufferedBar) {
        color = bufferedColor;
      } else {
        color = unbufferedColor;
      }
      
      // Calculate bar position and size using animated heights
      const x = i * (barWidth + barGap);
      const displayHeight = animatedHeightsRef.current[i];
      const barHeight = Math.max(2, displayHeight * rect.height);
      const y = centerY - barHeight / 2;
      
      // Draw rounded bar
      ctx.fillStyle = color;
      ctx.beginPath();
      const radius = Math.min(barWidth / 2, barHeight / 2, 2);
      ctx.roundRect(x, y, barWidth, barHeight, radius);
      ctx.fill();
    }
    
    // Draw hover indicator line
    if (isHovering && hoverPercent !== null) {
      const x = (hoverPercent / 100) * rect.width;
      ctx.fillStyle = isDarkMode ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)";
      ctx.fillRect(x - 1, 0, 2, rect.height);
    }
  }, [barCount, progress, bufferedPercent, hoverPercent, isHovering, primaryColor, isDarkMode]);
  
  // Keep ref updated so animation loop can call latest version
  useEffect(() => {
    drawWaveformRef.current = drawWaveform;
  }, [drawWaveform]);
  
  // Redraw when dependencies change (but not heights - that's handled by animation)
  useEffect(() => {
    drawWaveform();
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
      seekPercent(Math.min(100, progress + step));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekPercent(Math.max(0, progress - step));
    }
  }, [progress, seekPercent]);
  
  const hasTrack = !!currentTrack && playbackState !== "idle" && playbackState !== "ended";

  // Total height of the waveform container (bars are centered on the border)
  const waveformHeight = 16; // pixels, centered on border
  
  return (
    <>
      {/* Hidden probe element to get computed primary color */}
      <div 
        ref={colorProbeRef} 
        className="bg-primary absolute w-0 h-0 pointer-events-none" 
        aria-hidden="true"
      />
      <div
        ref={containerRef}
        role="slider"
        aria-label="Playback progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
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
