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
  Shuffle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import type { Song, Album, Artist, Genre } from "@/lib/api/types";
import { cn } from "@/lib/utils";

// Type for different media types
export type MediaType = "song" | "album" | "artist" | "genre";

interface BaseBulkActionsBarProps {
  selectedCount: number;
  onClear: () => void;
  onPlayNow: () => void;
  onShuffle?: () => void;
  onPlayNext?: () => void;
  onAddToQueue?: () => void;
  onStar?: () => void;
  onUnstar?: () => void;
  onSelectAll: () => void;
  className?: string;
}

// Props for song-specific bulk actions
interface SongBulkActionsBarProps extends BaseBulkActionsBarProps {
  mediaType?: "song";
  getSelectedSongs: () => Song[];
}

// Props for album-specific bulk actions
interface AlbumBulkActionsBarProps extends BaseBulkActionsBarProps {
  mediaType: "album";
  getSelectedItems: () => Album[];
}

// Props for artist-specific bulk actions
interface ArtistBulkActionsBarProps extends BaseBulkActionsBarProps {
  mediaType: "artist";
  getSelectedItems: () => Artist[];
}

// Props for genre-specific bulk actions (no starring)
interface GenreBulkActionsBarProps extends BaseBulkActionsBarProps {
  mediaType: "genre";
  getSelectedItems: () => Genre[];
}

type BulkActionsBarProps = 
  | SongBulkActionsBarProps 
  | AlbumBulkActionsBarProps 
  | ArtistBulkActionsBarProps
  | GenreBulkActionsBarProps;

// Legacy interface for backwards compatibility
interface LegacyBulkActionsBarProps {
  selectedCount: number;
  onClear: () => void;
  onPlayNow: () => void;
  onShuffle?: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onStar: () => void;
  onUnstar: () => void;
  onSelectAll: () => void;
  getSelectedSongs: () => Song[];
  className?: string;
}

export function BulkActionsBar(props: BulkActionsBarProps | LegacyBulkActionsBarProps) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  // Determine media type and get label
  const mediaType = 'mediaType' in props ? props.mediaType ?? 'song' : 'song';
  const itemLabel = mediaType === 'song' ? 'song' : mediaType === 'album' ? 'album' : mediaType === 'artist' ? 'artist' : 'genre';
  const pluralLabel = props.selectedCount === 1 ? itemLabel : `${itemLabel}s`;

  // Check if starring is supported (not for genres)
  const supportsStarring = mediaType !== 'genre' && props.onStar && props.onUnstar;

  // Get songs for add to playlist (only for songs)
  const canAddToPlaylist = mediaType === 'song' && 'getSelectedSongs' in props;
  const getSelectedSongs = canAddToPlaylist ? (props as SongBulkActionsBarProps).getSelectedSongs : () => [];

  return (
    <>
      <AnimatePresence>
        {props.selectedCount > 0 && (
          <motion.div
            role="toolbar"
            aria-label={`Bulk actions for ${props.selectedCount} selected ${pluralLabel}`}
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={cn(
              "fixed bottom-24 left-1/2 -translate-x-1/2 z-50",
              "bg-card/95 backdrop-blur-lg border border-border rounded-full",
              "shadow-2xl shadow-black/20",
              "px-2 py-2",
              props.className
            )}
          >
            <div className="flex items-center gap-1">
              {/* Selection count and clear */}
              <div className="flex items-center gap-2 px-3 border-r border-border">
                <span className="text-sm font-medium text-primary tabular-nums" aria-live="polite">
                  {props.selectedCount} {pluralLabel}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={props.onClear}
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
                      onClick={props.onSelectAll}
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
                      onClick={props.onPlayNow}
                      aria-label="Play now"
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Play now</TooltipContent>
                </Tooltip>

                {props.onShuffle && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={props.onShuffle}
                        aria-label="Shuffle play"
                      >
                        <Shuffle className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Shuffle</TooltipContent>
                  </Tooltip>
                )}

                {props.onPlayNext && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={props.onPlayNext}
                        aria-label="Play next"
                      >
                        <ListPlus className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Play next</TooltipContent>
                  </Tooltip>
                )}

                {props.onAddToQueue && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={props.onAddToQueue}
                        aria-label="Add to queue"
                      >
                        <ListEnd className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Add to queue</TooltipContent>
                  </Tooltip>
                )}

                {canAddToPlaylist && (
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
                )}

                {supportsStarring && (
                  <>
                    <div className="w-px h-6 bg-border mx-1" role="separator" aria-orientation="vertical" />

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          onClick={props.onStar}
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
                          onClick={props.onUnstar}
                          aria-label="Remove from favorites"
                        >
                          <HeartOff className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Remove from favorites</TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {canAddToPlaylist && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songs={addToPlaylistOpen ? getSelectedSongs() : []}
        />
      )}
    </>
  );
}
