"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  Music,
  User,
  Disc,
  ListMusic,
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
  // Helper to check if an image is cached (synchronous check)
  const isImageCached = (imgSrc: string | null | undefined): boolean => {
    if (!imgSrc) return false;
    // Create a temporary Image to check if it's cached
    // .complete is true if the image is cached or embedded
    // .naturalWidth > 0 ensures it's a valid loaded image (not a broken one)
    const testImg = new window.Image();
    testImg.src = imgSrc;
    return testImg.complete && testImg.naturalWidth > 0;
  };

  const [hasError, setHasError] = useState(false);
  // Initialize isLoaded based on whether image is already cached
  // This prevents flash when component mounts with a cached image
  const [isLoaded, setIsLoaded] = useState(() => {
    // Inline data is always immediately "loaded" (embedded in page)
    if (inlineData) return true;
    // Check browser cache for external URLs
    return isImageCached(src);
  });
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
    // Check if the new image is already cached - if so, keep isLoaded=true to avoid flash
    if (inlineData) {
      setIsLoaded(true);
    } else {
      setIsLoaded(isImageCached(src));
    }
  }

  // Generate a unique color based on colorSeed (album/artist name) or fall back to alt
  const placeholderHue = stringToHue(colorSeed || alt || "");

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
            background: `linear-gradient(135deg, hsl(${placeholderHue}, 50%, 25%) 0%, hsl(${(placeholderHue + 40) % 360}, 45%, 18%) 100%)`,
          }}
        >
          {/* Don't show icon if we're showing the type overlay (avoids duplicate icons) */}
          {!(
            showTypeOverlay &&
            (type === "smartPlaylist" || type === "folder")
          ) && <Icon className={cn("text-white/70", iconSizes[size])} />}
        </div>
      )}

      {/* Type overlay badge - shows sparkle icon centered for smart playlists */}
      {showTypeOverlay && type === "smartPlaylist" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={cn(
              "bg-purple-600/75 rounded-full",
              size === "sm" ? "p-1" : "p-2",
            )}
          >
            {/* Size-responsive sparkle: smaller for row view (sm), larger for grid (md+) */}
            <Sparkles
              className={cn(
                "text-white/90",
                size === "sm" ? "w-4 h-4" : "w-8 h-8",
              )}
            />
          </div>
        </div>
      )}

      {/* Type overlay badge - shows folder icon centered for playlist folders */}
      {showTypeOverlay && type === "folder" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={cn(
              "bg-amber-600/75 rounded-full",
              size === "sm" ? "p-1" : "p-2",
            )}
          >
            {/* Size-responsive folder icon: smaller for row view (sm), larger for grid (md+) */}
            <Folder
              className={cn(
                "text-white/90",
                size === "sm" ? "w-4 h-4" : "w-8 h-8",
              )}
            />
          </div>
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
