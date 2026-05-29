"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  Music,
  User,
  Disc,
  ListMusic,
  Heart,
  Clock,
  History,
  TrendingUp,
  Tag,
  Folder,
  Sparkles,
} from "lucide-react";

interface CoverImageProps {
  src?: string | null;
  /** Inline base64 JPEG thumbnail data (pre-fetched from API response) - takes priority over src */
  inlineData?: string | null;
  alt: string;
  /** String to use for generating placeholder color (e.g. album name for albums, artist name for artists) */
  colorSeed?: string;
  type?:
    | "album"
    | "artist"
    | "song"
    | "playlist"
    | "smartPlaylist"
    | "favorites"
    | "forgottenFavorites"
    | "mostPlayedRecently"
    | "discover"
    | "recentlyAdded"
    | "albumList"
    | "genre"
    | "folder";
  size?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  priority?: boolean;
  /** If true, only loads image when in viewport (default: true for non-priority) */
  lazy?: boolean;
  /** If true, shows placeholder while image is loading (default: false - shows skeleton) */
  showPlaceholderWhileLoading?: boolean;
  /** If true, shows a small type icon badge in the corner (e.g., sparkle for smart playlists) */
  showTypeOverlay?: boolean;
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
export function stringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash % 360);
}

export function CoverImage({
  src,
  inlineData,
  alt,
  colorSeed,
  type = "album",
  size = "md",
  className,
  priority = true,
  lazy = !priority,
  showPlaceholderWhileLoading = false,
  showTypeOverlay = false,
}: CoverImageProps) {
  const [hasError, setHasError] = useState(false);
  // Initialize isLoaded to true for inline data (no fetch needed)
  // For external URLs, start as false and wait for onLoad
  const [isLoaded, setIsLoaded] = useState(() => !!inlineData);
  const [isVisible, setIsVisible] = useState(!lazy);
  const [prevSrc, setPrevSrc] = useState<string | null | undefined>(src);
  const [prevInlineData, setPrevInlineData] = useState<
    string | null | undefined
  >(inlineData);
  const containerRef = useRef<HTMLDivElement>(null);

  const Icon =
    type === "artist"
      ? User
      : type === "playlist"
        ? ListMusic
        : type === "favorites"
          ? Heart
          : type === "forgottenFavorites"
            ? History
            : type === "mostPlayedRecently"
              ? TrendingUp
              : type === "discover"
                ? Sparkles
                : type === "recentlyAdded"
                  ? Clock
                  : type === "smartPlaylist"
                    ? Sparkles
                    : type === "song"
                      ? Music
                      : type === "genre"
                        ? Tag
                        : type === "folder"
                          ? Folder
                          : Disc;
  const isRound = type === "artist";

  // Reset state when src or inlineData changes (React-recommended pattern for adjusting state when props change)
  // We keep a flag to know if this is a "fresh" image or a src change
  const isSrcChanging = src !== prevSrc || inlineData !== prevInlineData;
  if (isSrcChanging) {
    setPrevSrc(src);
    setPrevInlineData(inlineData);
    setHasError(false);
    // For inline data, mark as loaded immediately (no fetch needed)
    // For external URLs, reset to false and let onLoad set it to true
    setIsLoaded(!!inlineData);
  }

  // Generate a unique color based on colorSeed (album/artist name) or fall back to alt
  const placeholderHue = stringToHue(colorSeed || alt || "");
  const placeholderBackground =
    type === "favorites"
      ? "linear-gradient(135deg, rgb(239 68 68) 0%, rgb(185 28 28) 100%)"
      : type === "forgottenFavorites"
        ? "linear-gradient(135deg, rgb(245 158 11) 0%, rgb(21 94 117) 100%)"
        : type === "mostPlayedRecently"
          ? "linear-gradient(135deg, rgb(244 63 94) 0%, rgb(234 179 8) 100%)"
          : type === "discover"
            ? "linear-gradient(135deg, rgb(139 92 246) 0%, rgb(192 38 211) 100%)"
            : type === "recentlyAdded"
              ? "linear-gradient(135deg, rgb(14 165 233) 0%, rgb(37 99 235) 100%)"
              : `linear-gradient(135deg, oklch(0.45 0.12 ${placeholderHue}) 0%, oklch(0.3 0.1 ${(placeholderHue + 50) % 360}) 100%)`;

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
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [lazy, isVisible]);

  // Determine what to show:
  // - If inlineData is provided, use it immediately (no loading needed for inline data)
  // - If no src provided, show placeholder
  // - If src provided and loaded successfully, show image
  // - If src provided and error occurred, show placeholder
  // - If src provided and still loading, show skeleton (or placeholder if showPlaceholderWhileLoading is true)

  // Inline data takes priority and is shown immediately (no fetch needed)
  const hasInlineData = !!inlineData;
  const hasSrc = !!src;
  const showImage = (hasInlineData || hasSrc) && !hasError && isVisible;
  const showPlaceholder =
    (!hasInlineData && !hasSrc) ||
    hasError ||
    (showPlaceholderWhileLoading && !isLoaded && !hasInlineData);
  const showSkeleton =
    !hasInlineData &&
    hasSrc &&
    !hasError &&
    !isLoaded &&
    !showPlaceholderWhileLoading &&
    isVisible;

  // For inline data, convert to data URL
  const imageSrc = hasInlineData
    ? `data:image/jpeg;base64,${inlineData}`
    : src || "";
  // Inline data is immediately "loaded"
  const isImageLoaded = hasInlineData || isLoaded;

  return (
    <div
      ref={containerRef}
      data-cover-type={type}
      className={cn(
        "relative bg-muted overflow-hidden shrink-0",
        isRound ? "rounded-full" : "rounded-md",
        sizeClasses[size],
        className,
      )}
    >
      {/* Skeleton/loading state */}
      {showSkeleton && (
        <div className="absolute inset-0 animate-pulse bg-muted" />
      )}

      {/* Image - render when we have a src, keep it mounted to handle load/error events */}
      {showImage && (
        <Image
          src={imageSrc}
          alt={alt || "Cover art"}
          fill
          draggable={false}
          className={cn(
            "object-cover",
            // Only use opacity transition when loading, not when already loaded
            // This prevents flash when switching to a cached image
            isImageLoaded
              ? "opacity-100"
              : "opacity-0 transition-opacity duration-200",
          )}
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
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      )}

      {/* Placeholder - shown when no src, or after error, or while loading if showPlaceholderWhileLoading */}
      {/* For smart playlists and folders with overlay, we skip the icon since the overlay shows the type icon */}
      {showPlaceholder && !showSkeleton && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: placeholderBackground,
          }}
        >
          {/* Don't show icon if we're showing the type overlay (avoids duplicate icons) */}
          {!(
            showTypeOverlay &&
            (type === "smartPlaylist" || type === "folder")
          ) && (
            <Icon
              className={cn(
                "text-white/70",
                type === "favorites" && "fill-white/70 text-white/80",
                type === "discover" && "fill-white/40 text-white/80",
                iconSizes[size],
              )}
            />
          )}
        </div>
      )}

      {/* Type overlay badge - shows sparkle icon centered for smart playlists */}
      {/* Only show when placeholder is displayed (no cover art), not over actual images */}
      {showTypeOverlay && type === "smartPlaylist" && showPlaceholder && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Sparkles className={cn("text-white/70", iconSizes[size])} />
        </div>
      )}

      {/* Type overlay badge - shows folder icon centered for playlist folders */}
      {/* Only show when placeholder is displayed (no cover art), not over actual images */}
      {showTypeOverlay && type === "folder" && showPlaceholder && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Folder className={cn("text-white/70", iconSizes[size])} />
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
      className={cn("w-full aspect-square rounded-md", className)}
      style={{
        background: `linear-gradient(135deg, hsl(${hue1}, 70%, 30%) 0%, hsl(${hue2}, 60%, 20%) 100%)`,
      }}
    />
  );
}
