"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ListMusic,
  Play,
  Pause,
  MoreHorizontal,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  serverQueueStateAtom,
  queueWindowAtom,
  isQueueLoadingAtom,
  isQueueOperationPendingAtom,
  fetchQueueRangeAtom,
  playAtIndexAtom,
  removeFromQueueAtom,
  moveInQueueAtom,
} from "@/lib/store/server-queue";
import { playbackStateAtom } from "@/lib/store/player";
import { useAudioEngine } from "@/lib/audio/hooks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CoverImage } from "@/components/shared/cover-image";
import { NowPlayingBars } from "@/components/shared/now-playing-bars";
import { SongContextMenu, SongDropdownMenu } from "@/components/browse/song-context-menu";
import { MoveToPositionDialog } from "@/components/shared/move-to-position-dialog";
import { formatDuration } from "@/lib/utils/format";
import { getClient } from "@/lib/api/client";
import { isClientInitializedAtom } from "@/lib/store/auth";
import type { QueueSongEntry } from "@/lib/api/types";

// Item height for virtualization (px)
const ITEM_HEIGHT = 56;
// How many items before/after viewport to render
const OVERSCAN = 5;
// Buffer threshold - fetch more when within N items of edge
const FETCH_THRESHOLD = 10;

// Loading placeholder for unfetched items
function QueueItemPlaceholder() {
  return (
    <div className="flex items-center gap-3 p-2" style={{ height: ITEM_HEIGHT }}>
      <Skeleton className="w-10 h-10 rounded shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="w-10 h-4 shrink-0" />
    </div>
  );
}

// Empty state when queue is empty
function QueueEmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <ListMusic className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="font-semibold mb-1">Your queue is empty</h3>
      <p className="text-sm text-muted-foreground">Add songs to start listening</p>
    </div>
  );
}

interface VirtualQueueItemProps {
  entry: QueueSongEntry;
  isCurrent: boolean;
  isPlaying: boolean;
  totalCount: number;
  onPlay: () => void;
  onRemove: () => void;
  onTogglePlayPause: () => void;
  onMoveToPosition: () => void;
}

/**
 * Memoized queue item component to prevent unnecessary re-renders.
 * Only re-renders when its specific props change.
 */
const VirtualQueueItem = memo(function VirtualQueueItem({
  entry,
  isCurrent,
  isPlaying,
  totalCount,
  onPlay,
  onRemove,
  onTogglePlayPause,
  onMoveToPosition,
}: VirtualQueueItemProps) {
  // Subscribe to client initialization state to re-render when client becomes available
  // This ensures cover art URLs are generated correctly after page reload
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  
  // Get cover URL - only available after client is initialized
  const coverUrl = isClientInitialized && entry.song.coverArt 
    ? getClient()?.getCoverArtUrl(entry.song.coverArt, 100) 
    : undefined;
  
  const song = entry.song;

  return (
    <SongContextMenu
      song={song}
      hideQueueActions={isCurrent}
      showRemoveFromQueue={!isCurrent}
      onRemoveFromQueue={onRemove}
      showMoveToPosition={!isCurrent}
      onMoveToPosition={onMoveToPosition}
      moveToPositionLabel="Move to Position"
    >
      <div
        className={cn(
          "flex items-center gap-2 p-2 rounded-lg group",
          isCurrent
            ? "bg-primary/10 border border-primary/20"
            : "bg-card hover:bg-muted/50"
        )}
        style={{ height: ITEM_HEIGHT }}
      >
        {/* Now playing indicator for current track */}
        {isCurrent && (
          <div className="shrink-0 w-5">
            <NowPlayingBars isAnimating={isPlaying} />
          </div>
        )}

        {/* Cover art with play button */}
        <div
          className="group/cover relative shrink-0 cursor-pointer"
          onClick={isCurrent ? onTogglePlayPause : onPlay}
        >
          <CoverImage
            src={coverUrl}
            alt={song.title}
            colorSeed={song.album ?? undefined}
            type="song"
            size="sm"
            lazy={false}
          />
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity rounded cursor-pointer"
          >
            {isCurrent && isPlaying ? (
              <Pause className="w-4 h-4 text-white" />
            ) : (
              <Play className="w-4 h-4 ml-0.5 text-white" />
            )}
          </button>
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm font-medium truncate",
              isCurrent && "text-primary"
            )}
          >
            {song.title}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            <Link
              href={`/library/artists/details?id=${song.artistId}`}
              className="hover:underline hover:text-foreground transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {song.artist}
            </Link>
            {song.album && (
              <>
                {" · "}
                <Link
                  href={`/library/albums/details?id=${song.albumId}`}
                  className="hover:underline hover:text-foreground transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  {song.album}
                </Link>
              </>
            )}
          </p>
        </div>

        {/* Actions */}
        <SongDropdownMenu
          song={song}
          hideQueueActions={isCurrent}
          showRemoveFromQueue={!isCurrent}
          onRemoveFromQueue={onRemove}
          showMoveToPosition={!isCurrent}
          onMoveToPosition={onMoveToPosition}
          moveToPositionLabel="Move to Position"
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          }
        />

        {/* Duration */}
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatDuration(song.duration)}
        </span>
      </div>
    </SongContextMenu>
  );
});

interface VirtualizedQueueDisplayProps {
  variant?: "mobile" | "desktop";
}

/**
 * Virtualized queue display using server-side queue state.
 * Fetches song windows on demand as user scrolls.
 * 
 * Performance optimizations:
 * - songsByPosition Map is memoized to prevent recreation on every render
 * - VirtualQueueItem is wrapped in React.memo
 * - Callbacks are stabilized with useCallback
 */
