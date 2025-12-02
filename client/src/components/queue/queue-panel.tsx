"use client";

import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { X, ListMusic, Trash2, GripVertical, Play, Clock, FolderPlus, MoreHorizontal } from "lucide-react";
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
} from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";
import { useIsDesktop } from "@/lib/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CoverImage } from "@/components/shared/cover-image";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { formatDuration } from "@/lib/utils/format";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";

function getCoverUrl(coverArt?: string): string | undefined {
  if (!coverArt) return undefined;
  const client = getClient();
  return client?.getCoverArtUrl(coverArt, 100);
}

/**
 * Mobile-only queue panel (Sheet/Drawer).
 * On desktop, use QueueSidebar instead.
 */
export function QueuePanel() {
  const isDesktop = useIsDesktop();
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const [queue, setQueue] = useAtom(queueAtom);
  const queueIndex = useAtomValue(queueIndexAtom);
  const currentTrack = useAtomValue(currentTrackAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const removeFromQueue = useSetAtom(removeFromQueueAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const setQueueIndex = useSetAtom(setQueueIndexAtom);
  const isShuffled = useAtomValue(isShuffledAtom);
  const shuffledIndices = useAtomValue(shuffledIndicesAtom);
  const [nowPlayingAddToPlaylist, setNowPlayingAddToPlaylist] = useState(false);

  // Calculate up next and previous tracks based on shuffle state
  const getUpNextAndPrevious = () => {
    if (isShuffled && shuffledIndices.length > 0) {
      // Find current position in shuffled order
      const currentShufflePosition = shuffledIndices.indexOf(queueIndex);
      
      if (currentShufflePosition >= 0) {
        // Get indices that come after current in shuffle order
        const upNextIndices = shuffledIndices.slice(currentShufflePosition + 1);
        const upNextTracks = upNextIndices.map(idx => ({ song: queue[idx], originalIndex: idx }));
        
        // Get indices that came before current in shuffle order
        const previousIndices = shuffledIndices.slice(0, currentShufflePosition);
        const previousTracks = previousIndices.map(idx => ({ song: queue[idx], originalIndex: idx }));
        
        return { upNext: upNextTracks, previous: previousTracks };
      }
    }
    
    // Non-shuffled: use regular queue order
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
      // When shuffled, reordering affects the shuffle order, not the queue itself
      const currentShufflePosition = shuffledIndices.indexOf(queueIndex);
      const newShuffleOrder = [
        ...shuffledIndices.slice(0, currentShufflePosition + 1),
        ...newOrder.map(item => item.originalIndex),
      ];
      // Note: This would require adding a setShuffledIndices action
      // For now, we disable reordering when shuffled
      return;
    }
    
    // Non-shuffled: reconstruct full queue
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

  const totalDuration = queue.reduce((acc, song) => acc + song.duration, 0);
  const remainingDuration = upNext.reduce((acc, item) => acc + item.song.duration, 0) + 
    (currentTrack?.duration ?? 0);

  // Don't render the Sheet on desktop - use QueueSidebar instead
  if (isDesktop) {
    return null;
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent 
        side="right" 
        className="w-full sm:w-[400px] p-0 flex flex-col"
      >
        <SheetHeader className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between pr-8">
            <SheetTitle className="flex items-center gap-2">
              <ListMusic className="w-5 h-5" />
              Queue
            </SheetTitle>
            {queue.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearQueue}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
            )}
          </div>
        </SheetHeader>

        {queue.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
              <ListMusic className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">Your queue is empty</h3>
            <p className="text-sm text-muted-foreground">
              Add songs to start listening
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {/* Now Playing / Queue Ended */}
              {currentTrack && (
                <section>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {playbackState === "ended" ? "Queue Ended" : "Now Playing"}
                  </h3>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-lg border group",
                      playbackState === "ended" 
                        ? "bg-muted/50 border-border" 
                        : "bg-primary/10 border-primary/20"
                    )}
                  >
                    <div className="relative shrink-0">
                      <CoverImage
                        src={getCoverUrl(currentTrack.coverArt)}
                        alt={currentTrack.title}
                        colorSeed={currentTrack.album}
                        type="song"
                        size="sm"
                      />
                      {playbackState === "playing" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded">
                          <div className="flex items-end gap-0.5 h-4">
                            {[0, 1, 2].map((i) => (
                              <motion.div
                                key={i}
                                className="w-1 bg-primary rounded-full"
                                animate={{
                                  height: ["40%", "100%", "40%"],
                                }}
                                transition={{
                                  duration: 0.8,
                                  repeat: Infinity,
                                  delay: i * 0.2,
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "font-medium truncate",
                        playbackState === "ended" ? "text-foreground" : "text-primary"
                      )}>
                        {currentTrack.title}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {currentTrack.artist}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground"
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
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatDuration(currentTrack.duration)}
                    </span>
                  </motion.div>
                </section>
              )}

              {/* Up Next */}
              {upNext.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
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
                        <QueueItem
                          key={`${item.song.id}-${item.originalIndex}`}
                          item={item}
                          song={item.song}
                          queueIndex={item.originalIndex}
                          onPlay={() => handlePlayTrack(item.originalIndex)}
                          onRemove={() => removeFromQueue(item.originalIndex)}
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
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Previously Played
                  </h3>
                  <div className="space-y-1 opacity-60">
                    {previousTracks.map((item, index) => (
                      <div
                        key={`${item.song.id}-${item.originalIndex}`}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer group"
                        onClick={() => handlePlayTrack(item.originalIndex)}
                      >
                        <CoverImage
                          src={getCoverUrl(item.song.coverArt)}
                          alt={item.song.title}
                          colorSeed={item.song.album}
                          type="song"
                          size="sm"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {item.song.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.song.artist}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 h-8 w-8 p-0"
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Footer with stats */}
        {queue.length > 0 && (
          <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground">
            <p>
              {queue.length} tracks • {formatDuration(totalDuration)} total
            </p>
          </div>
        )}
      </SheetContent>
      {currentTrack && (
        <AddToPlaylistDialog
          open={nowPlayingAddToPlaylist}
          onOpenChange={setNowPlayingAddToPlaylist}
          songs={[currentTrack]}
        />
      )}
    </Sheet>
  );
}

interface QueueItemProps {
  item: { song: Song; originalIndex: number };
  song: Song;
  queueIndex: number;
  onPlay: () => void;
  onRemove: () => void;
  disableDrag?: boolean;
}

function QueueItem({ item, song, queueIndex, onPlay, onRemove, disableDrag }: QueueItemProps) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const dragControls = useDragControls();

  return (
    <>
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
        
        <div 
          className="relative shrink-0 cursor-pointer"
          onClick={onPlay}
        >
          <CoverImage
            src={getCoverUrl(song.coverArt)}
            alt={song.title}
            colorSeed={song.album}
            type="song"
            size="sm"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded transition-opacity">
            <Play className="w-4 h-4 text-white" fill="white" />
          </div>
        </div>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={onPlay}>
          <p className="text-sm font-medium truncate">{song.title}</p>
          <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
        </div>

        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatDuration(song.duration)}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
      </Reorder.Item>
      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={[song]}
      />
    </>
  );
}
