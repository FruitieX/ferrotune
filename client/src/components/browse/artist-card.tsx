"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Artist } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { formatCount } from "@/lib/utils/format";

interface ArtistCardProps {
  artist: Artist;
  onPlay?: () => void;
  className?: string;
}

export function ArtistCard({ artist, onPlay, className }: ArtistCardProps) {
  const [imageError, setImageError] = useState(false);
  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, 300)
    : null;

  const showImage = coverArtUrl && !imageError;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group relative p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer",
        className
      )}
    >
      <Link href={`/library/artists/${artist.id}`} className="block">
        <div className="relative aspect-square rounded-full overflow-hidden bg-muted mb-4 transform-gpu transition-transform duration-200 group-hover:scale-[1.05]">
          {showImage ? (
            <Image
              src={coverArtUrl}
              alt={artist.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              unoptimized
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/20">
              <span className="text-4xl">👤</span>
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

        <div className="text-center space-y-1">
          <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {artist.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {formatCount(artist.albumCount, "album")}
          </p>
        </div>
      </Link>
    </motion.div>
  );
}

export function ArtistCardSkeleton() {
  return (
    <div className="p-4 rounded-lg bg-card">
      <Skeleton className="aspect-square rounded-full mb-4" />
      <div className="text-center space-y-2">
        <Skeleton className="h-5 w-3/4 mx-auto" />
        <Skeleton className="h-4 w-1/2 mx-auto" />
      </div>
    </div>
  );
}

// Compact artist card for lists
interface ArtistCardCompactProps {
  artist: Artist;
  onPlay?: () => void;
  className?: string;
}

export function ArtistCardCompact({ artist, onPlay, className }: ArtistCardCompactProps) {
  const [imageError, setImageError] = useState(false);
  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, 80)
    : null;

  const showImage = coverArtUrl && !imageError;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors cursor-pointer",
        className
      )}
    >
      <Link
        href={`/library/artists/${artist.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className="relative w-12 h-12 rounded-full overflow-hidden bg-muted shrink-0">
          {showImage ? (
            <Image
              src={coverArtUrl}
              alt={artist.name}
              fill
              className="object-cover"
              unoptimized
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/20">
              <span className="text-lg">👤</span>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{artist.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {formatCount(artist.albumCount, "album")}
          </p>
        </div>
      </Link>
      
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.preventDefault();
          onPlay?.();
        }}
      >
        <Play className="w-4 h-4" />
      </Button>
    </div>
  );
}
