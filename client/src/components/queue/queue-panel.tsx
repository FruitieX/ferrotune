"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { X, ListMusic, Trash2, GripVertical, Play, Clock } from "lucide-react";
import { queuePanelOpenAtom } from "@/lib/store/ui";
import {
  queueAtom,
  queueIndexAtom,
  currentTrackAtom,
  removeFromQueueAtom,
  clearQueueAtom,
  setQueueIndexAtom,
} from "@/lib/store/queue";
import { playbackStateAtom } from "@/lib/store/player";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoverImage } from "@/components/shared/cover-image";
import { formatDuration } from "@/lib/utils/format";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";

function getCoverUrl(coverArt?: string): string | undefined {
  if (!coverArt) return undefined;
  const client = getClient();
  return client?.getCoverArtUrl(coverArt, 100);
}

export function QueuePanel() {
  const [isOpen, setIsOpen] = useAtom(queuePanelOpenAtom);
  const [queue, setQueue] = useAtom(queueAtom);
  const queueIndex = useAtomValue(queueIndexAtom);
  const currentTrack = useAtomValue(currentTrackAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const removeFromQueue = useSetAtom(removeFromQueueAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const setQueueIndex = useSetAtom(setQueueIndexAtom);

  const upNext = queue.slice(queueIndex + 1);
  const previousTracks = queue.slice(0, queueIndex);

  const handleReorder = (newOrder: Song[]) => {
    // Reconstruct full queue with previous tracks, current, and reordered upcoming
    const newQueue = [...previousTracks, currentTrack!, ...newOrder].filter(Boolean);
    setQueue(newQueue);
  };

  const handlePlayTrack = (index: number) => {
    setQueueIndex(index);
  };

  const totalDuration = queue.reduce((acc, song) => acc + song.duration, 0);
  const remainingDuration = upNext.reduce((acc, song) => acc + song.duration, 0) + 
    (currentTrack?.duration ?? 0);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent 
        side="right" 
        className="w-full sm:w-[400px] p-0 flex flex-col"
      >
        <SheetHeader className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <ListMusic className="w-5 h-5" />
              Queue
            </SheetTitle>
            <div className="flex items-center gap-2">
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
              {/* Now Playing */}
              {currentTrack && (
                <section>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Now Playing
                  </h3>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 p-2 rounded-lg bg-primary/10 border border-primary/20"
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
                      <p className="font-medium truncate text-primary">
                        {currentTrack.title}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {currentTrack.artist}
                      </p>
                    </div>
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
                    onReorder={handleReorder}
                    className="space-y-1"
                  >
                    <AnimatePresence mode="popLayout">
                      {upNext.map((song, index) => (
                        <QueueItem
                          key={`${song.id}-${queueIndex + 1 + index}`}
                          song={song}
                          onPlay={() => handlePlayTrack(queueIndex + 1 + index)}
                          onRemove={() => removeFromQueue(queueIndex + 1 + index)}
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
                    {previousTracks.map((song, index) => (
                      <div
                        key={`${song.id}-${index}`}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer group"
                        onClick={() => handlePlayTrack(index)}
                      >
                        <CoverImage
                          src={getCoverUrl(song.coverArt)}
                          alt={song.title}
                          size="sm"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {song.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {song.artist}
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
    </Sheet>
  );
}

interface QueueItemProps {
  song: Song;
  onPlay: () => void;
  onRemove: () => void;
}

function QueueItem({ song, onPlay, onRemove }: QueueItemProps) {
  return (
    <Reorder.Item
      value={song}
      className="flex items-center gap-2 p-2 rounded-lg bg-card hover:bg-muted/50 cursor-grab active:cursor-grabbing group"
    >
      <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
      
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

      <div className="flex-1 min-w-0" onClick={onPlay}>
        <p className="text-sm font-medium truncate">{song.title}</p>
        <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
      </div>

      <span className="text-xs text-muted-foreground tabular-nums">
        {formatDuration(song.duration)}
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="w-4 h-4" />
      </Button>
    </Reorder.Item>
  );
}
