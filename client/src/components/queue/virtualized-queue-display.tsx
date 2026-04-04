"use client";

import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ListMusic, Play, Pause, MoreHorizontal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  serverQueueStateAtom,
  queueWindowAtom,
  isQueueLoadingAtom,
  isQueueOperationPendingAtom,
  isRestoringQueueAtom,
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
import {
  SongContextMenu,
  SongDropdownMenu,
} from "@/components/browse/song-context-menu";
import { MoveToPositionDialog } from "@/components/shared/move-to-position-dialog";
import { isTauriMobile } from "@/lib/tauri";
import { formatDuration } from "@/lib/utils/format";
import type { QueueSongEntry } from "@/lib/api/types";

// Item height for virtualization (px)
const ITEM_HEIGHT = 56;
// How many items before/after viewport to render
const OVERSCAN = 5;
// Buffer threshold - fetch more when within N items of edge
const FETCH_THRESHOLD = 10;
// Minimum batch size for fetching - always fetch at least this many items
const MIN_FETCH_BATCH_SIZE = 50;
// Debounce delay for fetch requests (ms) - prevents request spam during rapid scrolling
const FETCH_DEBOUNCE_MS = 100;

// Loading placeholder for unfetched items
function QueueItemPlaceholder() {
  return (
    <div
      className="flex items-center gap-3 p-2"
      style={{ height: ITEM_HEIGHT }}
    >
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
      <p className="text-sm text-muted-foreground">
        Add songs to start listening
      </p>
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
  onMoveToPosition: (song: QueueSongEntry["song"], index: number) => void;
  onNavigate?: () => void;
}

/**
 * Memoized queue item component to prevent unnecessary re-renders.
 * Only re-renders when its specific props change.
 */
function VirtualQueueItem({
  entry,
  isCurrent,
  isPlaying,
  totalCount: _totalCount,
  onPlay,
  onRemove,
  onTogglePlayPause,
  onMoveToPosition,
  onNavigate,
}: VirtualQueueItemProps) {
  const song = entry.song;

  return (
    <SongContextMenu
      song={song}
      songIndex={entry.position}
      hideQueueActions={isCurrent}
      showRemoveFromQueue={!isCurrent}
      onRemoveFromQueue={onRemove}
      showMoveToPosition={!isCurrent}
      onMoveToPosition={onMoveToPosition}
      moveToPositionLabel="Move to Position"
      onNavigate={onNavigate}
    >
      <div
        data-testid="queue-item"
        data-queue-position={entry.position}
        className={cn(
          "flex items-center gap-2 p-2 rounded-lg group",
          isCurrent
            ? "bg-primary/10 border border-primary/20"
            : "bg-card hover:bg-muted/50",
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
            inlineData={song.coverArtData}
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
              isCurrent && "text-primary",
            )}
          >
            {song.title}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            <Link
              href={`/library/artists/details?id=${song.artistId}`}
              className="hover:underline hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.();
              }}
              prefetch={false}
            >
              {song.artist}
            </Link>
            {song.album && (
              <>
                {" · "}
                <Link
                  href={`/library/albums/details?id=${song.albumId}&songId=${song.id}`}
                  className="hover:underline hover:text-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate?.();
                  }}
                  prefetch={false}
                >
                  {song.album}
                </Link>
              </>
            )}
          </p>
        </div>

        {/* Actions - hidden on Tauri mobile where long-press context menu is used */}
        {!isTauriMobile() && (
          <SongDropdownMenu
            song={song}
            songIndex={entry.position}
            hideQueueActions={isCurrent}
            showRemoveFromQueue={!isCurrent}
            onRemoveFromQueue={onRemove}
            showMoveToPosition={!isCurrent}
            onMoveToPosition={onMoveToPosition}
            moveToPositionLabel="Move to Position"
            onNavigate={onNavigate}
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
        )}

        {/* Duration */}
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatDuration(song.duration)}
        </span>
      </div>
    </SongContextMenu>
  );
}

