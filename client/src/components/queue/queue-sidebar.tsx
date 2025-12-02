"use client";

import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { X, ListMusic, Trash2, GripVertical, Play, Pause, Clock, FolderPlus, MoreHorizontal, PanelRightClose, ListEnd } from "lucide-react";
import { cn } from "@/lib/utils";
import { queuePanelOpenAtom } from "@/lib/store/ui";
import {
  queueAtom,
  queueIndexAtom,
  currentTrackAtom,
  removeFromQueueAtom,
  clearQueueAtom,
  setQueueIndexAtom,
  isShuffledAtom,
  shuffledIndicesAtom,
  addToQueueAtom,
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

// Consolidated NowPlayingBars component with 3 bars (matching the simpler style)
function NowPlayingBars({ isAnimating = true }: { isAnimating?: boolean }) {
  return (
    <div className="flex items-end justify-center gap-0.5 h-3">
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
    </div>
  );
}

function getCoverUrl(coverArt?: string): string | undefined {
  if (!coverArt) return undefined;
  const client = getClient();
  return client?.getCoverArtUrl(coverArt, 100);
}

export function QueueSidebar() {
  const hydrated = useHydrated();
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const [queue, setQueue] = useAtom(queueAtom);
  const queueIndex = useAtomValue(queueIndexAtom);
  const currentTrack = useAtomValue(currentTrackAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const removeFromQueue = useSetAtom(removeFromQueueAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const setQueueIndex = useSetAtom(setQueueIndexAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const isShuffled = useAtomValue(isShuffledAtom);
  const shuffledIndices = useAtomValue(shuffledIndicesAtom);
  const [nowPlayingAddToPlaylist, setNowPlayingAddToPlaylist] = useState(false);
  const { togglePlayPause } = useAudioEngine();

  // Calculate up next and previous tracks based on shuffle state
  const getUpNextAndPrevious = () => {
    if (isShuffled && shuffledIndices.length > 0) {
      const currentShufflePosition = shuffledIndices.indexOf(queueIndex);
      
      if (currentShufflePosition >= 0) {
        const upNextIndices = shuffledIndices.slice(currentShufflePosition + 1);
        const upNextTracks = upNextIndices.map(idx => ({ song: queue[idx], originalIndex: idx }));
        const previousIndices = shuffledIndices.slice(0, currentShufflePosition);
        const previousTracks = previousIndices.map(idx => ({ song: queue[idx], originalIndex: idx }));
        
        return { upNext: upNextTracks, previous: previousTracks };
      }
    }
    
    const upNextTracks = queue.slice(queueIndex + 1).map((song, i) => ({
      song,
      originalIndex: queueIndex + 1 + i,
    }));
    const previousTracks = queue.slice(0, queueIndex).map((song, i) => ({
      song,
      originalIndex: i,
    }));
    
    return { upNext: upNextTracks, previous: previousTracks };
  };

  const { upNext, previous: previousTracks } = getUpNextAndPrevious();

  const handleReorder = (newOrder: { song: Song; originalIndex: number }[]) => {
    if (isShuffled && shuffledIndices.length > 0) {
      return;
    }
    
    const newQueue = [
      ...previousTracks.map(t => t.song),
      currentTrack!,
      ...newOrder.map(t => t.song),
    ].filter(Boolean);
    setQueue(newQueue);
  };

  const handlePlayTrack = (index: number) => {
    setQueueIndex(index);
  };

  // Play next: move a song to the top of the "up next" queue
  const handlePlayNext = (songIndex: number) => {
    if (isShuffled) return; // Don't support in shuffle mode
    
    const song = queue[songIndex];
    if (!song) return;
    
    // Remove from current position and insert right after current track
    const newQueue = queue.filter((_, i) => i !== songIndex);
    const insertPosition = queueIndex + 1;
    newQueue.splice(insertPosition, 0, song);
    setQueue(newQueue);
  };

  const totalDuration = queue.reduce((acc, song) => acc + song.duration, 0);
  const remainingDuration = upNext.reduce((acc, item) => acc + item.song.duration, 0) + 
    (currentTrack?.duration ?? 0);

  const isPlaying = playbackState === "playing";

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
              className="flex flex-col h-full w-[360px] overflow-hidden"
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
                <ScrollArea className="flex-1 overflow-y-auto overflow-x-hidden">
                  <div className="p-4 space-y-6 w-full max-w-full">
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
                              {/* Now playing animated icon */}
                              <div className="w-4 shrink-0 flex justify-center">
                                {playbackState !== "ended" && (
                                  <NowPlayingBars isAnimating={isPlaying} />
                                )}
                              </div>
                              
                              {/* Cover art with play/pause on click */}
                              <button
                                type="button"
                                className="relative shrink-0 cursor-pointer group/cover"
                                onClick={togglePlayPause}
                              >
                                <CoverImage
                                  src={getCoverUrl(currentTrack.coverArt)}
                                  alt={currentTrack.title}
                                  colorSeed={currentTrack.album}
                                  type="song"
                                  size="sm"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 rounded transition-opacity">
                                  {isPlaying ? (
                                    <Pause className="w-4 h-4 text-white" />
                                  ) : (
                                    <Play className="w-4 h-4 text-white ml-0.5" />
                                  )}
                                </div>
                              </button>

                              <div className="flex-1 min-w-0 overflow-hidden">
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
                                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground shrink-0"
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
                              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
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
                          className="space-y-1 overflow-hidden"
                          layoutScroll
                        >
                          <AnimatePresence mode="popLayout">
                            {upNext.map((item) => (
                              <QueueItem
                                key={`${item.song.id}-${item.originalIndex}`}
                                item={item}
                                song={item.song}
                                queueIndex={item.originalIndex}
                                onPlay={() => handlePlayTrack(item.originalIndex)}
                                onRemove={() => removeFromQueue(item.originalIndex)}
                                onPlayNext={() => handlePlayNext(item.originalIndex)}
                                disableDrag={isShuffled}
                                showPlayNext={!isShuffled}
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
                        <div className="space-y-1 opacity-60 overflow-hidden">
                          {previousTracks.map((item) => (
                            <PreviouslyPlayedItem
                              key={`${item.song.id}-${item.originalIndex}`}
                              song={item.song}
                              originalIndex={item.originalIndex}
                              onPlay={() => handlePlayTrack(item.originalIndex)}
                              onAddToQueue={() => addToQueue(item.song, "last")}
                              onPlayNext={() => addToQueue(item.song, "next")}
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

interface QueueItemProps {
  item: { song: Song; originalIndex: number };
  song: Song;
  queueIndex: number;
  onPlay: () => void;
  onRemove: () => void;
  onPlayNext?: () => void;
  disableDrag?: boolean;
  showPlayNext?: boolean;
}

function QueueItem({ item, song, queueIndex, onPlay, onRemove, onPlayNext, disableDrag, showPlayNext }: QueueItemProps) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const dragControls = useDragControls();

  const menuItems = (
    <>
      {showPlayNext && onPlayNext && (
        <DropdownMenuItem onClick={onPlayNext}>
          <ListEnd className="w-4 h-4 mr-2" />
          Play Next
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => setAddToPlaylistOpen(true)}>
        <FolderPlus className="w-4 h-4 mr-2" />
        Add to Playlist
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onRemove} className="text-destructive">
        <X className="w-4 h-4 mr-2" />
        Remove from Queue
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Reorder.Item
            value={item}
            id={`${song.id}-${queueIndex}`}
            className="flex items-center gap-2 p-2 rounded-lg bg-card hover:bg-muted/50 group select-none"
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
            
            {/* Cover art with play button - only cover art triggers playback */}
            <button
              type="button"
              className="relative shrink-0 cursor-pointer group/cover"
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
            >
              <CoverImage
                src={getCoverUrl(song.coverArt)}
                alt={song.title}
                colorSeed={song.album}
                type="song"
                size="sm"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 rounded transition-opacity">
                <Play className="w-4 h-4 text-white ml-0.5" />
              </div>
            </button>

            {/* Text content - clicking does NOT start playback */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-sm font-medium truncate">{song.title}</p>
              <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
            </div>

            {/* Menu button first, then duration */}
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
                {menuItems}
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {formatDuration(song.duration)}
            </span>
          </Reorder.Item>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {showPlayNext && onPlayNext && (
            <ContextMenuItem onClick={onPlayNext}>
              <ListEnd className="w-4 h-4 mr-2" />
              Play Next
            </ContextMenuItem>
          )}
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

interface PreviouslyPlayedItemProps {
  song: Song;
  originalIndex: number;
  onPlay: () => void;
  onAddToQueue: () => void;
  onPlayNext: () => void;
}

function PreviouslyPlayedItem({ song, originalIndex, onPlay, onAddToQueue, onPlayNext }: PreviouslyPlayedItemProps) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 group">
            {/* Cover art with play button - only cover art triggers playback */}
            <button
              type="button"
              className="relative shrink-0 cursor-pointer group/cover"
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
            >
              <CoverImage
                src={getCoverUrl(song.coverArt)}
                alt={song.title}
                colorSeed={song.album}
                type="song"
                size="sm"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 rounded transition-opacity">
                <Play className="w-4 h-4 text-white ml-0.5" />
              </div>
            </button>

            {/* Text content - clicking does NOT start playback */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-sm font-medium truncate">{song.title}</p>
              <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
            </div>

            {/* Menu button first, then duration */}
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
                  <ListEnd className="w-4 h-4 mr-2" />
                  Play Next
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onAddToQueue}>
                  <ListMusic className="w-4 h-4 mr-2" />
                  Add to Queue
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
          <ContextMenuItem onClick={onPlayNext}>
            <ListEnd className="w-4 h-4 mr-2" />
            Play Next
          </ContextMenuItem>
          <ContextMenuItem onClick={onAddToQueue}>
            <ListMusic className="w-4 h-4 mr-2" />
            Add to Queue
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
