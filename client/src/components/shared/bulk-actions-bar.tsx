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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={onClear}
                      aria-label="Clear selection"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Clear selection (Esc)</TooltipContent>
                </Tooltip>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 px-1" role="group" aria-label="Bulk actions">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={onSelectAll}
                      aria-label="Select all"
                    >
                      <CheckSquare className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Select all</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={onPlayNow}
                      aria-label="Play now"
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Play now</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={onPlayNext}
                      aria-label="Play next"
                    >
                      <ListPlus className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Play next</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={onAddToQueue}
                      aria-label="Add to queue"
                    >
                      <ListEnd className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Add to queue</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setAddToPlaylistOpen(true)}
                      aria-label="Add to playlist"
                    >
                      <FolderPlus className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Add to playlist</TooltipContent>
                </Tooltip>

                <div className="w-px h-6 bg-border mx-1" role="separator" aria-orientation="vertical" />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={onStar}
                      aria-label="Add to favorites"
                    >
                      <Heart className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Add to favorites</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={onUnstar}
                      aria-label="Remove from favorites"
                    >
                      <HeartOff className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Remove from favorites</TooltipContent>
                </Tooltip>
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
