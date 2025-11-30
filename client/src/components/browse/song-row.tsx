"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Play, Pause, Heart } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Song } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { formatDuration } from "@/lib/utils/format";
import { currentTrackAtom, playNowAtom, addToQueueAtom } from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";
import { useAudioEngine } from "@/lib/audio/hooks";
import { SongContextMenu, SongDropdownMenu } from "./song-context-menu";

// Audio bar visualizer for now playing indicator - uses CSS animations
function NowPlayingBars({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-end justify-center gap-0.5 h-3", className)}>
      <span 
        className="w-[3px] bg-primary rounded-sm animate-bar-1"
        style={{ animationDuration: "0.4s" }}
      />
      <span 
        className="w-[3px] bg-primary rounded-sm animate-bar-2"
        style={{ animationDuration: "0.5s" }}
      />
      <span 
        className="w-[3px] bg-primary rounded-sm animate-bar-3"
        style={{ animationDuration: "0.35s" }}
      />
      <span 
        className="w-[3px] bg-primary rounded-sm animate-bar-4"
        style={{ animationDuration: "0.45s" }}
      />
    </div>
  );
}

interface SongRowProps {
  song: Song;
  index?: number;
  showAlbum?: boolean;
  showArtist?: boolean;
  showCover?: boolean;
  queueSongs?: Song[]; // All songs in current context for queue
  className?: string;
}

export function SongRow({
  song,
  index,
  showAlbum = true,
  showArtist = true,
  showCover = false,
  queueSongs,
  className,
}: SongRowProps) {
  const currentTrack = useAtomValue(currentTrackAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const { togglePlayPause } = useAudioEngine();
  const [isStarred, setIsStarred] = useState(!!song.starred);

  const isCurrentTrack = currentTrack?.id === song.id;
  const isPlaying = isCurrentTrack && playbackState === "playing";

  const coverArtUrl = showCover && song.coverArt
    ? getClient()?.getCoverArtUrl(song.coverArt, 48)
    : null;

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlayPause();
    } else if (queueSongs) {
      const songIndex = queueSongs.findIndex((s) => s.id === song.id);
      playNow(queueSongs, songIndex >= 0 ? songIndex : 0);
    } else {
      playNow(song);
    }
  };

  const handleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ id: song.id });
        setIsStarred(false);
        toast.success(`Removed from favorites`);
      } else {
        await client.star({ id: song.id });
        setIsStarred(true);
        toast.success(`Added to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  const rowContent = (
    <motion.div
      data-testid="song-row"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        "group flex items-center gap-4 px-4 pr-6 py-2 rounded-md hover:bg-accent/50 transition-colors",
        "cursor-pointer",
        isCurrentTrack && "bg-accent/30",
        className
      )}
      onClick={handlePlay}
    >
      {/* Index or Play button */}
      {index !== undefined && (
        <div className="w-8 text-center shrink-0">
          <span className={cn(
            "text-sm tabular-nums text-muted-foreground group-hover:hidden",
            isCurrentTrack && "text-primary"
          )}>
            {isCurrentTrack ? (
              <NowPlayingBars />
            ) : (
              index + 1
            )}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="hidden group-hover:flex h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              handlePlay();
            }}
          >
            {isPlaying ? (
              <Pause className="w-3 h-3" />
            ) : (
              <Play className="w-3 h-3 ml-0.5" />
            )}
          </Button>
        </div>
      )}

      {/* Cover art (optional) */}
      {showCover && (
        <div className="relative w-10 h-10 rounded overflow-hidden bg-muted shrink-0">
          {coverArtUrl ? (
            <Image
              src={coverArtUrl}
              alt={song.album || "Album cover"}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted text-xs">
              🎵
            </div>
          )}
        </div>
      )}

      {/* Song info */}
      <div className="min-w-0 flex flex-col flex-1">
        <span className={cn(
          "text-sm font-medium truncate",
          isCurrentTrack && "text-primary"
        )}>
          {song.title}
        </span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
          {showArtist && (
            <Link
              href={`/library/artists/${song.artistId}`}
              className="hover:underline hover:text-foreground shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {song.artist}
            </Link>
          )}
          {showArtist && showAlbum && <span className="shrink-0">•</span>}
          {showAlbum && (
            <Link
              href={`/library/albums/${song.albumId}`}
              className="hover:underline hover:text-foreground truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {song.album}
            </Link>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            handleStar();
          }}
        >
          <Heart className={cn("w-4 h-4", isStarred && "fill-red-500 text-red-500")} />
        </Button>
        <SongDropdownMenu song={song} queueSongs={queueSongs} />
      </div>

      {/* Duration */}
      <span className="text-sm text-muted-foreground tabular-nums shrink-0">
        {formatDuration(song.duration)}
      </span>
    </motion.div>
  );

  return (
    <SongContextMenu song={song} queueSongs={queueSongs}>
      {rowContent}
    </SongContextMenu>
  );
}

export function SongRowSkeleton({ showCover = false }: { showCover?: boolean }) {
  return (
    <div
      className="grid gap-4 px-4 py-2 items-center"
      style={{
        gridTemplateColumns: showCover ? "auto 1fr auto" : "2rem 1fr auto",
      }}
    >
      <Skeleton className="w-8 h-4" />
      {showCover && <Skeleton className="w-10 h-10 rounded" />}
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-10" />
    </div>
  );
}

// Compact song row for queue panel
interface SongRowCompactProps {
  song: Song;
  isCurrentTrack?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function SongRowCompact({
  song,
  isCurrentTrack,
  onRemove,
  className,
}: SongRowCompactProps) {
  const coverArtUrl = song.coverArt
    ? getClient()?.getCoverArtUrl(song.coverArt, 48)
    : null;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors",
        isCurrentTrack && "bg-accent/30",
        className
      )}
    >
      <div className="relative w-10 h-10 rounded overflow-hidden bg-muted shrink-0">
        {coverArtUrl ? (
          <Image
            src={coverArtUrl}
            alt={song.album || "Album cover"}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs">🎵</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn(
          "text-sm font-medium truncate",
          isCurrentTrack && "text-primary"
        )}>
          {song.title}
        </p>
        <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatDuration(song.duration)}
      </span>
    </div>
  );
}
