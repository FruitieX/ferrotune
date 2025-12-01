"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Play, Pause, Heart, Clock, Music } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Song } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { formatDuration } from "@/lib/utils/format";
import { currentTrackAtom, playNowAtom } from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";
import { useAudioEngine } from "@/lib/audio/hooks";
import { SongContextMenu, SongDropdownMenu } from "./song-context-menu";

// Audio bar visualizer for now playing indicator
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

interface TrackListProps {
  songs: Song[];
  isLoading?: boolean;
  showCover?: boolean;
  showAlbum?: boolean;
  showArtist?: boolean;
  showHeader?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function TrackList({
  songs,
  isLoading = false,
  showCover = false,
  showAlbum = true,
  showArtist = true,
  showHeader = true,
  emptyMessage = "No tracks",
  className,
}: TrackListProps) {
  if (isLoading) {
    return (
      <div className={cn("divide-y divide-border/50", className)}>
        {Array.from({ length: 10 }).map((_, i) => (
          <TrackRowSkeleton key={i} showCover={showCover} />
        ))}
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      {showHeader && (
        <div
          className="grid gap-4 px-4 py-2 border-b border-border text-sm text-muted-foreground"
          style={{
            gridTemplateColumns: showCover
              ? "2.5rem 1fr auto auto"
              : "2rem 1fr auto auto",
          }}
        >
          <span className="text-center">#</span>
          <span>Title</span>
          <span className="hidden sm:block">
            <Heart className="w-4 h-4" />
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
          </span>
        </div>
      )}

      {/* Track list */}
      <div className="divide-y divide-border/50">
        {songs.map((song, index) => (
          <TrackRow
            key={`${song.id}-${index}`}
            song={song}
            index={index}
            showCover={showCover}
            showAlbum={showAlbum}
            showArtist={showArtist}
            queueSongs={songs}
          />
        ))}
      </div>
    </div>
  );
}

interface TrackRowProps {
  song: Song;
  index: number;
  showCover?: boolean;
  showAlbum?: boolean;
  showArtist?: boolean;
  queueSongs?: Song[];
  className?: string;
}

export function TrackRow({
  song,
  index,
  showCover = false,
  showAlbum = true,
  showArtist = true,
  queueSongs,
  className,
}: TrackRowProps) {
  const currentTrack = useAtomValue(currentTrackAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const playNow = useSetAtom(playNowAtom);
  const { togglePlayPause } = useAudioEngine();
  const [isStarred, setIsStarred] = useState(!!song.starred);
  const [coverError, setCoverError] = useState(false);
  const [isVisible, setIsVisible] = useState(!showCover); // Only lazy load if showing cover
  const rowRef = useRef<HTMLDivElement>(null);

  // Don't show track as current when playback has ended
  const isCurrentTrack = currentTrack?.id === song.id && playbackState !== "ended";
  const isPlaying = isCurrentTrack && playbackState === "playing";

  // Only load cover art when row is visible
  useEffect(() => {
    if (!showCover || isVisible) return;
    
    const element = rowRef.current;
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
        rootMargin: "50px",
        threshold: 0,
      }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [showCover, isVisible]);

  const coverArtUrl =
    showCover && song.coverArt && !coverError && isVisible
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
    <div
      ref={rowRef}
      data-testid="track-row"
      className={cn(
        "group flex items-center gap-4 px-4 pr-6 py-2 rounded-md hover:bg-accent/60 transition-colors",
        "cursor-pointer",
        isCurrentTrack && "bg-accent/40",
        className
      )}
      onDoubleClick={handlePlay}
    >
      {/* Index or Play button */}
      <div className="w-8 text-center shrink-0">
        <span
          className={cn(
            "text-sm tabular-nums text-muted-foreground group-hover:hidden",
            isCurrentTrack && "text-primary"
          )}
        >
          {isCurrentTrack ? <NowPlayingBars /> : index + 1}
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
              onError={() => setCoverError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20 text-xs">
              🎵
            </div>
          )}
        </div>
      )}

      {/* Song info */}
      <div className="min-w-0 flex flex-col flex-1">
        <span
          className={cn(
            "text-sm font-medium truncate",
            isCurrentTrack && "text-primary"
          )}
        >
          {song.title}
        </span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
          {showArtist && (
            <Link
              href={`/library/artists/details?id=${song.artistId}`}
              className="hover:underline hover:text-foreground shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {song.artist}
            </Link>
          )}
          {showArtist && showAlbum && <span className="shrink-0">•</span>}
          {showAlbum && (
            <Link
              href={`/library/albums/details?id=${song.albumId}`}
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
          <Heart
            className={cn(
              "w-4 h-4",
              isStarred && "fill-red-500 text-red-500"
            )}
          />
        </Button>
        <SongDropdownMenu song={song} queueSongs={queueSongs} />
      </div>

      {/* Duration */}
      <span className="text-sm text-muted-foreground tabular-nums shrink-0">
        {formatDuration(song.duration)}
      </span>
    </div>
  );

  return (
    <SongContextMenu song={song} queueSongs={queueSongs}>
      {rowContent}
    </SongContextMenu>
  );
}

export function TrackRowSkeleton({ showCover = false }: { showCover?: boolean }) {
  return (
    <div
      className="grid gap-4 px-4 py-2 items-center"
      style={{
        gridTemplateColumns: showCover ? "2.5rem 1fr auto" : "2rem 1fr auto",
      }}
    >
      <Skeleton className="w-6 h-4" />
      {showCover && <Skeleton className="w-10 h-10 rounded" />}
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-10" />
    </div>
  );
}
