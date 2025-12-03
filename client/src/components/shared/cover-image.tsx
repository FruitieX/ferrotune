"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Music, User, Disc, ListMusic } from "lucide-react";

interface CoverImageProps {
  src?: string | null;
  alt: string;
  /** String to use for generating placeholder color (e.g. album name for albums, artist name for artists) */
  colorSeed?: string;
  type?: "album" | "artist" | "song" | "playlist";
  size?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  priority?: boolean;
  /** If true, only loads image when in viewport (default: true for non-priority) */
  lazy?: boolean;
}

const sizeClasses = {
  sm: "w-10 h-10",
  md: "w-14 h-14",
  lg: "w-24 h-24",
  xl: "w-48 h-48",
  full: "w-full aspect-square",
};

const iconSizes = {
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-10 h-10",
  xl: "w-16 h-16",
  full: "w-1/5 h-1/5",
};

/**
 * Generate a stable hue value from a string (0-360)
 */
function stringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash % 360);
}

export function CoverImage({
  src,
  alt,
  colorSeed,
  type = "album",
  size = "md",
  className,
  priority = false,
  lazy = !priority,
}: CoverImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isVisible, setIsVisible] = useState(!lazy);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const Icon = type === "artist" ? User : type === "playlist" ? ListMusic : type === "song" ? Music : Disc;
  const isRound = type === "artist";

  // Reset error state when src changes
  useEffect(() => {
    setHasError(false);
  }, [src]);

  // Generate a unique color based on colorSeed (album/artist name) or fall back to alt
  const placeholderHue = useMemo(() => stringToHue(colorSeed || alt || ""), [colorSeed, alt]);

  // Use IntersectionObserver for true lazy loading
  useEffect(() => {
    if (!lazy || isVisible) return;
    
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "100px", // Start loading slightly before entering viewport
        threshold: 0,
      }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [lazy, isVisible]);

  const showImage = src && !hasError && isVisible;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative bg-muted overflow-hidden shrink-0",
        isRound ? "rounded-full" : "rounded-md",
        sizeClasses[size],
        className
      )}
    >
      {showImage ? (
        <Image
          src={src}
          alt={alt || "Cover art"}
          fill
          className="object-cover"
          sizes={
            size === "full"
              ? "(max-width: 640px) 100vw, 50vw"
              : size === "xl"
                ? "192px"
                : size === "lg"
                  ? "96px"
                  : "56px"
          }
          priority={priority}
          unoptimized
          onError={() => setHasError(true)}
        />
      ) : (
        <div 
          className="w-full h-full flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, hsl(${placeholderHue}, 50%, 25%) 0%, hsl(${(placeholderHue + 40) % 360}, 45%, 18%) 100%)`,
          }}
        >
          <Icon className={cn("text-white/70", iconSizes[size])} />
        </div>
      )}
    </div>
  );
}

// Gradient placeholder for large images
interface CoverGradientProps {
  seed?: string;
  className?: string;
}

export function CoverGradient({ seed = "", className }: CoverGradientProps) {
  // Generate gradient colors from seed string
  const hash = seed.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);

  const hue1 = Math.abs(hash % 360);
  const hue2 = (hue1 + 40) % 360;

  return (
    <div
      className={cn(
        "w-full aspect-square rounded-md",
        className
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue1}, 70%, 30%) 0%, hsl(${hue2}, 60%, 20%) 100%)`,
      }}
    />
  );
}