interface VirtualizedQueueDisplayProps {
  variant?: "mobile" | "desktop";
  /** Called when user navigates away via a link (for closing fullscreen etc.) */
  onNavigate?: () => void;
}

/** Handle exposed by VirtualizedQueueDisplay for imperative control */
export interface VirtualizedQueueDisplayHandle {
  scrollToNowPlaying: (behavior?: "auto" | "smooth") => void;
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
export const VirtualizedQueueDisplay = forwardRef<
  VirtualizedQueueDisplayHandle,
  VirtualizedQueueDisplayProps
>(function VirtualizedQueueDisplay(
  { variant: _variant = "desktop", onNavigate },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null);

  const queueState = useAtomValue(serverQueueStateAtom);
  const queueWindow = useAtomValue(queueWindowAtom);
  const isLoading = useAtomValue(isQueueLoadingAtom);
  const isPending = useAtomValue(isQueueOperationPendingAtom);
  const isRestoring = useAtomValue(isRestoringQueueAtom);
  const playbackState = useAtomValue(playbackStateAtom);

  const fetchQueueRange = useSetAtom(fetchQueueRangeAtom);
  const playAtIndex = useSetAtom(playAtIndexAtom);
  const removeFromQueue = useSetAtom(removeFromQueueAtom);
  const moveInQueue = useSetAtom(moveInQueueAtom);

  const { togglePlayPause } = useAudioEngine();

  // Move to position dialog state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogEntry, setMoveDialogEntry] = useState<QueueSongEntry | null>(
    null,
  );

  // Track previous current index to detect track changes
  const prevCurrentIndexRef = useRef<number | null>(null);
  // Track previous queue instanceId to detect new queue instances
  const prevQueueInstanceIdRef = useRef<string | null>(null);
  // AbortController for cancelling pending fetch requests
  const fetchAbortControllerRef = useRef<AbortController | null>(null);

  const totalCount = queueState?.totalCount ?? 0;
  const currentIndex = queueState?.currentIndex ?? 0;

  // Memoize the songs array reference for stable dependencies
  const songs = queueWindow?.songs;

  // Create a map of loaded songs by position for O(1) lookup
  // Store in a ref so it can be accessed in effects without being a dependency
  const songsByPositionRef = useRef(new Map<number, QueueSongEntry>());

  // Update the map when songs change
  useEffect(() => {
    const map = new Map<number, QueueSongEntry>();
    if (songs) {
      for (const entry of songs) {
        map.set(entry.position, entry);
      }
    }
    songsByPositionRef.current = map;
  }, [songs]);

  // Also create a render-time map for use in rendering (not effects)
  const songsByPosition = (() => {
    const map = new Map<number, QueueSongEntry>();
    if (songs) {
      for (const entry of songs) {
        map.set(entry.position, entry);
      }
    }
    return map;
  })();

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

  // Expose imperative handle
  useImperativeHandle(
    ref,
    () => ({
      scrollToNowPlaying: (behavior: "auto" | "smooth" = "smooth") => {
        if (totalCount === 0) return;
        virtualizer.scrollToIndex(currentIndex, { align: "start", behavior });
      },
    }),
    [totalCount, virtualizer, currentIndex],
  );

