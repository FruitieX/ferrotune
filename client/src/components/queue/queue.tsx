"use client";

import { useCallback } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import Link from "next/link";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { toast } from "sonner";
import {
  X,
  ListMusic,
  Trash2,
  GripVertical,
  Play,
  Pause,
  Clock,
  MoreHorizontal,
  PanelRightClose,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { queuePanelOpenAtom } from "@/lib/store/ui";
import {
  queueAtom,
  queueIndexAtom,
  currentTrackAtom,
  currentQueueItemAtom,
  removeFromQueueAtom,
  playAtIndexAtom,
  isShuffledAtom,
  shuffledIndicesAtom,
  isQueueLoadingAtom,
  type QueueItem,
} from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";
import { useIsDesktop } from "@/lib/hooks/use-media-query";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { useAudioEngine } from "@/lib/audio/hooks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { CoverImage } from "@/components/shared/cover-image";
import { SongContextMenu, SongDropdownMenu } from "@/components/browse/song-context-menu";
import { formatDuration } from "@/lib/utils/format";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";

const QUEUE_SIDEBAR_WIDTH = 360;

function getCoverUrl(coverArt?: string): string | undefined {
  if (!coverArt) return undefined;
  const client = getClient();
  return client?.getCoverArtUrl(coverArt, 100);
}

// Audio bar visualizer for now playing indicator - uses CSS animations
function NowPlayingBars({ isAnimating = true }: { isAnimating?: boolean }) {
  return (
    <div className="flex items-end justify-center gap-0.5 h-3 w-4">
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

// Skeleton item for loading state
function QueueItemSkeleton() {
  return (
    <div className="flex items-center gap-3 p-2">
      <Skeleton className="w-10 h-10 rounded shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="w-10 h-4 shrink-0" />
    </div>
  );
}

// Skeleton UI shown while queue is loading
function QueueLoadingSkeleton() {
  return (
    <div className="p-4 space-y-6">
      {/* Now Playing skeleton */}
      <section>
        <Skeleton className="h-3 w-24 mb-3" />
        <div className="flex items-center gap-3 p-2 rounded-lg border border-border bg-muted/30">
          <Skeleton className="w-10 h-10 rounded shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="w-10 h-4 shrink-0" />
        </div>
      </section>

      {/* Up Next skeleton */}
      <section>
        <Skeleton className="h-3 w-16 mb-3" />
        <div className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <QueueItemSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

// Extended queue item with original index for queue management
interface QueueDisplayItem {
  queueItem: QueueItem;
  originalIndex: number;
}

// Empty state component
function QueueEmptyState({ iconSize = "lg" }: { iconSize?: "md" | "lg" }) {
  const sizes = iconSize === "lg" 
    ? { container: "w-20 h-20", icon: "w-10 h-10" }
    : { container: "w-16 h-16", icon: "w-8 h-8" };
    
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className={cn("rounded-full bg-muted flex items-center justify-center mb-4", sizes.container)}>
        <ListMusic className={cn("text-muted-foreground", sizes.icon)} />
      </div>
      <h3 className="font-semibold mb-1">Your queue is empty</h3>
      <p className="text-sm text-muted-foreground">Add songs to start listening</p>
    </div>
  );
}

interface QueueContentProps {
  variant: "mobile" | "desktop";
}

function QueueContent({ variant }: QueueContentProps) {
  const [queue, setQueue] = useAtom(queueAtom);
  const queueIndex = useAtomValue(queueIndexAtom);
  const currentTrack = useAtomValue(currentTrackAtom);
  const currentQueueItem = useAtomValue(currentQueueItemAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const isQueueLoading = useAtomValue(isQueueLoadingAtom);
  const removeFromQueue = useSetAtom(removeFromQueueAtom);
  const playAtIndex = useSetAtom(playAtIndexAtom);
  const isShuffled = useAtomValue(isShuffledAtom);
  const shuffledIndices = useAtomValue(shuffledIndicesAtom);
  const setShuffledIndices = useSetAtom(shuffledIndicesAtom);
  const { togglePlayPause } = useAudioEngine();
  const setIsOpen = useSetAtom(queuePanelOpenAtom);

  // Calculate up next and previous tracks based on shuffle state
  const getUpNextAndPrevious = () => {
    if (isShuffled && shuffledIndices.length > 0) {
      const currentShufflePosition = shuffledIndices.indexOf(queueIndex);

      if (currentShufflePosition >= 0) {
        const upNextIndices = shuffledIndices.slice(currentShufflePosition + 1);
        const upNextTracks: QueueDisplayItem[] = upNextIndices.map((idx) => ({
          queueItem: queue[idx],
          originalIndex: idx,
        }));
        const previousIndices = shuffledIndices.slice(0, currentShufflePosition);
        const previousTracks: QueueDisplayItem[] = previousIndices.map((idx) => ({
          queueItem: queue[idx],
          originalIndex: idx,
        }));

        return { upNext: upNextTracks, previous: previousTracks };
      }
    }

    const upNextTracks: QueueDisplayItem[] = queue.slice(queueIndex + 1).map((queueItem, i) => ({
      queueItem,
      originalIndex: queueIndex + 1 + i,
    }));
    const previousTracks: QueueDisplayItem[] = queue.slice(0, queueIndex).map((queueItem, i) => ({
      queueItem,
      originalIndex: i,
    }));

    return { upNext: upNextTracks, previous: previousTracks };
  };

  const { upNext, previous: previousTracks } = getUpNextAndPrevious();

  const handleReorder = (newOrder: QueueDisplayItem[]) => {
    if (isShuffled && shuffledIndices.length > 0) {
      const currentShufflePosition = shuffledIndices.indexOf(queueIndex);
      const newShuffledIndices = [
        ...shuffledIndices.slice(0, currentShufflePosition + 1),
        ...newOrder.map((t) => t.originalIndex),
      ];
      setShuffledIndices(newShuffledIndices);
    } else {
      const newQueue: QueueItem[] = [
        ...previousTracks.map((t) => t.queueItem),
        currentQueueItem!,
        ...newOrder.map((t) => t.queueItem),
      ].filter(Boolean) as QueueItem[];
      setQueue(newQueue);
    }
  };

  const handlePlayTrack = (index: number) => {
    playAtIndex(index);
  };

  const totalDuration = queue.reduce((acc, item) => acc + item.song.duration, 0);
  const remainingDuration =
    upNext.reduce((acc, item) => acc + item.queueItem.song.duration, 0) + (currentTrack?.duration ?? 0);

  const isMobile = variant === "mobile";
  const headerSizeClass = isMobile ? "text-sm" : "text-xs";

  // Show skeleton while loading
  if (isQueueLoading) {
    return <QueueLoadingSkeleton />;
  }

  // Show empty state if queue is empty
  if (queue.length === 0) {
    return <QueueEmptyState iconSize={isMobile ? "lg" : "md"} />;
  }

  return (
    <>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-6">
          {/* Now Playing / Queue Ended */}
          {currentTrack && (
            <section>
              <h3 className={cn("font-semibold text-muted-foreground uppercase tracking-wider mb-3", headerSizeClass)}>
                {playbackState === "ended" ? "Queue Ended" : "Now Playing"}
              </h3>
              <SongContextMenu song={currentTrack} hideQueueActions>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg border group",
                    playbackState === "ended" ? "bg-muted/50 border-border" : "bg-primary/10 border-primary/20"
                  )}
                >
                  {/* Now playing indicator - left of cover */}
                  {playbackState !== "ended" && (
                    <div className="shrink-0">
                      <NowPlayingBars isAnimating={playbackState === "playing"} />
                    </div>
                  )}
                  {/* Cover art - clickable play/pause */}
                  <div className="group/cover relative shrink-0 cursor-pointer" onClick={togglePlayPause}>
                    <CoverImage
                      src={getCoverUrl(currentTrack.coverArt)}
                      alt={currentTrack.title}
                      colorSeed={currentTrack.album}
                      type="song"
                      size="sm"
                    />
                    <button
                      type="button"
                      className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity rounded cursor-pointer"
                    >
                      {playbackState === "playing" ? (
                        <Pause className="w-4 h-4 text-white" />
                      ) : (
                        <Play className="w-4 h-4 ml-0.5 text-white" />
                      )}
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "font-medium truncate",
                        isMobile ? "" : "text-sm",
                        playbackState === "ended" ? "text-foreground" : "text-primary"
                      )}
                    >
                      {currentTrack.title}
                    </p>
                    <p className={cn("text-muted-foreground truncate", isMobile ? "text-sm" : "text-xs")}>
                      <Link
                        href={`/library/artists/details?id=${currentTrack.artistId}`}
                        className="hover:underline hover:text-foreground transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {currentTrack.artist}
                      </Link>
                      {currentTrack.album && (
                        <>
                          {" · "}
                          <Link
                            href={`/library/albums/details?id=${currentTrack.albumId}`}
                            className="hover:underline hover:text-foreground transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {currentTrack.album}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <SongDropdownMenu
                    song={currentTrack}
                    hideQueueActions
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="More options"
                        className={cn(
                          "p-0 opacity-0 group-hover:opacity-100 text-muted-foreground",
                          isMobile ? "h-8 w-8" : "h-7 w-7"
                        )}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    }
                  />
                  <span className={cn("text-muted-foreground tabular-nums", isMobile ? "text-sm" : "text-xs")}>
                    {formatDuration(currentTrack.duration)}
                  </span>
                </motion.div>
              </SongContextMenu>
            </section>
          )}

          {/* Up Next */}
          {upNext.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className={cn("font-semibold text-muted-foreground uppercase tracking-wider", headerSizeClass)}>
                  Up Next
                </h3>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(remainingDuration)}
                </span>
              </div>
              <Reorder.Group axis="y" values={upNext} onReorder={handleReorder} className="space-y-1" layoutScroll>
                <AnimatePresence mode="popLayout">
                  {upNext.map((item) => (
                    <DraggableQueueItem
                      key={item.queueItem.queueItemId}
                      item={item}
                      song={item.queueItem.song}
                      onPlay={() => handlePlayTrack(item.originalIndex)}
                      onRemove={() => removeFromQueue(item.originalIndex)}
                    />
                  ))}
                </AnimatePresence>
              </Reorder.Group>
            </section>
          )}

          {/* Previously Played */}
          {previousTracks.length > 0 && (
            <section>
              <h3 className={cn("font-semibold text-muted-foreground uppercase tracking-wider mb-3", headerSizeClass)}>
                Previously Played
              </h3>
              <div className="space-y-1 opacity-60">
                {previousTracks.map((item) => (
                  <PlayablePreviousItem
                    key={item.queueItem.queueItemId}
                    item={item}
                    onPlay={() => handlePlayTrack(item.originalIndex)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>

      {/* Footer with stats */}
      {queue.length > 0 && (
        <div
          className={cn(
            "px-4 py-3 border-t border-border bg-muted/30 text-muted-foreground shrink-0",
            isMobile ? "text-sm" : "text-xs"
          )}
        >
          {queue.length} tracks • {formatDuration(totalDuration)} total
        </div>
      )}
    </>
  );
}

/**
 * Mobile-only queue panel (Sheet/Drawer).
 * Used on screens smaller than xl breakpoint.
 */
export function QueuePanel() {
  const isDesktop = useIsDesktop();
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const [queue, setQueue] = useAtom(queueAtom);
  const [queueIndex, setQueueIndex] = useAtom(queueIndexAtom);
  const [shuffledIndices, setShuffledIndices] = useAtom(shuffledIndicesAtom);
  const isQueueLoading = useAtomValue(isQueueLoadingAtom);

  const handleClearQueue = useCallback(() => {
    // Save current state for undo
    const savedQueue = queue;
    const savedIndex = queueIndex;
    const savedShuffled = shuffledIndices;
    const trackCount = queue.length;
    
    // Clear the queue
    setQueue([]);
    setQueueIndex(-1);
    setShuffledIndices([]);
    
    // Show toast with undo
    toast.success(`Cleared ${trackCount} tracks from queue`, {
      action: {
        label: "Undo",
        onClick: () => {
          setQueue(savedQueue);
          setQueueIndex(savedIndex);
          setShuffledIndices(savedShuffled);
          toast.success("Queue restored");
        },
      },
      duration: 8000,
    });
  }, [queue, queueIndex, shuffledIndices, setQueue, setQueueIndex, setShuffledIndices]);

  // Don't render the Sheet on desktop - use QueueSidebar instead
  if (isDesktop) {
    return null;
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent side="right" className="w-full sm:w-[400px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between pr-8">
            <SheetTitle className="flex items-center gap-2">
              <ListMusic className="w-5 h-5" />
              Queue
            </SheetTitle>
            {queue.length > 0 && !isQueueLoading && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearQueue}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
            )}
          </div>
        </SheetHeader>

        <QueueContent variant="mobile" />
      </SheetContent>
    </Sheet>
  );
}

/**
 * Desktop-only queue sidebar.
 * Used on screens xl and larger.
 */
export function QueueSidebar() {
  const hydrated = useHydrated();
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const [queue, setQueue] = useAtom(queueAtom);
  const [queueIndex, setQueueIndex] = useAtom(queueIndexAtom);
  const [shuffledIndices, setShuffledIndices] = useAtom(shuffledIndicesAtom);
  const isQueueLoading = useAtomValue(isQueueLoadingAtom);

  const handleClearQueue = useCallback(() => {
    // Save current state for undo
    const savedQueue = queue;
    const savedIndex = queueIndex;
    const savedShuffled = shuffledIndices;
    const trackCount = queue.length;
    
    // Clear the queue
    setQueue([]);
    setQueueIndex(-1);
    setShuffledIndices([]);
    
    // Show toast with undo
    toast.success(`Cleared ${trackCount} tracks from queue`, {
      action: {
        label: "Undo",
        onClick: () => {
          setQueue(savedQueue);
          setQueueIndex(savedIndex);
          setShuffledIndices(savedShuffled);
          toast.success("Queue restored");
        },
      },
      duration: 8000,
    });
  }, [queue, queueIndex, shuffledIndices, setQueue, setQueueIndex, setShuffledIndices]);

  // Don't render until hydrated to prevent hydration mismatch with atomWithStorage
  if (!hydrated) {
    return null;
  }

  return (
    <motion.aside
      initial={false}
      animate={{
        width: isOpen ? QUEUE_SIDEBAR_WIDTH : 0,
        opacity: isOpen ? 1 : 0,
      }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={cn(
        "hidden xl:flex flex-col bg-background border-l border-border overflow-hidden",
        "fixed right-0 top-0 bottom-[88px] z-40"
      )}
    >
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col h-full w-[360px]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <ListMusic className="w-5 h-5" />
                <h2 className="font-semibold">Queue</h2>
              </div>
              <div className="flex items-center gap-1">
                {queue.length > 0 && !isQueueLoading && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearQueue}
                    className="text-muted-foreground hover:text-destructive h-8"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="h-8 w-8" aria-label="Close queue">
                  <PanelRightClose className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <QueueContent variant="desktop" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

interface PlayablePreviousItemProps {
  item: QueueDisplayItem;
  onPlay: () => void;
}

function PlayablePreviousItem({
  item,
  onPlay,
}: PlayablePreviousItemProps) {
  const song = item.queueItem.song;

  return (
    <SongContextMenu song={song}>
      <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-default group">
        {/* Cover with play button overlay on cover hover */}
        <div className="group/cover relative shrink-0 cursor-pointer" onClick={onPlay}>
          <CoverImage
            src={getCoverUrl(song.coverArt)}
            alt={song.title}
            colorSeed={song.album}
            type="song"
            size="sm"
          />
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity rounded cursor-pointer"
          >
            <Play className="w-4 h-4 ml-0.5 text-white" />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{song.title}</p>
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

        <SongDropdownMenu
          song={song}
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

        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatDuration(song.duration)}
        </span>
      </div>
    </SongContextMenu>
  );
}

interface DraggableQueueItemProps {
  item: QueueDisplayItem;
  song: Song;
  onPlay: () => void;
  onRemove: () => void;
}

function DraggableQueueItem({
  item,
  song,
  onPlay,
  onRemove,
}: DraggableQueueItemProps) {
  const dragControls = useDragControls();

  return (
    <SongContextMenu 
      song={song} 
      hideQueueActions 
      showRemoveFromQueue 
      onRemoveFromQueue={onRemove}
    >
      <Reorder.Item
        value={item}
        id={item.queueItem.queueItemId}
        className="flex items-center gap-2 p-2 rounded-lg bg-card hover:bg-muted/50 group select-none max-w-full"
        dragListener={false}
        dragControls={dragControls}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
        whileDrag={{
          scale: 1.02,
          boxShadow: "0 10px 20px rgba(0,0,0,0.3)",
          zIndex: 50,
        }}
      >
        <div className="cursor-grab active:cursor-grabbing touch-none" onPointerDown={(e) => dragControls.start(e)}>
          <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>

        {/* Cover with play button overlay on cover hover only */}
        <div className="group/cover relative shrink-0 cursor-pointer" onClick={onPlay}>
          <CoverImage
            src={getCoverUrl(song.coverArt)}
            alt={song.title}
            colorSeed={song.album}
            type="song"
            size="sm"
          />
          <button
            type="button"
            aria-label={`Play ${song.title}`}
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity rounded cursor-pointer"
          >
            <Play className="w-4 h-4 ml-0.5 text-white" />
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{song.title}</p>
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

        <SongDropdownMenu
          song={song}
          hideQueueActions
          showRemoveFromQueue
          onRemoveFromQueue={onRemove}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground shrink-0"
              onClick={(e) => e.stopPropagation()}
              aria-label="More options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          }
        />

        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatDuration(song.duration)}</span>
      </Reorder.Item>
    </SongContextMenu>
  );
}
