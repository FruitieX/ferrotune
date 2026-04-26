"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import { Check, Shuffle, Ban, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { formatDuration, formatDate } from "@/lib/utils/format";
import {
  currentSongAtom,
  startQueueAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import { playbackStateAtom } from "@/lib/store/player";
import { shuffleExcludesAtom } from "@/lib/store/shuffle-excludes";
import { disabledSongsAtom } from "@/lib/store/disabled-songs";
import { useStarred } from "@/lib/store/starred";
import { useAudioEngine } from "@/lib/audio/hooks";
import {
  MediaRow,
  MediaRowSkeleton,
  RowActions,
} from "@/components/shared/media-row";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NowPlayingBars } from "@/components/shared/now-playing-bars";
import { useHasFinePointer } from "@/lib/hooks/use-media-query";
import { SongContextMenu, SongDropdownMenu } from "./song-context-menu";

// Track number column - shows number, now playing indicator, or selection checkbox on hover
interface TrackIndexProps {
  index: number;
  trackNumber?: number | null;
  songId: string;
  isCurrentTrack: boolean;
  isPlaying: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
}

function TrackIndex({
  index,
  trackNumber,
  songId,
  isCurrentTrack,
  isPlaying,
  isSelected,
  isSelectionMode,
  onSelect,
}: TrackIndexProps) {
  const hasFinePointer = useHasFinePointer();
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
      {/* Checkbox - shows when selected, in selection mode, or on hover (pointer devices only) */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity",
          showCheckbox
            ? "opacity-100"
            : hasFinePointer
              ? "opacity-0 group-hover:opacity-100"
              : "hidden",
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select track ${trackNumber ?? index + 1}`}
          className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
            isSelected
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/50 hover:border-primary/50",
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
          showCheckbox
            ? "opacity-0 pointer-events-none"
            : hasFinePointer
              ? "group-hover:opacity-0 group-hover:pointer-events-none"
              : "",
        )}
      >
        {isCurrentTrack ? (
          <NowPlayingBars isAnimating={isPlaying} />
        ) : (
          (trackNumber ?? index + 1)
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
  songIndex?: number;
  trackNumber?: number | null;
  showAlbum?: boolean;
  showArtist?: boolean;
  showCover?: boolean;
  showDuration?: boolean;
  showPlayCount?: boolean;
  showYear?: boolean;
  showDateAdded?: boolean;
  /** Override the date shown in "Date Added" column (e.g., for playlist entry dates) */
  dateAddedOverride?: string | null;
  showLastPlayed?: boolean;
  showStarred?: boolean;
  showGenre?: boolean;
  showBitRate?: boolean;
  showFormat?: boolean;
  showRating?: boolean;
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
  // Unmatch props (for reverting matched playlist entries)
  showUnmatch?: boolean;
  onUnmatch?: (song: Song, index: number) => void;
  /**
   * When true, this row is the currently playing track in the queue.
   * Use this for views with duplicate songs (like playlists) where we need
   * to distinguish between multiple instances of the same song.
   * When undefined, the default behavior (matching by song ID) is used.
   */
  isCurrentQueuePosition?: boolean;
  /**
   * When true, inline image data was already requested from the server.
   * Don't make separate cover art requests for songs missing inline data.
   */
  inlineImagesRequested?: boolean;
  /** Whether this row should be visually highlighted (e.g. when linked from another page) */
  isHighlighted?: boolean;
  /** Disc number to show as a header above this row (for multi-disc albums) */
  discHeader?: number;
  className?: string;
}

export function SongRow({
  song,
  index,
  songIndex,
  trackNumber,
  showAlbum = true,
  showArtist = true,
  showCover = false,
  showDuration = true,
  showPlayCount = false,
  showYear = false,
  showDateAdded = false,
  dateAddedOverride,
  showLastPlayed = false,
  showStarred = false,
  showGenre = false,
  showBitRate = false,
  showFormat = false,
  showRating = false,
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
  showUnmatch = false,
  onUnmatch,
  isCurrentQueuePosition,
  inlineImagesRequested = false,
  isHighlighted = false,
  discHeader,
  className,
}: SongRowProps) {
  const currentSong = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const shuffleExcludes = useAtomValue(shuffleExcludesAtom);
  const disabledSongs = useAtomValue(disabledSongsAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const { togglePlayPause } = useAudioEngine();
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);
  const resolvedSongIndex = songIndex ?? index;

  // Don't show track as current when playback has ended
  // If isCurrentQueuePosition is explicitly set (for views with duplicate songs like playlists),
  // use that to determine if this specific row is the current track.
  // Otherwise, fall back to matching by song ID.
  const isCurrentTrack =
    isCurrentQueuePosition !== undefined
      ? isCurrentQueuePosition && playbackState !== "ended"
      : currentSong?.id === song.id && playbackState !== "ended";
  const isPlaying = isCurrentTrack && playbackState === "playing";
  const isExcludedFromShuffle = shuffleExcludes.has(song.id);
  const isDisabled = disabledSongs.has(song.id);

  // Use inline thumbnail if available, otherwise construct URL for fetching
  // If inline images were already requested, don't fetch separately (server chose not to include it)
  const coverArtUrl =
    showCover && song.coverArt && !song.coverArtData && !inlineImagesRequested
      ? getClient()?.getCoverArtUrl(song.coverArt, "small")
      : undefined;

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlayPause();
    } else if (queueSource?.type && queueSource.type !== "other") {
      // Use server-side queue materialization for known sources
      const queueSongIndex =
        resolvedSongIndex ??
        queueSongs?.findIndex((s) => s.id === song.id) ??
        0;
      startQueue({
        sourceType: queueSource.type,
        sourceId: queueSource.id ?? undefined,
        sourceName: queueSource.name ?? undefined,
        startIndex: queueSongIndex >= 0 ? queueSongIndex : 0,
        startSongId: song.id,
        filters: queueSource.filters,
        sort: queueSource.sort,
        songIds:
          queueSource.type === "songRadio" && queueSongs
            ? queueSongs.map((queueSong) => queueSong.id)
            : undefined,
      });
    } else if (queueSongs) {
      // Fallback to explicit song IDs for custom lists (selections, etc.)
      const songIndex = queueSongs.findIndex((s) => s.id === song.id);
      startQueue({
        sourceType: queueSource?.type || "other",
        sourceName: queueSource?.name ?? undefined,
        songIds: queueSongs.map((s) => s.id),
        startIndex: songIndex >= 0 ? songIndex : 0,
        startSongId: song.id,
      });
    } else {
      // Single song
      startQueue({
        sourceType: "other",
        songIds: [song.id],
        startIndex: 0,
        startSongId: song.id,
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
          prefetch={false}
          className="hover:underline hover:text-foreground shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {song.artist}
        </Link>
      )}
      {showArtist && showAlbum && <span className="shrink-0">•</span>}
      {showAlbum && (
        <Link
          href={`/library/albums/details?id=${song.albumId}&songId=${song.id}`}
          prefetch={false}
          className="hover:underline hover:text-foreground truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {song.album}
        </Link>
      )}
    </div>
  );

  return (
    <>
      {discHeader !== undefined && (
        <div className="flex items-center gap-3 pt-4 pb-2 first:pt-0">
          <div className="text-sm font-medium text-muted-foreground">
            Disc {discHeader}
          </div>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={handleClick}
        className="relative"
      >
        {isHighlighted ? (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 rounded-md border-2 border-primary bg-primary/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 3,
              ease: "easeOut",
              times: [0, 0.08, 0.7, 1],
            }}
          />
        ) : null}
        <MediaRow
          dataTestId="song-row"
          dataCurrentTrack={isCurrentTrack ? "true" : undefined}
          coverArt={showCover ? coverArtUrl : undefined}
          coverArtData={showCover ? song.coverArtData : undefined}
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
                trackNumber={trackNumber}
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
                  songIndex={resolvedSongIndex}
                  queueSource={queueSource}
                  showRemoveFromPlaylist={showRemoveFromPlaylist}
                  onRemoveFromPlaylist={onRemoveFromPlaylist}
                  showMoveToPosition={showMoveToPosition}
                  onMoveToPosition={onMoveToPosition}
                  moveToPositionLabel="Move to Position"
                  showRefineMatch={showRefineMatch}
                  onRefineMatch={onRefineMatch}
                  showUnmatch={showUnmatch}
                  onUnmatch={onUnmatch}
                />
              }
            />
          }
          rightContent={
            <div className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums shrink-0">
              {isDisabled && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="relative hidden sm:inline-flex items-center justify-center w-4 h-4">
                      <Ban className="w-3.5 h-3.5 text-muted-foreground/60" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Track disabled - excluded from automatic playback</p>
                  </TooltipContent>
                </Tooltip>
              )}
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
              {showStarred && (
                <span className="w-24 text-right">
                  {song.starred ? formatDate(song.starred) : "—"}
                </span>
              )}
              {showRating && (
                <span className="w-12 text-right">
                  {song.userRating ? "★".repeat(song.userRating) : "—"}
                </span>
              )}
              {showGenre && (
                <span
                  className="w-24 text-right truncate"
                  title={song.genre ?? undefined}
                >
                  {song.genre ?? "—"}
                </span>
              )}
              {showYear && (
                <span className="w-12 text-right">{song.year ?? "—"}</span>
              )}
              {showPlayCount && (
                <span className="w-12 text-right">{song.playCount ?? 0}</span>
              )}
              {showLastPlayed && (
                <span className="w-24 text-right">
                  {song.lastPlayed ? formatDate(song.lastPlayed) : "Never"}
                </span>
              )}
              {showDateAdded && (
                <span className="w-24 text-right">
                  {song.created || dateAddedOverride
                    ? formatDate(dateAddedOverride ?? song.created ?? "")
                    : "—"}
                </span>
              )}
              {showBitRate && (
                <span className="w-16 text-right">
                  {song.bitRate ? `${song.bitRate}k` : "—"}
                </span>
              )}
              {showFormat && (
                <span className="w-14 text-right uppercase">
                  {song.suffix ?? "—"}
                </span>
              )}
              {showDuration && (
                <span className="w-12 text-right">
                  {formatDuration(song.duration)}
                </span>
              )}
            </div>
          }
          contextMenu={(children) => (
            <SongContextMenu
              song={song}
              queueSongs={queueSongs}
              songIndex={resolvedSongIndex}
              queueSource={queueSource}
              showRemoveFromPlaylist={showRemoveFromPlaylist}
              onRemoveFromPlaylist={onRemoveFromPlaylist}
              showMoveToPosition={showMoveToPosition}
              onMoveToPosition={onMoveToPosition}
              moveToPositionLabel="Move to Position"
              showRefineMatch={showRefineMatch}
              onRefineMatch={onRefineMatch}
              showUnmatch={showUnmatch}
              onUnmatch={onUnmatch}
            >
              {children}
            </SongContextMenu>
          )}
          className={cn(className, isDisabled && "opacity-50")}
        >
          {/* Custom content with clickable links */}
          <div className="min-w-0 flex flex-col flex-1">
            <span
              className={cn(
                "text-sm font-medium truncate",
                isCurrentTrack && "text-primary",
              )}
            >
              {song.title}
            </span>
            {(showArtist || showAlbum) && subtitle}
          </div>
        </MediaRow>
      </motion.div>
    </>
  );
}

export function SongRowSkeleton({
  showCover = false,
  showIndex = true,
}: {
  showCover?: boolean;
  showIndex?: boolean;
}) {
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
  songIndex?: number;
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
  // Unmatch props (to revert a matched song back to missing)
  showUnmatch?: boolean;
  onUnmatch?: (song: Song, index: number) => void;
  /**
   * When true, this card is the currently playing track in the queue.
   * Use this for views with duplicate songs (like playlists) where we need
   * to distinguish between multiple instances of the same song.
   * When undefined, the default behavior (matching by song ID) is used.
   */
  isCurrentQueuePosition?: boolean;
  /** When true, inline images were requested from the server - skip separate cover art fetch if coverArtData is missing */
  inlineImagesRequested?: boolean;
  className?: string;
}

const defaultSongIcon = (
  <Music className="w-4 h-4 shrink-0 text-muted-foreground" />
);

export function SongCard({
  song,
  index,
  songIndex,
  queueSongs,
  queueSource,
  isSelected,
  isSelectionMode,
  onSelect,
  showMoveToPosition,
  onMoveToPosition,
  showRefineMatch,
  onRefineMatch,
  showUnmatch,
  onUnmatch,
  isCurrentQueuePosition,
  inlineImagesRequested = false,
  className,
}: SongCardProps) {
  const currentSong = useAtomValue(currentSongAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const shuffleExcludes = useAtomValue(shuffleExcludesAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const { togglePlayPause } = useAudioEngine();
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);
  const resolvedSongIndex = songIndex ?? index;

  // If isCurrentQueuePosition is explicitly set (for views with duplicate songs like playlists),
  // use that to determine if this specific card is the current track.
  // Otherwise, fall back to matching by song ID.
  const isCurrentTrack =
    isCurrentQueuePosition !== undefined
      ? isCurrentQueuePosition && playbackState !== "ended"
      : currentSong?.id === song.id && playbackState !== "ended";
  const isExcludedFromShuffle = shuffleExcludes.has(song.id);

  // Use inline thumbnail if available, otherwise construct URL for fetching
  const coverArtUrl =
    song.coverArt && !song.coverArtData && !inlineImagesRequested
      ? getClient()?.getCoverArtUrl(song.coverArt, "medium")
      : undefined;

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlayPause();
    } else if (queueSource?.type && queueSource.type !== "other") {
      // Use server-side queue materialization for known sources
      const queueSongIndex =
        resolvedSongIndex ??
        queueSongs?.findIndex((s) => s.id === song.id) ??
        0;
      startQueue({
        sourceType: queueSource.type,
        sourceId: queueSource.id ?? undefined,
        sourceName: queueSource.name ?? undefined,
        startIndex: queueSongIndex >= 0 ? queueSongIndex : 0,
        startSongId: song.id,
        filters: queueSource.filters,
        sort: queueSource.sort,
      });
    } else if (queueSongs) {
      // Fallback to explicit song IDs for custom lists
      const songIndex = queueSongs.findIndex((s) => s.id === song.id);
      startQueue({
        sourceType: queueSource?.type || "other",
        sourceName: queueSource?.name ?? undefined,
        songIds: queueSongs.map((s) => s.id),
        startIndex: songIndex >= 0 ? songIndex : 0,
        startSongId: song.id,
      });
    } else {
      // Single song
      startQueue({
        sourceType: "other",
        songIds: [song.id],
        startIndex: 0,
        startSongId: song.id,
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
        prefetch={false}
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
      dataCurrentTrack={isCurrentTrack ? "true" : undefined}
      coverArt={coverArtUrl}
      coverArtData={song.coverArtData}
      title={song.title}
      titleIcon={defaultSongIcon}
      subtitleContent={subtitleContent}
      href={`/library/albums/details?id=${song.albumId}&songId=${song.id}`}
      colorSeed={song.album ?? undefined}
      coverType="song"
      onPlay={handlePlay}
      isActive={isCurrentTrack}
      onStar={handleStar}
      isStarred={isStarred}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect ? (e) => onSelect(song.id, e) : undefined}
      dropdownMenu={
        <SongDropdownMenu
          song={song}
          queueSongs={queueSongs}
          songIndex={resolvedSongIndex}
          queueSource={queueSource}
          showMoveToPosition={showMoveToPosition}
          onMoveToPosition={onMoveToPosition}
          moveToPositionLabel="Move to Position"
          showRefineMatch={showRefineMatch}
          onRefineMatch={onRefineMatch}
          showUnmatch={showUnmatch}
          onUnmatch={onUnmatch}
        />
      }
      contextMenu={(children) => (
        <SongContextMenu
          song={song}
          queueSongs={queueSongs}
          songIndex={resolvedSongIndex}
          queueSource={queueSource}
          showMoveToPosition={showMoveToPosition}
          onMoveToPosition={onMoveToPosition}
          moveToPositionLabel="Move to Position"
          showRefineMatch={showRefineMatch}
          onRefineMatch={onRefineMatch}
          showUnmatch={showUnmatch}
          onUnmatch={onUnmatch}
        >
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
  // Use inline thumbnail if available, otherwise construct URL for fetching
  const coverArtUrl =
    song.coverArt && !song.coverArtData
      ? getClient()?.getCoverArtUrl(song.coverArt, "small")
      : undefined;

  return (
    <MediaRow
      coverArt={coverArtUrl}
      coverArtData={song.coverArtData}
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
