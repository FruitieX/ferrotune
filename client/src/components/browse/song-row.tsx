"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { Check, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { formatDuration, formatDate } from "@/lib/utils/format";
import { currentSongAtom, serverQueueStateAtom, startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import { playbackStateAtom } from "@/lib/store/player";
import { shuffleExcludesAtom } from "@/lib/store/shuffle-excludes";
import { useStarred } from "@/lib/store/starred";
import { useAudioEngine } from "@/lib/audio/hooks";
import { MediaRow, MediaRowSkeleton, RowActions } from "@/components/shared/media-row";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NowPlayingBars } from "@/components/shared/now-playing-bars";
import { SongContextMenu, SongDropdownMenu } from "./song-context-menu";

// Track number column - shows number, now playing indicator, or selection checkbox on hover
interface TrackIndexProps {
  index: number;
  songId: string;
  isCurrentTrack: boolean;
  isPlaying: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
}

function TrackIndex({ index, songId, isCurrentTrack, isPlaying, isSelected, isSelectionMode, onSelect }: TrackIndexProps) {
  const showCheckbox = isSelected || isSelectionMode;
  
  return (
    <div 
      className="w-8 text-center shrink-0 relative cursor-pointer"
      onClick={(e) => {
        if (onSelect) {
          e.preventDefault();
          e.stopPropagation();
          onSelect(songId, e);
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
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select track ${index + 1}`}
          className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
            isSelected
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/50 hover:border-primary/50"
          )}
        >
          {isSelected && <Check className="w-3 h-3" />}
        </button>
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

/** Source info for queueing from a collection */
export interface QueueSource {
  type: QueueSourceType;
  id?: string | null;
  name?: string | null;
  /** Filters to apply when materializing (for library/search) */
  filters?: Record<string, unknown>;
  /** Sort configuration */
  sort?: { field: string; direction: string };
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
  showLastPlayed?: boolean;
  queueSongs?: Song[]; // All songs in current context for queue (fallback for explicit song lists)
  queueSource?: QueueSource; // Source info for server-side queue materialization
  // Selection props
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
  // Playlist props
  showRemoveFromPlaylist?: boolean;
  onRemoveFromPlaylist?: (songId: string) => void;
  // Move to position props
  showMoveToPosition?: boolean;
  onMoveToPosition?: (song: Song, index: number) => void;
  // Refine match props (for auto-matched playlist entries)
  showRefineMatch?: boolean;
  onRefineMatch?: (song: Song, index: number) => void;
  /**
   * When true, this row is the currently playing track in the queue.
   * Use this for views with duplicate songs (like playlists) where we need
   * to distinguish between multiple instances of the same song.
   * When undefined, the default behavior (matching by song ID) is used.
   */
  isCurrentQueuePosition?: boolean;
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
  showLastPlayed = false,
  queueSongs,
  queueSource,
  isSelected = false,
  isSelectionMode = false,
  onSelect,
  showRemoveFromPlaylist = false,
  onRemoveFromPlaylist,
  showMoveToPosition = false,
  onMoveToPosition,
  showRefineMatch = false,
  onRefineMatch,
  isCurrentQueuePosition,
  className,
}: SongRowProps) {
  const currentSong = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const shuffleExcludes = useAtomValue(shuffleExcludesAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const { togglePlayPause } = useAudioEngine();
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);

  // Don't show track as current when playback has ended
  // If isCurrentQueuePosition is explicitly set (for views with duplicate songs like playlists),
  // use that to determine if this specific row is the current track.
  // Otherwise, fall back to matching by song ID.
  const isCurrentTrack = isCurrentQueuePosition !== undefined
    ? isCurrentQueuePosition && playbackState !== "ended"
    : currentSong?.id === song.id && playbackState !== "ended";
  const isPlaying = isCurrentTrack && playbackState === "playing";
  const isExcludedFromShuffle = shuffleExcludes.has(song.id);

  const coverArtUrl = showCover && song.coverArt
    ? getClient()?.getCoverArtUrl(song.coverArt, 48)
    : undefined;

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlayPause();
    } else if (queueSource?.type && queueSource.type !== "other") {
      // Use server-side queue materialization for known sources
      // Use the index prop if available, otherwise try to find from queueSongs
      const songIndex = index ?? queueSongs?.findIndex((s) => s.id === song.id) ?? 0;
      startQueue({
        sourceType: queueSource.type,
        sourceId: queueSource.id ?? undefined,
        sourceName: queueSource.name ?? undefined,
        startIndex: songIndex >= 0 ? songIndex : 0,
        filters: queueSource.filters,
        sort: queueSource.sort,
      });
    } else if (queueSongs) {
      // Fallback to explicit song IDs for custom lists (selections, etc.)
      const songIndex = queueSongs.findIndex((s) => s.id === song.id);
      startQueue({
        sourceType: queueSource?.type || "other",
        sourceName: queueSource?.name ?? undefined,
        songIds: queueSongs.map(s => s.id),
        startIndex: songIndex >= 0 ? songIndex : 0,
      });
    } else {
      // Single song
      startQueue({
        sourceType: "other",
        songIds: [song.id],
        startIndex: 0,
      });
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // If holding modifier keys or in selection mode, handle selection
    if (onSelect && (e.shiftKey || e.ctrlKey || e.metaKey || isSelectionMode)) {
      e.preventDefault();
      onSelect(song.id, e);
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
        colorSeed={song.album ?? undefined}
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
              songId={song.id}
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
                songIndex={index}
                queueSource={queueSource}
                showRemoveFromPlaylist={showRemoveFromPlaylist}
                onRemoveFromPlaylist={onRemoveFromPlaylist}
                showMoveToPosition={showMoveToPosition}
                onMoveToPosition={onMoveToPosition}
                moveToPositionLabel="Move to Position"
                showRefineMatch={showRefineMatch}
                onRefineMatch={onRefineMatch}
              />
            }
          />
        }
        rightContent={
          <div className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums shrink-0">
            {isExcludedFromShuffle && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="relative hidden sm:inline-flex items-center justify-center w-4 h-4">
                    <Shuffle className="w-3.5 h-3.5 text-muted-foreground/60" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="w-px h-5 bg-muted-foreground/60 rotate-45 transform" />
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Excluded from shuffle when playing the full library</p>
                </TooltipContent>
              </Tooltip>
            )}
            {showYear && song.year && (
              <span className="hidden sm:inline w-12 text-right">{song.year}</span>
            )}
            {showPlayCount && (
              <span className="hidden md:inline w-12 text-right">{song.playCount ?? 0}</span>
            )}
            {showLastPlayed && (
              <span className="hidden lg:inline w-24 text-right">{song.lastPlayed ? formatDate(song.lastPlayed) : "Never"}</span>
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
          <SongContextMenu 
            song={song} 
            queueSongs={queueSongs}
            songIndex={index}
            queueSource={queueSource}
            showRemoveFromPlaylist={showRemoveFromPlaylist}
            onRemoveFromPlaylist={onRemoveFromPlaylist}
            showMoveToPosition={showMoveToPosition}
            onMoveToPosition={onMoveToPosition}
            moveToPositionLabel="Move to Position"
            showRefineMatch={showRefineMatch}
            onRefineMatch={onRefineMatch}
          >
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
  index?: number;
  queueSongs?: Song[];
  queueSource?: QueueSource;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
  // Move to position props
  showMoveToPosition?: boolean;
  onMoveToPosition?: (song: Song, index: number) => void;
  // Refine match props (for auto-matched playlist entries)
  showRefineMatch?: boolean;
  onRefineMatch?: (song: Song, index: number) => void;
  /**
   * When true, this card is the currently playing track in the queue.
   * Use this for views with duplicate songs (like playlists) where we need
   * to distinguish between multiple instances of the same song.
   * When undefined, the default behavior (matching by song ID) is used.
   */
  isCurrentQueuePosition?: boolean;
  className?: string;
}

export function SongCard({ song, index, queueSongs, queueSource, isSelected, isSelectionMode, onSelect, showMoveToPosition, onMoveToPosition, showRefineMatch, onRefineMatch, isCurrentQueuePosition, className }: SongCardProps) {
  const currentSong = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const shuffleExcludes = useAtomValue(shuffleExcludesAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const { togglePlayPause } = useAudioEngine();
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);

  // If isCurrentQueuePosition is explicitly set (for views with duplicate songs like playlists),
  // use that to determine if this specific card is the current track.
  // Otherwise, fall back to matching by song ID.
  const isCurrentTrack = isCurrentQueuePosition !== undefined
    ? isCurrentQueuePosition && playbackState !== "ended"
    : currentSong?.id === song.id && playbackState !== "ended";
  const isExcludedFromShuffle = shuffleExcludes.has(song.id);

  const coverArtUrl = song.coverArt
    ? getClient()?.getCoverArtUrl(song.coverArt, 300)
    : undefined;

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlayPause();
    } else if (queueSource?.type && queueSource.type !== "other") {
      // Use server-side queue materialization for known sources
      // Use the index prop if available, otherwise try to find from queueSongs
      const songIndex = index ?? queueSongs?.findIndex((s) => s.id === song.id) ?? 0;
      startQueue({
        sourceType: queueSource.type,
        sourceId: queueSource.id ?? undefined,
        sourceName: queueSource.name ?? undefined,
        startIndex: songIndex >= 0 ? songIndex : 0,
        filters: queueSource.filters,
        sort: queueSource.sort,
      });
    } else if (queueSongs) {
      // Fallback to explicit song IDs for custom lists
      const songIndex = queueSongs.findIndex((s) => s.id === song.id);
      startQueue({
        sourceType: queueSource?.type || "other",
        sourceName: queueSource?.name ?? undefined,
        songIds: queueSongs.map(s => s.id),
        startIndex: songIndex >= 0 ? songIndex : 0,
      });
    } else {
      // Single song
      startQueue({
        sourceType: "other",
        songIds: [song.id],
        startIndex: 0,
      });
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
      {isExcludedFromShuffle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="relative inline-flex items-center justify-center w-4 h-4 ml-1">
              <Shuffle className="w-3 h-3 text-muted-foreground/60" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-px h-4 bg-muted-foreground/60 rotate-45 transform" />
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Excluded from shuffle</p>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={song.title}
      subtitleContent={subtitleContent}
      href={`/library/albums/details?id=${song.albumId}`}
      colorSeed={song.album ?? undefined}
      coverType="song"
      onPlay={handlePlay}
      onStar={handleStar}
      isStarred={isStarred}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect ? (e) => onSelect(song.id, e) : undefined}
      dropdownMenu={<SongDropdownMenu song={song} queueSongs={queueSongs} songIndex={index} queueSource={queueSource} showMoveToPosition={showMoveToPosition} onMoveToPosition={onMoveToPosition} moveToPositionLabel="Move to Position" showRefineMatch={showRefineMatch} onRefineMatch={onRefineMatch} />}
      contextMenu={(children) => (
        <SongContextMenu song={song} queueSongs={queueSongs} songIndex={index} queueSource={queueSource} showMoveToPosition={showMoveToPosition} onMoveToPosition={onMoveToPosition} moveToPositionLabel="Move to Position" showRefineMatch={showRefineMatch} onRefineMatch={onRefineMatch}>
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
      subtitle={song.artist ?? undefined}
      colorSeed={song.album ?? undefined}
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
