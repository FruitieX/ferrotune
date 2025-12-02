"use client";

import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { X, ListMusic, Trash2, GripVertical, Play, Pause, Clock, FolderPlus, MoreHorizontal, PanelRightClose, ListEnd, ListStart } from "lucide-react";
import { cn } from "@/lib/utils";
import { queuePanelOpenAtom } from "@/lib/store/ui";
import {
  queueAtom,
  queueIndexAtom,
  currentTrackAtom,
  currentQueueItemAtom,
  removeFromQueueAtom,
  clearQueueAtom,
  playAtIndexAtom,
  addToQueueAtom,
  isShuffledAtom,
  shuffledIndicesAtom,
  type QueueItem,
} from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { useAudioEngine } from "@/lib/audio/hooks";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CoverImage } from "@/components/shared/cover-image";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
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

// Extended queue item with original index for queue management
interface QueueDisplayItem {
  queueItem: QueueItem;
  originalIndex: number;
}

export function QueueSidebar() {
  const hydrated = useHydrated();
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const [queue, setQueue] = useAtom(queueAtom);
  const queueIndex = useAtomValue(queueIndexAtom);
  const currentTrack = useAtomValue(currentTrackAtom);
  const currentQueueItem = useAtomValue(currentQueueItemAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const removeFromQueue = useSetAtom(removeFromQueueAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const playAtIndex = useSetAtom(playAtIndexAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const isShuffled = useAtomValue(isShuffledAtom);
  const shuffledIndices = useAtomValue(shuffledIndicesAtom);
  const { togglePlayPause } = useAudioEngine();
  const [nowPlayingAddToPlaylist, setNowPlayingAddToPlaylist] = useState(false);

  // Calculate up next and previous tracks based on shuffle state
  const getUpNextAndPrevious = () => {
    if (isShuffled && shuffledIndices.length > 0) {
      const currentShufflePosition = shuffledIndices.indexOf(queueIndex);
      
      if (currentShufflePosition >= 0) {
        const upNextIndices = shuffledIndices.slice(currentShufflePosition + 1);
        const upNextTracks: QueueDisplayItem[] = upNextIndices.map(idx => ({ 
          queueItem: queue[idx], 
          originalIndex: idx 
        }));
        const previousIndices = shuffledIndices.slice(0, currentShufflePosition);
        const previousTracks: QueueDisplayItem[] = previousIndices.map(idx => ({ 
          queueItem: queue[idx], 
          originalIndex: idx 
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
      return;
    }
    
    // Non-shuffled: reconstruct full queue preserving QueueItems
    const newQueue: QueueItem[] = [
      ...previousTracks.map(t => t.queueItem),
      currentQueueItem!,
      ...newOrder.map(t => t.queueItem),
    ].filter(Boolean) as QueueItem[];
    setQueue(newQueue);
  };

  const handlePlayTrack = (index: number) => {
    playAtIndex(index);
  };

  const totalDuration = queue.reduce((acc, item) => acc + item.song.duration, 0);
  const remainingDuration = upNext.reduce((acc, item) => acc + item.queueItem.song.duration, 0) + 
    (currentTrack?.duration ?? 0);

  // Don't render until hydrated to prevent hydration mismatch with atomWithStorage
  if (!hydrated) {
    return null;
  }

  return (
    <>
      {/* Desktop sidebar */}
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
                  {queue.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearQueue}
                      className="text-muted-foreground hover:text-destructive h-8"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsOpen(false)}
                    className="h-8 w-8"
                  >
                    <PanelRightClose className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {queue.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <ListMusic className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold mb-1">Your queue is empty</h3>
                  <p className="text-sm text-muted-foreground">
                    Add songs to start listening
                  </p>
                </div>
              ) : (
                <ScrollArea className="flex-1 overflow-hidden">
                  <div className="p-4 space-y-6">
                    {/* Now Playing */}
                    {currentTrack && (
                      <section>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                          {playbackState === "ended" ? "Queue Ended" : "Now Playing"}
                        </h3>
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <div
                              className={cn(
                                "flex items-center gap-3 p-2 rounded-lg border group",
                                playbackState === "ended" 
                                  ? "bg-muted/50 border-border" 
                                  : "bg-primary/10 border-primary/20"
                              )}
                            >
                              {/* Now playing indicator - left of cover */}
                              {playbackState !== "ended" && (
                                <div className="shrink-0">
                                  <NowPlayingBars isAnimating={playbackState === "playing"} />
                                </div>
                              )}
                              {/* Cover art - clickable play/pause */}
                              <div 
                                className="group/cover relative shrink-0 cursor-pointer"
                                onClick={togglePlayPause}
                              >
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
                                <p className={cn(
                                  "text-sm font-medium truncate",
                                  playbackState === "ended" ? "text-foreground" : "text-primary"
                                )}>
                                  {currentTrack.title}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {currentTrack.artist}
                                </p>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground"
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setNowPlayingAddToPlaylist(true)}>
                                    <FolderPlus className="w-4 h-4 mr-2" />
                                    Add to Playlist
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {formatDuration(currentTrack.duration)}
                              </span>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => setNowPlayingAddToPlaylist(true)}>
                              <FolderPlus className="w-4 h-4 mr-2" />
                              Add to Playlist
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      </section>
                    )}

                    {/* Up Next */}
                    {upNext.length > 0 && (
                      <section>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Up Next
                          </h3>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(remainingDuration)}
                          </span>
                        </div>
                        <Reorder.Group
                          axis="y"
                          values={upNext}
                          onReorder={isShuffled ? () => {} : handleReorder}
                          className="space-y-1"
                          layoutScroll
                        >
                          <AnimatePresence mode="popLayout">
                            {upNext.map((item) => (
                              <DraggableQueueItem
                                key={item.queueItem.queueItemId}
                                item={item}
                                song={item.queueItem.song}
                                onPlay={() => handlePlayTrack(item.originalIndex)}
                                onRemove={() => removeFromQueue(item.originalIndex)}
                                onPlayNext={() => addToQueue([item.queueItem.song], "next")}
                                disableDrag={isShuffled}
                              />
                            ))}
                          </AnimatePresence>
                        </Reorder.Group>
                      </section>
                    )}

                    {/* Previously Played */}
                    {previousTracks.length > 0 && (
                      <section>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                          Previously Played
                        </h3>
                        <div className="space-y-1 opacity-60">
                          {previousTracks.map((item) => (
                            <PlayablePreviousItem
                              key={item.queueItem.queueItemId}
                              item={item}
                              onPlay={() => handlePlayTrack(item.originalIndex)}
                              onAddToQueue={() => addToQueue([item.queueItem.song], "last")}
                              onPlayNext={() => addToQueue([item.queueItem.song], "next")}
                            />
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                </ScrollArea>
              )}

              {/* Footer */}
              {queue.length > 0 && (
                <div className="px-4 py-3 border-t border-border bg-muted/30 text-xs text-muted-foreground shrink-0">
                  {queue.length} tracks • {formatDuration(totalDuration)} total
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.aside>
      
      {currentTrack && (
        <AddToPlaylistDialog
          open={nowPlayingAddToPlaylist}
          onOpenChange={setNowPlayingAddToPlaylist}
          songs={[currentTrack]}
        />
      )}
    </>
  );
}

interface PlayablePreviousItemProps {
  item: QueueDisplayItem;
  onPlay: () => void;
  onAddToQueue: () => void;
  onPlayNext: () => void;
}

function PlayablePreviousItem({ item, onPlay, onAddToQueue, onPlayNext }: PlayablePreviousItemProps) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const song = item.queueItem.song;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-default group">
            {/* Cover with play button overlay on cover hover */}
            <div 
              className="group/cover relative shrink-0 cursor-pointer"
              onClick={onPlay}
            >
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
              <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onAddToQueue}>
                  <ListEnd className="w-4 h-4 mr-2" />
                  Add to Queue
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onPlayNext}>
                  <ListStart className="w-4 h-4 mr-2" />
                  Play Next
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddToPlaylistOpen(true)}>
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Add to Playlist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {formatDuration(song.duration)}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onAddToQueue}>
            <ListEnd className="w-4 h-4 mr-2" />
            Add to Queue
          </ContextMenuItem>
          <ContextMenuItem onClick={onPlayNext}>
            <ListStart className="w-4 h-4 mr-2" />
            Play Next
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setAddToPlaylistOpen(true)}>
            <FolderPlus className="w-4 h-4 mr-2" />
            Add to Playlist
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={[song]}
      />
    </>
  );
}

interface DraggableQueueItemProps {
  item: QueueDisplayItem;
  song: Song;
  onPlay: () => void;
  onRemove: () => void;
  onPlayNext: () => void;
  disableDrag?: boolean;
}

function DraggableQueueItem({ item, song, onPlay, onRemove, onPlayNext, disableDrag }: DraggableQueueItemProps) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const dragControls = useDragControls();

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Reorder.Item
            value={item}
            id={item.queueItem.queueItemId}
            className="flex items-center gap-2 p-2 rounded-lg bg-card hover:bg-muted/50 group select-none max-w-full"
            dragListener={false}
            dragControls={disableDrag ? undefined : dragControls}
            dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
            whileDrag={disableDrag ? {} : { 
              scale: 1.02, 
              boxShadow: "0 10px 20px rgba(0,0,0,0.3)",
              zIndex: 50
            }}
          >
            {!disableDrag && (
              <div
                className="cursor-grab active:cursor-grabbing touch-none"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
              </div>
            )}
            
            {/* Cover with play button overlay on cover hover only */}
            <div 
              className="group/cover relative shrink-0 cursor-pointer"
              onClick={onPlay}
            >
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
              <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onPlayNext}>
                  <ListStart className="w-4 h-4 mr-2" />
                  Play Next
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddToPlaylistOpen(true)}>
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Add to Playlist
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRemove} className="text-destructive">
                  <X className="w-4 h-4 mr-2" />
                  Remove from Queue
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {formatDuration(song.duration)}
            </span>
          </Reorder.Item>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onPlayNext}>
            <ListStart className="w-4 h-4 mr-2" />
            Play Next
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setAddToPlaylistOpen(true)}>
            <FolderPlus className="w-4 h-4 mr-2" />
            Add to Playlist
          </ContextMenuItem>
          <ContextMenuItem onClick={onRemove} className="text-destructive">
            <X className="w-4 h-4 mr-2" />
            Remove from Queue
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={[song]}
      />
    </>
  );
}
