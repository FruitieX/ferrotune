"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Play, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Album } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";

interface AlbumCardProps {
  album: Album;
  onPlay?: () => void;
  className?: string;
}

export function AlbumCard({ album, onPlay, className }: AlbumCardProps) {
  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 300)
    : null;

  return (
    <motion.article
      data-testid="album-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group relative p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer",
        className
      )}
    >
      <Link href={`/library/albums/${album.id}`} className="block">
        <div className="relative aspect-square rounded-md overflow-hidden bg-muted mb-4 album-glow">
          {coverArtUrl ? (
            <Image
              src={coverArtUrl}
              alt={album.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <span className="text-4xl text-muted-foreground">🎵</span>
            </div>
          )}
          
          {/* Play button overlay */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            whileHover={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
          >
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
          </motion.div>
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
    </motion.article>
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
  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 80)
    : null;

  return (
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
          {coverArtUrl ? (
            <Image
              src={coverArtUrl}
              alt={album.name}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <span className="text-lg">🎵</span>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{album.name}</p>
          <p className="text-xs text-muted-foreground truncate">{album.artist}</p>
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