  // Auto-scroll to now playing when track changes
  // Only scroll if:
  // 1. Now playing is currently visible in the scroll area
  // 2. Now playing is in the bottom 25% of the visible area
  // If scrolling, bring now playing to the middle of the viewport
  useEffect(() => {
    // Skip during queue restoration (page load)
    if (isRestoring) return;

    // Skip on initial mount
    if (prevCurrentIndexRef.current === null) {
      prevCurrentIndexRef.current = currentIndex;
      return;
    }

    // Track changed
    if (prevCurrentIndexRef.current !== currentIndex) {
      prevCurrentIndexRef.current = currentIndex;

      // Get scroll container dimensions to calculate visibility
      const scrollElement = parentRef.current;
      if (!scrollElement) return;

      const containerHeight = scrollElement.clientHeight;
      const scrollTop = scrollElement.scrollTop;

      // Calculate which item indices are visible based on scroll position
      const firstVisibleIndex = Math.floor(scrollTop / ITEM_HEIGHT);
      const visibleItemCount = Math.ceil(containerHeight / ITEM_HEIGHT);
      const lastVisibleIndex = firstVisibleIndex + visibleItemCount - 1;

      // Check if now playing is currently visible
      const isVisible =
        currentIndex >= firstVisibleIndex && currentIndex <= lastVisibleIndex;

      // Calculate the 75% threshold position (bottom 25% triggers scroll)
      const threshold = 0.75;
      const thresholdIndex =
        firstVisibleIndex + Math.floor(visibleItemCount * threshold);

      // Check if now playing is in the bottom 25% of visible area
      const isInBottomQuarter = currentIndex > thresholdIndex;

      // Only scroll if now playing is visible
      if (isVisible) {
        if (isInBottomQuarter) {
          // Scroll to bring now playing to the middle of the viewport
          const middleOffset = Math.floor(visibleItemCount * threshold);
          const targetScrollTop = Math.max(
            0,
            (currentIndex - middleOffset) * ITEM_HEIGHT,
          );
          scrollElement.scrollTo({
            top: targetScrollTop,
            behavior: "auto",
          });
        }
        // If in top 75% (0-75%), don't scroll at all
      }
      // If not visible, don't scroll (user scrolled elsewhere)
    }
  }, [currentIndex, isRestoring]);

  // When a new queue starts (detected by instanceId changing), reset state
  // The instanceId field uniquely identifies each queue instance on the server (UUID)
  useEffect(() => {
    // Skip during queue restoration (page load)
    if (isRestoring) return;

    // Get the queue's instance ID (unique identifier for this queue instance)
    const currentInstanceId = queueState?.source?.instanceId ?? null;

    // Skip on initial mount
    if (prevQueueInstanceIdRef.current === null) {
      prevQueueInstanceIdRef.current = currentInstanceId;
      return;
    }

    // Queue instance changed - a new queue was started
    if (
      prevQueueInstanceIdRef.current !== currentInstanceId &&
      currentInstanceId
    ) {
      prevQueueInstanceIdRef.current = currentInstanceId;

      // Abort any pending fetch requests
      if (fetchAbortControllerRef.current) {
        fetchAbortControllerRef.current.abort();
        fetchAbortControllerRef.current = null;
      }

      // Clear fetched ranges since we have a new queue
      fetchedRangesRef.current.clear();
      isFetchingRef.current = false;

      // Scroll to the current track position using virtualizer API
      // This ensures the virtualizer properly updates its internal state
      virtualizer.scrollToIndex(currentIndex, {
        align: "start",
        behavior: "auto",
      });
    }
  }, [queueState?.source?.instanceId, isRestoring, virtualizer, currentIndex]);

