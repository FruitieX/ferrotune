"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Play,
  ListPlus,
  ListEnd,
  Heart,
  HeartOff,
  FolderPlus,
  CheckSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import type { Song } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface BulkActionsBarProps {
  selectedCount: number;
  onClear: () => void;
  onPlayNow: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onStar: () => void;
  onUnstar: () => void;
  onSelectAll: () => void;
  getSelectedSongs: () => Song[];
  className?: string;
}

export function BulkActionsBar({
  selectedCount,
  onClear,
  onPlayNow,
  onPlayNext,
  onAddToQueue,
  onStar,
  onUnstar,
  onSelectAll,
  getSelectedSongs,
  className,
}: BulkActionsBarProps) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  return (
    <>
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            role="toolbar"
            aria-label={`Bulk actions for ${selectedCount} selected songs`}
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={cn(
              "fixed bottom-24 left-1/2 -translate-x-1/2 z-50",
              "bg-card/95 backdrop-blur-lg border border-border rounded-full",
              "shadow-2xl shadow-black/20",
              "px-2 py-2",
              className
            )}
          >
            <div className="flex items-center gap-1">
              {/* Selection count and clear */}
              <div className="flex items-center gap-2 px-3 border-r border-border">
                <span className="text-sm font-medium text-primary tabular-nums" aria-live="polite">
                  {selectedCount} selected
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onClear}
                  aria-label="Clear selection (Escape key)"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 px-1" role="group" aria-label="Bulk actions">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={onSelectAll}
                  aria-label="Select all (Ctrl+A)"
                >
                  <CheckSquare className="w-4 h-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={onPlayNow}
                  aria-label="Play selected songs"
                >
                  <Play className="w-4 h-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={onPlayNext}
                  aria-label="Add selected songs to play next"
                >
                  <ListPlus className="w-4 h-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={onAddToQueue}
                  aria-label="Add selected songs to end of queue"
                >
                  <ListEnd className="w-4 h-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setAddToPlaylistOpen(true)}
                  aria-label="Add selected songs to playlist"
                >
                  <FolderPlus className="w-4 h-4" />
                </Button>

                <div className="w-px h-6 bg-border mx-1" role="separator" aria-orientation="vertical" />

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={onStar}
                  aria-label="Add selected songs to favorites"
                >
                  <Heart className="w-4 h-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={onUnstar}
                  aria-label="Remove selected songs from favorites"
                >
                  <HeartOff className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={addToPlaylistOpen ? getSelectedSongs() : []}
      />
    </>
  );
}
