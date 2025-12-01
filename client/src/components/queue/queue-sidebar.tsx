"use client";

import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { X, ListMusic, Trash2, GripVertical, Play, Clock, FolderPlus, MoreHorizontal, PanelRightClose, PanelRightOpen } from "lucide-react";
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
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
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

const QUEUE_SIDEBAR_WIDTH = 360;

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
  const isShuffled = useAtomValue(isShuffledAtom);
  const shuffledIndices = useAtomValue(shuffledIndicesAtom);
  const [nowPlayingAddToPlaylist, setNowPlayingAddToPlaylist] = useState(false);

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

  const totalDuration = queue.reduce((acc, song) => acc + song.duration, 0);
  const remainingDuration = upNext.reduce((acc, item) => acc + item.song.duration, 0) + 
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
          "hidden lg:flex flex-col bg-background border-l border-border overflow-hidden",
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
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-6">
                    {/* Now Playing */}
                    {currentTrack && (
                      <section>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                          {playbackState === "ended" ? "Queue Ended" : "Now Playing"}
                        </h3>
                        <div
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
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                          Previously Played
                        </h3>
                        <div className="space-y-1 opacity-60">
                          {previousTracks.map((item) => (
                            <div
                              key={`${item.song.id}-${item.originalIndex}`}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer group"
                              onClick={() => handlePlayTrack(item.originalIndex)}
                            >
                              <CoverImage
                                src={getCoverUrl(item.song.coverArt)}
                                alt={item.song.title}
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
                                className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0"
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
  disableDrag?: boolean;
}

function QueueItem({ item, song, queueIndex, onPlay, onRemove, disableDrag }: QueueItemProps) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  return (
    <>
      <Reorder.Item
        value={item}
        id={`${song.id}-${queueIndex}`}
        className={cn(
          "flex items-center gap-2 p-2 rounded-lg bg-card hover:bg-muted/50 group select-none",
          disableDrag ? "cursor-default" : "cursor-grab active:cursor-grabbing"
        )}
        dragListener={!disableDrag}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
        whileDrag={disableDrag ? {} : { 
          scale: 1.02, 
          boxShadow: "0 10px 20px rgba(0,0,0,0.3)",
          zIndex: 50
        }}
      >
        {!disableDrag && (
          <GripVertical className="w-4 h-4 text-muted-foreground shrink-0 touch-none" />
        )}
        
        <div 
          className="relative shrink-0 cursor-pointer"
          onClick={onPlay}
        >
          <CoverImage
            src={getCoverUrl(song.coverArt)}
            alt={song.title}
            size="sm"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded transition-opacity">
            <Play className="w-4 h-4 text-white" fill="white" />
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-hidden cursor-pointer" onClick={onPlay}>
          <p className="text-sm font-medium truncate">{song.title}</p>
          <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
        </div>

        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDuration(song.duration)}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground"
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
