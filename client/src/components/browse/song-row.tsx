"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { formatDuration } from "@/lib/utils/format";
import { currentTrackAtom, playNowAtom } from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";
import { useAudioEngine } from "@/lib/audio/hooks";
import { MediaRow, MediaRowSkeleton, RowActions } from "@/components/shared/media-row";
import { SongContextMenu, SongDropdownMenu } from "./song-context-menu";

// Audio bar visualizer for now playing indicator - uses CSS animations
function NowPlayingBars({ className, isAnimating = true }: { className?: string; isAnimating?: boolean }) {
  return (
    <div className={cn("flex items-end justify-center gap-0.5 h-3", className)}>
      <span 
        className={cn("w-[3px] bg-primary rounded-sm", isAnimating && "animate-bar-1")}
        style={{ animationDuration: "0.4s", height: isAnimating ? undefined : "6px" }}
      />
      <span 
        className={cn("w-[3px] bg-primary rounded-sm", isAnimating && "animate-bar-2")}
        style={{ animationDuration: "0.5s", height: isAnimating ? undefined : "10px" }}
      />
      <span 
        className={cn("w-[3px] bg-primary rounded-sm", isAnimating && "animate-bar-3")}
        style={{ animationDuration: "0.35s", height: isAnimating ? undefined : "6px" }}
      />
      <span 
        className={cn("w-[3px] bg-primary rounded-sm", isAnimating && "animate-bar-4")}
        style={{ animationDuration: "0.45s", height: isAnimating ? undefined : "8px" }}
      />
    </div>
  );
}

// Track number column - shows number or now playing indicator
interface TrackIndexProps {
  index: number;
  isCurrentTrack: boolean;
  isPlaying: boolean;
}

function TrackIndex({ index, isCurrentTrack, isPlaying }: TrackIndexProps) {
  return (
    <div className="w-8 text-center shrink-0">
      <span className={cn(
        "text-sm tabular-nums text-muted-foreground",
        isCurrentTrack && "text-primary"
      )}>
        {isCurrentTrack ? (
          <NowPlayingBars isAnimating={isPlaying} />
        ) : (
          index + 1
        )}
      </span>
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
  const { togglePlayPause } = useAudioEngine();
  const [isStarred, setIsStarred] = useState(!!song.starred);

  // Don't show track as current when playback has ended
  const isCurrentTrack = currentTrack?.id === song.id && playbackState !== "ended";
  const isPlaying = isCurrentTrack && playbackState === "playing";

  const coverArtUrl = showCover && song.coverArt
    ? getClient()?.getCoverArtUrl(song.coverArt, 48)
    : undefined;

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

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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

  // Build subtitle with clickable links
  const subtitle = (
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
  );

  return (
    <motion.div
      data-testid="song-row"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <MediaRow
        coverArt={showCover ? coverArtUrl : undefined}
        title={song.title}
        colorSeed={song.album}
        coverType="song"
        isActive={isCurrentTrack}
        isPlaying={isPlaying}
        onPlay={showCover ? handlePlay : undefined}
        onDoubleClick={handlePlay}
        leftContent={
          index !== undefined ? (
            <TrackIndex
              index={index}
              isCurrentTrack={isCurrentTrack}
              isPlaying={isPlaying}
            />
          ) : undefined
        }
        actions={
          <RowActions
            onStar={handleStar}
            isStarred={isStarred}
            dropdownMenu={
              <SongDropdownMenu
                song={song}
                queueSongs={queueSongs}
              />
            }
          />
        }
        rightContent={
          <span className="text-sm text-muted-foreground tabular-nums shrink-0">
            {formatDuration(song.duration)}
          </span>
        }
        contextMenu={(children) => (
          <SongContextMenu song={song} queueSongs={queueSongs}>
            {children}
          </SongContextMenu>
        )}
        className={className}
      >
        {/* Custom content with clickable links */}
        <div className="min-w-0 flex flex-col flex-1">
          <span className={cn(
            "text-sm font-medium truncate",
            isCurrentTrack && "text-primary"
          )}>
            {song.title}
          </span>
          {(showArtist || showAlbum) && subtitle}
        </div>
      </MediaRow>
    </motion.div>
  );
}

export function SongRowSkeleton({ showCover = false, showIndex = true }: { showCover?: boolean; showIndex?: boolean }) {
  return (
    <MediaRowSkeleton
      showCover={showCover}
      showLeftContent={showIndex}
      showRightContent={true}
    />
  );
}

// Compact song row for queue panel
interface SongRowCompactProps {
  song: Song;
  isCurrentTrack?: boolean;
  className?: string;
}

export function SongRowCompact({
  song,
  isCurrentTrack,
  className,
}: SongRowCompactProps) {
  const coverArtUrl = song.coverArt
    ? getClient()?.getCoverArtUrl(song.coverArt, 48)
    : undefined;

  return (
    <MediaRow
      coverArt={coverArtUrl}
      title={song.title}
      subtitle={song.artist}
      colorSeed={song.album}
      coverType="song"
      isActive={isCurrentTrack}
      rightContent={
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDuration(song.duration)}
        </span>
      }
      className={cn("gap-3 p-2 px-2", className)}
    />
  );
}