export function VirtualizedQueueDisplay({ variant: _variant = "desktop" }: VirtualizedQueueDisplayProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const queueState = useAtomValue(serverQueueStateAtom);
  const queueWindow = useAtomValue(queueWindowAtom);
  const isLoading = useAtomValue(isQueueLoadingAtom);
  const isPending = useAtomValue(isQueueOperationPendingAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  
  const fetchQueueRange = useSetAtom(fetchQueueRangeAtom);
  const playAtIndex = useSetAtom(playAtIndexAtom);
  const removeFromQueue = useSetAtom(removeFromQueueAtom);
  const moveInQueue = useSetAtom(moveInQueueAtom);
  
  const { togglePlayPause } = useAudioEngine();
  
  // Move to position dialog state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogEntry, setMoveDialogEntry] = useState<QueueSongEntry | null>(null);

  const totalCount = queueState?.totalCount ?? 0;
  const currentIndex = queueState?.currentIndex ?? 0;

  // Memoize the songs array reference for stable dependencies
  const songs = queueWindow?.songs;

  // Create a memoized map of loaded songs by position for O(1) lookup
  // Only recreate when the songs array changes
  const songsByPosition = useMemo(() => {
    const map = new Map<number, QueueSongEntry>();
    if (songs) {
      for (const entry of songs) {
        map.set(entry.position, entry);
      }
    }
    return map;
  }, [songs]);

  // Virtualizer setup
  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Track which ranges we've fetched to avoid duplicate requests
  const fetchedRangesRef = useRef<Set<string>>(new Set());
  const isFetchingRef = useRef(false);

  // Memoize the first and last visible indices to stabilize callback dependencies
  const firstVisible = virtualItems[0]?.index ?? 0;
  const lastVisible = virtualItems[virtualItems.length - 1]?.index ?? 0;

  // Fetch more songs when scrolling near edges of loaded data
  const checkAndFetchMore = useCallback(async () => {
    if (isFetchingRef.current || totalCount === 0) return;

    // Find gaps in the loaded data within the visible + threshold range
    const checkStart = Math.max(0, firstVisible - FETCH_THRESHOLD);
    const checkEnd = Math.min(totalCount - 1, lastVisible + FETCH_THRESHOLD);

    let fetchStart = -1;
    let fetchEnd = -1;

    for (let i = checkStart; i <= checkEnd; i++) {
      if (!songsByPosition.has(i)) {
        if (fetchStart === -1) fetchStart = i;
        fetchEnd = i;
      }
    }

    if (fetchStart !== -1 && fetchEnd !== -1) {
      const rangeKey = `${fetchStart}-${fetchEnd}`;
      if (!fetchedRangesRef.current.has(rangeKey)) {
        fetchedRangesRef.current.add(rangeKey);
        isFetchingRef.current = true;
        
        try {
          await fetchQueueRange({
            offset: fetchStart,
            limit: fetchEnd - fetchStart + 1,
          });
        } finally {
          isFetchingRef.current = false;
        }
      }
    }
  }, [firstVisible, lastVisible, totalCount, songsByPosition, fetchQueueRange]);

  // Check for more data to fetch when scroll position changes
  useEffect(() => {
    checkAndFetchMore();
  }, [checkAndFetchMore]);

  // Reset fetched ranges when queue changes
  useEffect(() => {
    fetchedRangesRef.current.clear();
  }, [queueState?.source.id, queueState?.isShuffled]);

  // Handle move to position
  const handleMoveToPosition = useCallback((entry: QueueSongEntry) => {
    setMoveDialogEntry(entry);
    setMoveDialogOpen(true);
  }, []);

  const handleMove = useCallback(async (newPosition: number) => {
    if (!moveDialogEntry) return;
    await moveInQueue({ fromPosition: moveDialogEntry.position, toPosition: newPosition });
  }, [moveDialogEntry, moveInQueue]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show empty state
  if (totalCount === 0) {
    return <QueueEmptyState />;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header with stats */}
      <div className="px-4 py-2 flex items-center justify-between text-xs text-muted-foreground border-b border-border">
        <span>
          {totalCount} track{totalCount !== 1 ? "s" : ""}
        </span>
        {isPending && (
          <Loader2 className="w-3 h-3 animate-spin" />
        )}
      </div>

      {/* Virtualized list */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          className="relative px-2"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((virtualItem) => {
            const entry = songsByPosition.get(virtualItem.index);
            const isCurrent = virtualItem.index === currentIndex;
            // Use entry_id as key for stable React reconciliation (allows same song multiple times)
            const itemKey = entry ? entry.entryId : `placeholder-${virtualItem.index}`;

            return (
              <div
                key={itemKey}
                className="absolute left-0 right-0 px-2"
                style={{
                  height: virtualItem.size,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {entry ? (
                  <VirtualQueueItem
                    entry={entry}
                    isCurrent={isCurrent}
                    isPlaying={isCurrent && playbackState === "playing"}
                    totalCount={totalCount}
                    onPlay={() => playAtIndex(virtualItem.index)}
                    onRemove={() => removeFromQueue(virtualItem.index)}
                    onTogglePlayPause={togglePlayPause}
                    onMoveToPosition={() => handleMoveToPosition(entry)}
                  />
                ) : (
                  <QueueItemPlaceholder />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Move to position dialog */}
      {moveDialogEntry && (
        <MoveToPositionDialog
          open={moveDialogOpen}
          onOpenChange={setMoveDialogOpen}
          currentPosition={moveDialogEntry.position}
          totalCount={totalCount}
          itemName={moveDialogEntry.song.title}
          onMove={handleMove}
        />
      )}
    </div>
  );
}
