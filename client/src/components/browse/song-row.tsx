"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { formatDuration, formatDate } from "@/lib/utils/format";
import { currentTrackAtom, playNowAtom } from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";
import { useStarred } from "@/lib/store/starred";
import { useAudioEngine } from "@/lib/audio/hooks";
import { MediaRow, MediaRowSkeleton, RowActions } from "@/components/shared/media-row";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
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

// Track number column - shows number, now playing indicator, or selection checkbox on hover
interface TrackIndexProps {
  index: number;
  isCurrentTrack: boolean;
  isPlaying: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
}

function TrackIndex({ index, isCurrentTrack, isPlaying, isSelected, isSelectionMode, onSelect }: TrackIndexProps) {
  const showCheckbox = isSelected || isSelectionMode;
  
  return (
    <div 
      className="w-8 text-center shrink-0 relative cursor-pointer"
      onClick={(e) => {
        if (onSelect) {
          e.preventDefault();
          e.stopPropagation();
          onSelect(e);
        }
      }}
    >
      {/* Checkbox - shows when selected, in selection mode, or on hover */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity",
          showCheckbox
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
        )}
      >
        <div
          className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
            isSelected
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/50 hover:border-primary/50"
          )}
        >
          {isSelected && <Check className="w-3 h-3" />}
        </div>
      </div>
      {/* Track number or now playing indicator - hidden when checkbox is visible */}
      <span
        className={cn(
          "text-sm tabular-nums text-muted-foreground transition-opacity",
          isCurrentTrack && "text-primary",
          showCheckbox ? "opacity-0 pointer-events-none" : "group-hover:opacity-0 group-hover:pointer-events-none"
        )}
      >
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
  showDuration?: boolean;
  showPlayCount?: boolean;
  showYear?: boolean;
  showDateAdded?: boolean;
  queueSongs?: Song[]; // All songs in current context for queue
  // Selection props
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  className?: string;
}

export function SongRow({
  song,
  index,
  showAlbum = true,
  showArtist = true,
  showCover = false,
  showDuration = true,
  showPlayCount = false,
  showYear = false,
  showDateAdded = false,
  queueSongs,
  isSelected = false,
  isSelectionMode = false,
  onSelect,
  className,
}: SongRowProps) {
  const currentTrack = useAtomValue(currentTrackAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const playNow = useSetAtom(playNowAtom);
  const { togglePlayPause } = useAudioEngine();
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);

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

  const handleClick = (e: React.MouseEvent) => {
    // If holding modifier keys or in selection mode, handle selection
    if (onSelect && (e.shiftKey || e.ctrlKey || e.metaKey || isSelectionMode)) {
      e.preventDefault();
      onSelect(e);
    }
  };

  const handleStar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleStar();
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
      onClick={handleClick}
    >
      <MediaRow
        coverArt={showCover ? coverArtUrl : undefined}
        title={song.title}
        colorSeed={song.album}
        coverType="song"
        isActive={isCurrentTrack}
        isPlaying={isPlaying}
        isSelected={isSelected}
        onPlay={showCover ? handlePlay : undefined}
        onDoubleClick={handlePlay}
        leftContent={
          index !== undefined ? (
            <TrackIndex
              index={index}
              isCurrentTrack={isCurrentTrack}
              isPlaying={isPlaying}
              isSelected={isSelected}
              isSelectionMode={isSelectionMode}
              onSelect={onSelect}
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
          <div className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums shrink-0">
            {showYear && song.year && (
              <span className="hidden sm:inline w-12 text-right">{song.year}</span>
            )}
            {showPlayCount && (
              <span className="hidden md:inline w-12 text-right">{song.playCount ?? 0}</span>
            )}
            {showDateAdded && song.created && (
              <span className="hidden lg:inline w-24 text-right">{formatDate(song.created)}</span>
            )}
            {showDuration && (
              <span className="w-12 text-right">{formatDuration(song.duration)}</span>
            )}
          </div>
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
      showIndex={showIndex}
      showRightContent={true}
    />
  );
}

// Song card for grid view
interface SongCardProps {
  song: Song;
  queueSongs?: Song[];
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  className?: string;
}

export function SongCard({ song, queueSongs, isSelected, isSelectionMode, onSelect, className }: SongCardProps) {
  const currentTrack = useAtomValue(currentTrackAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const playNow = useSetAtom(playNowAtom);
  const { togglePlayPause } = useAudioEngine();
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);

  const isCurrentTrack = currentTrack?.id === song.id && playbackState !== "ended";

  const coverArtUrl = song.coverArt
    ? getClient()?.getCoverArtUrl(song.coverArt, 300)
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

  const handleStar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleStar();
  };

  const subtitleContent = (
    <>
      <Link
        href={`/library/artists/details?id=${song.artistId}`}
        className="hover:underline hover:text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {song.artist}
      </Link>
      <span> • {formatDuration(song.duration)}</span>
    </>
  );

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={song.title}
      subtitleContent={subtitleContent}
      href={`/library/albums/details?id=${song.albumId}`}
      colorSeed={song.album}
      coverType="song"
      onPlay={handlePlay}
      onStar={handleStar}
      isStarred={isStarred}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect}
      dropdownMenu={<SongDropdownMenu song={song} queueSongs={queueSongs} />}
      contextMenu={(children) => (
        <SongContextMenu song={song} queueSongs={queueSongs}>
          {children}
        </SongContextMenu>
      )}
      withGlow
      className={className}
    />
  );
}

export function SongCardSkeleton() {
  return <MediaCardSkeleton coverShape="square" />;
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
