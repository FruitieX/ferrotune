"use client";

import Image from "next/image";
import { ListMusic } from "lucide-react";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";

interface PlaylistCoverProps {
  /** Playlist ID (used as cover art ID - backend generates composite) */
  playlistId: string;
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

const imageSizes = {
  sm: 40,
  md: 56,
  lg: 96,
  xl: 192,
  full: 600,
};

/**
 * Hook to get the playlist cover URL for use in backgrounds
 */
export function usePlaylistCoverUrl(playlistId: string | null, size: number = 400): string | null {
  const client = getClient();
  if (!client || !playlistId) return null;
  return client.getCoverArtUrl(playlistId, size);
}

/**
 * PlaylistCover - Shows the playlist's cover art (backend generates 2x2 composite if needed)
 */
export function PlaylistCover({
  playlistId,
  alt,
  size = "md",
  className,
  priority = false,
}: PlaylistCoverProps) {
  const client = getClient();

  const coverUrl = client
    ? client.getCoverArtUrl(playlistId, imageSizes[size])
    : null;

  return (
    <div
      className={cn(
        "relative bg-muted overflow-hidden shrink-0 rounded-md",
        sizeClasses[size],
        className
      )}
    >
      {coverUrl ? (
        <Image
          src={coverUrl}
          alt={alt}
          fill
          className="object-cover"
          sizes={size === "full" ? "100vw" : size === "xl" ? "192px" : "56px"}
          priority={priority}
          unoptimized
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-primary/30 to-primary/10">
          <ListMusic className={cn("text-muted-foreground", iconSizes[size])} />
        </div>
      )}
    </div>
  );
}