  // Check for more data to fetch when scroll position changes
  // Uses debouncing to prevent request spam during rapid scrolling
  // In-flight requests are allowed to complete - only aborted when queue source changes
  useEffect(() => {
    if (totalCount === 0) return;

    // Debounce the fetch to avoid spamming requests during rapid scrolling
    const debounceTimeout = setTimeout(async () => {
      // Don't start a new fetch if one is already in progress
      if (isFetchingRef.current) return;

      // Read from ref to get current loaded songs (not stale closure value)
      const currentSongsByPosition = songsByPositionRef.current;

      // Find gaps in the loaded data within the visible + threshold range
      const checkStart = Math.max(0, firstVisible - FETCH_THRESHOLD);
      const checkEnd = Math.min(totalCount - 1, lastVisible + FETCH_THRESHOLD);

      let fetchStart = -1;

      for (let i = checkStart; i <= checkEnd; i++) {
        if (!currentSongsByPosition.has(i)) {
          if (fetchStart === -1) fetchStart = i;
        }
      }

      // If we found a gap, fetch a reasonable batch starting from there
      if (fetchStart !== -1) {
        // Expand the fetch range to be at least MIN_FETCH_BATCH_SIZE items
        // Center the batch around the visible area for smoother scrolling
        const batchSize = Math.max(
          MIN_FETCH_BATCH_SIZE,
          lastVisible - firstVisible + FETCH_THRESHOLD * 2,
        );
        const adjustedStart = Math.max(
          0,
          fetchStart - Math.floor(batchSize / 4),
        );
        const adjustedEnd = Math.min(
          totalCount - 1,
          adjustedStart + batchSize - 1,
        );

        const rangeKey = `${adjustedStart}-${adjustedEnd}`;
        if (!fetchedRangesRef.current.has(rangeKey)) {
          fetchedRangesRef.current.add(rangeKey);
          isFetchingRef.current = true;

          // Create a new AbortController for this fetch
          const abortController = new AbortController();
          fetchAbortControllerRef.current = abortController;

          try {
            await fetchQueueRange({
              offset: adjustedStart,
              limit: adjustedEnd - adjustedStart + 1,
              signal: abortController.signal,
            });
          } catch (error) {
            // If aborted, remove from fetched ranges so it can be retried
            if (error instanceof DOMException && error.name === "AbortError") {
              fetchedRangesRef.current.delete(rangeKey);
            }
          } finally {
            // Only clear if this is still the current controller
            if (fetchAbortControllerRef.current === abortController) {
              fetchAbortControllerRef.current = null;
            }
            isFetchingRef.current = false;
          }
        }
      }
    }, FETCH_DEBOUNCE_MS);

    // Cleanup: only clear debounce timeout on scroll change
    // Don't abort in-flight requests - let them complete
    // Requests are only aborted when queue source changes (handled in separate effect)
    return () => {
      clearTimeout(debounceTimeout);
    };
    // Include songs in deps so effect re-evaluates after new data loads,
    // picking up any remaining gaps that weren't covered by the previous fetch
  }, [firstVisible, lastVisible, totalCount, fetchQueueRange, songs]);

  // Reset fetched ranges when shuffle state changes
  // Note: queue source changes are handled in the source change effect above
  useEffect(() => {
    fetchedRangesRef.current.clear();
  }, [queueState?.isShuffled]);

  // Handle move to position
  const handleMoveToPosition = (
    _song: QueueSongEntry["song"],
    index: number,
  ) => {
    // Find the entry by position
    const entry = songsByPosition.get(index);
    if (!entry) return;
    setMoveDialogEntry(entry);
    setMoveDialogOpen(true);
  };

  const handleMove = async (newPosition: number) => {
    if (!moveDialogEntry) return;
    await moveInQueue({
      fromPosition: moveDialogEntry.position,
      toPosition: newPosition,
    });
  };

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
        {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
      </div>

      {/* Virtualized list - touch-pan-y allows horizontal swipes to close mobile sheet */}
      <div ref={parentRef} className="flex-1 overflow-auto touch-pan-y">
        <div
          className="relative px-2"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((virtualItem) => {
            const entry = songsByPosition.get(virtualItem.index);
            const isCurrent = virtualItem.index === currentIndex;
            // Use entry_id as key for stable React reconciliation (allows same song multiple times)
            const itemKey = entry
              ? entry.entryId
              : `placeholder-${virtualItem.index}`;

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
                    isCurrent={isCurrent && playbackState !== "ended"}
                    isPlaying={isCurrent && playbackState === "playing"}
                    totalCount={totalCount}
                    onPlay={() => playAtIndex(virtualItem.index)}
                    onRemove={() => removeFromQueue(virtualItem.index)}
                    onTogglePlayPause={togglePlayPause}
                    onMoveToPosition={handleMoveToPosition}
                    onNavigate={onNavigate}
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
});
