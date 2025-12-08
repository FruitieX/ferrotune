"use client";

import { cn } from "@/lib/utils";

interface NowPlayingBarsProps {
  className?: string;
  isAnimating?: boolean;
}

/**
 * Audio bar visualizer for now playing indicator - uses CSS animations.
 * Shows animated bars when playing, static bars when paused.
 */
export function NowPlayingBars({
  className,
  isAnimating = true,
}: NowPlayingBarsProps) {
  return (
    <div className={cn("flex items-end justify-center gap-0.5 h-3", className)}>
      <span
        className={cn(
          "w-[3px] bg-primary rounded-sm",
          isAnimating && "animate-bar-1",
        )}
        style={{
          animationDuration: "0.4s",
          height: isAnimating ? undefined : "6px",
        }}
      />
      <span
        className={cn(
          "w-[3px] bg-primary rounded-sm",
          isAnimating && "animate-bar-2",
        )}
        style={{
          animationDuration: "0.5s",
          height: isAnimating ? undefined : "10px",
        }}
      />
      <span
        className={cn(
          "w-[3px] bg-primary rounded-sm",
          isAnimating && "animate-bar-3",
        )}
        style={{
          animationDuration: "0.35s",
          height: isAnimating ? undefined : "6px",
        }}
      />
      <span
        className={cn(
          "w-[3px] bg-primary rounded-sm",
          isAnimating && "animate-bar-4",
        )}
        style={{
          animationDuration: "0.45s",
          height: isAnimating ? undefined : "8px",
        }}
      />
    </div>
  );
}
