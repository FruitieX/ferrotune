"use client";

import { useMemo } from "react";
import Image from "next/image";
import { ListMusic } from "lucide-react";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";

interface PlaylistCoverProps {
  /** Playlist's explicit cover art URL (if any) */
  coverArtId?: string;
  /** Songs in the playlist for generating composite cover */
  songs?: Song[];
  /** Alternative text */
  alt: string;
  /** Size variant */
  size?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  priority?: boolean;
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
 * PlaylistCover - Shows either:
 * 1. The playlist's explicit cover art if available
 * 2. A 2x2 grid of the first 4 unique album covers from the playlist
 * 3. A fallback icon if no songs/covers available
 */
export function PlaylistCover({
  coverArtId,
  songs = [],
  alt,
  size = "md",
  className,
  priority = false,
}: PlaylistCoverProps) {
  const client = getClient();
  
  // Get unique album cover art IDs from songs (first 4)
  const albumCoverIds = useMemo(() => {
    const seen = new Set<string>();
    const covers: string[] = [];
    
    for (const song of songs) {
      if (song.coverArt && !seen.has(song.coverArt) && covers.length < 4) {
        seen.add(song.coverArt);
        covers.push(song.coverArt);
      }
    }
    
    return covers;
  }, [songs]);

  // If playlist has explicit cover art, use that
  const explicitCoverUrl = coverArtId && client
    ? client.getCoverArtUrl(coverArtId, size === "full" || size === "xl" ? 300 : 150)
    : null;

  // Get cover URLs for composite image
  const coverUrls = useMemo(() => {
    if (!client || albumCoverIds.length === 0) return [];
    const imageSize = size === "full" || size === "xl" ? 150 : 75;
    return albumCoverIds.map(id => client.getCoverArtUrl(id, imageSize));
  }, [client, albumCoverIds, size]);

  return (
    <div
      className={cn(
        "relative bg-muted overflow-hidden shrink-0 rounded-md",
        sizeClasses[size],
        className
      )}
    >
      {explicitCoverUrl ? (
        // Show explicit cover art
        <Image
          src={explicitCoverUrl}
          alt={alt}
          fill
          className="object-cover"
          sizes={size === "full" ? "100vw" : size === "xl" ? "192px" : "56px"}
          priority={priority}
          unoptimized
        />
      ) : coverUrls.length >= 4 ? (
        // Show 2x2 grid of album covers
        <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
          {coverUrls.slice(0, 4).map((url, index) => (
            <div key={index} className="relative w-full h-full">
              <Image
                src={url}
                alt=""
                fill
                className="object-cover"
                sizes={size === "full" ? "50vw" : size === "xl" ? "96px" : "28px"}
                priority={priority && index === 0}
                unoptimized
              />
            </div>
          ))}
        </div>
      ) : coverUrls.length > 0 ? (
        // Show single cover if we have 1-3 covers
        <Image
          src={coverUrls[0]}
          alt={alt}
          fill
          className="object-cover"
          sizes={size === "full" ? "100vw" : size === "xl" ? "192px" : "56px"}
          priority={priority}
          unoptimized
        />
      ) : (
        // Fallback placeholder
        <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-primary/30 to-primary/10">
          <ListMusic className={cn("text-muted-foreground", iconSizes[size])} />
        </div>
      )}
    </div>
  );
}
