"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, Disc, Heart } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Album } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { AlbumContextMenu, AlbumDropdownMenu } from "./album-context-menu";

interface AlbumCardProps {
  album: Album;
  onPlay?: () => void;
  className?: string;
}

export function AlbumCard({ album, onPlay, className }: AlbumCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  
  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 300)
    : null;

  const hasImage = coverArtUrl && !imageError;

  return (
    <AlbumContextMenu album={album}>
      <article
        data-testid="album-card"
        className={cn(
          "group relative p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer",
          className
        )}
      >
        <AlbumDropdownMenu album={album} onPlay={onPlay} />
        <Link href={`/library/albums/${album.id}`} className="block">
          <div className="relative aspect-square rounded-md overflow-hidden bg-muted mb-4 album-glow transform-gpu transition-transform duration-200 group-hover:scale-[1.05]">
            {hasImage ? (
              <>
                {/* Skeleton shown while image loads */}
                {!imageLoaded && (
                  <Skeleton className="absolute inset-0 w-full h-full rounded-none" />
                )}
                <img
                  src={coverArtUrl}
                  alt={album.name || "Album cover"}
                  loading="lazy"
                  decoding="async"
                  className={cn(
                    "absolute inset-0 w-full h-full object-cover transition-opacity duration-200",
                    imageLoaded ? "opacity-100" : "opacity-0"
                  )}
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageError(true)}
                />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20">
                <Disc className="w-12 h-12 text-muted-foreground" />
              </div>
            )}
            
            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                size="icon"
                className="h-12 w-12 rounded-full shadow-lg"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPlay?.();
                }}
              >
                <Play className="w-6 h-6 ml-0.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {album.name}
            </h3>
            <p className="text-sm text-muted-foreground truncate">
              {album.year && `${album.year} • `}{album.artist}
            </p>
          </div>
        </Link>
      </article>
    </AlbumContextMenu>
  );
}

export function AlbumCardSkeleton() {
  return (
    <div className="p-4 rounded-lg bg-card">
      <Skeleton className="aspect-square rounded-md mb-4" />
      <Skeleton className="h-5 w-3/4 mb-2" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

// Compact album card for lists
interface AlbumCardCompactProps {
  album: Album;
  onPlay?: () => void;
  className?: string;
}

export function AlbumCardCompact({ album, onPlay, className }: AlbumCardCompactProps) {
  const [imageError, setImageError] = useState(false);
  const [isStarred, setIsStarred] = useState(!!album.starred);
  
  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 80)
    : null;

  const showImage = coverArtUrl && !imageError;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ albumId: album.id });
        setIsStarred(false);
        toast.success(`Removed from favorites`);
      } else {
        await client.star({ albumId: album.id });
        setIsStarred(true);
        toast.success(`Added to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  return (
    <AlbumContextMenu album={album}>
      <div
        className={cn(
          "group flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors cursor-pointer",
          className
        )}
      >
        <Link
          href={`/library/albums/${album.id}`}
          className="flex items-center gap-3 flex-1 min-w-0"
        >
          <div className="relative w-12 h-12 rounded overflow-hidden bg-muted shrink-0">
            {showImage ? (
              <img
                src={coverArtUrl}
                alt={album.name || "Album cover"}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20">
                <Disc className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{album.name}</p>
            <p className="text-xs text-muted-foreground truncate">{album.artist}</p>
          </div>
        </Link>
        
        {/* Hover action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleStar}
          >
            <Heart className={cn("w-4 h-4", isStarred && "fill-red-500 text-red-500")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.preventDefault();
              onPlay?.();
            }}
          >
            <Play className="w-4 h-4" />
          </Button>
          <AlbumDropdownMenu album={album} onPlay={onPlay} />
        </div>
      </div>
    </AlbumContextMenu>
  );
}
