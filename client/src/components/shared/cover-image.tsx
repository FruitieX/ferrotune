"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Music, User, Disc, ListMusic } from "lucide-react";

interface CoverImageProps {
  src?: string | null;
  alt: string;
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
  full: "w-1/3 h-1/3",
};

export function CoverImage({
  src,
  alt,
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
        <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20">
          <Icon className={cn("text-muted-foreground", iconSizes[size])} />
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
