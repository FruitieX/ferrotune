"use client";

import { useState } from "react";
import { useAtom } from "jotai";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
  Trash2,
  Merge,
  ListMinus,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { MergePlaylistsDialog } from "@/components/playlists/merge-playlists-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { shuffleExcludesAtom } from "@/lib/store/shuffle-excludes";
import { getClient } from "@/lib/api/client";
import type { Song, Album, Artist, Genre, Playlist } from "@/lib/api/types";
import { cn } from "@/lib/utils";

// Type for different media types
export type MediaType = "song" | "album" | "artist" | "genre" | "playlist";

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
  /** Selected IDs for bulk operations (used when not all songs are loaded) */
  selectedIds?: Set<string>;
  className?: string;
}

// Props for song-specific bulk actions
interface SongBulkActionsBarProps extends BaseBulkActionsBarProps {
  mediaType?: "song";
  /** Returns loaded songs that are selected (may be subset of selectedIds) */
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

// Props for playlist-specific bulk actions (no starring, but has delete/merge)
interface PlaylistBulkActionsBarProps extends BaseBulkActionsBarProps {
  mediaType: "playlist";
  getSelectedItems: () => Playlist[];
  onDelete?: () => void;
  onMerge?: (name: string) => void;
}

// Props for playlist detail view - songs within a playlist
interface PlaylistSongsBulkActionsBarProps extends BaseBulkActionsBarProps {
  mediaType: "playlist-songs";
  getSelectedSongs: () => Song[];
  onRemoveFromPlaylist?: () => void;
  /** Disable playback-related actions (play, shuffle, add to queue) when selection includes non-playable items */
  disablePlaybackActions?: boolean;
  /** Number of selected missing entries (for label display) */
  missingCount?: number;
}

type BulkActionsBarProps =
  | SongBulkActionsBarProps
  | AlbumBulkActionsBarProps
  | ArtistBulkActionsBarProps
  | GenreBulkActionsBarProps
  | PlaylistBulkActionsBarProps
  | PlaylistSongsBulkActionsBarProps;

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
  selectedIds?: Set<string>;
  className?: string;
}

export function BulkActionsBar(
  props: BulkActionsBarProps | LegacyBulkActionsBarProps,
) {
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [_shuffleExcludes, setShuffleExcludes] = useAtom(shuffleExcludesAtom);

  // Determine media type and get label
  const mediaType = "mediaType" in props ? (props.mediaType ?? "song") : "song";
  const itemLabel =
    mediaType === "song" || mediaType === "playlist-songs"
      ? "song"
      : mediaType === "album"
        ? "album"
        : mediaType === "artist"
          ? "artist"
          : mediaType === "playlist"
            ? "playlist"
            : "genre";
  const pluralLabel = props.selectedCount === 1 ? itemLabel : `${itemLabel}s`;

  // Check if starring is supported (not for genres, playlists, or playlist-songs)
  const supportsStarring =
    mediaType !== "genre" &&
    mediaType !== "playlist" &&
    mediaType !== "playlist-songs" &&
    props.onStar &&
    props.onUnstar;

  // Get songs for add to playlist (only for songs and playlist-songs)
  const canAddToPlaylist =
    (mediaType === "song" || mediaType === "playlist-songs") &&
    "getSelectedSongs" in props;
  const getSelectedSongs = canAddToPlaylist
    ? (props as SongBulkActionsBarProps | PlaylistSongsBulkActionsBarProps)
        .getSelectedSongs
    : () => [];

  // Get selected IDs (prefer selectedIds prop, fallback to getSelectedSongs)
  const getSelectedIds = (): string[] => {
    if ("selectedIds" in props && props.selectedIds) {
      return Array.from(props.selectedIds);
    }
    if (canAddToPlaylist) {
      return getSelectedSongs().map((s) => s.id);
    }
    return [];
  };

  // Check if shuffle exclude is supported (only for songs)
  const canShuffleExclude =
    (mediaType === "song" || mediaType === "playlist-songs") &&
    ("getSelectedSongs" in props || "selectedIds" in props);

  // Check for playlist-specific actions
  const isPlaylistType = mediaType === "playlist" && "onDelete" in props;
  const onDelete = isPlaylistType
    ? (props as PlaylistBulkActionsBarProps).onDelete
    : undefined;
  const onMerge = isPlaylistType
    ? (props as PlaylistBulkActionsBarProps).onMerge
    : undefined;
  const canMerge = isPlaylistType && props.selectedCount >= 2;

  // Check for playlist-songs-specific actions
  const isPlaylistSongsType =
    mediaType === "playlist-songs" && "onRemoveFromPlaylist" in props;
  const onRemoveFromPlaylist = isPlaylistSongsType
    ? (props as PlaylistSongsBulkActionsBarProps).onRemoveFromPlaylist
    : undefined;
  const disablePlaybackActions =
    isPlaylistSongsType && "disablePlaybackActions" in props
      ? (props as PlaylistSongsBulkActionsBarProps).disablePlaybackActions
      : false;
  const missingCount =
    isPlaylistSongsType && "missingCount" in props
      ? ((props as PlaylistSongsBulkActionsBarProps).missingCount ?? 0)
      : 0;

  // Build selection label - show breakdown for playlist-songs with missing entries
  const getSelectionLabel = () => {
    if (missingCount > 0 && isPlaylistSongsType) {
      const songCount = props.selectedCount - missingCount;
      const songLabel = songCount === 1 ? "song" : "songs";
      const missingLabel = missingCount === 1 ? "not found" : "not found";
      return `${songCount} ${songLabel} (${missingCount} ${missingLabel})`;
    }
    return `${props.selectedCount} ${pluralLabel}`;
  };

  // Handler for bulk shuffle exclude
  const handleBulkShuffleExclude = async (excluded: boolean) => {
    const client = getClient();
    if (!client || !canShuffleExclude) return;

    const songIds = getSelectedIds();
    if (songIds.length === 0) return;

    try {
      await client.bulkSetShuffleExcludes(songIds, excluded);

      // Update local state
      setShuffleExcludes((prev: Set<string>) => {
        const next = new Set(prev);
        if (excluded) {
          songIds.forEach((id) => next.add(id));
        } else {
          songIds.forEach((id) => next.delete(id));
        }
        return next;
      });

      toast.success(
        excluded
          ? `Excluded ${songIds.length} songs from shuffle`
          : `Included ${songIds.length} songs in shuffle`,
      );
      props.onClear();
    } catch (error) {
      toast.error("Failed to update shuffle settings");
      console.error(error);
    }
  };

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
              props.className,
            )}
          >
            <div className="flex items-center gap-1">
              {/* Selection count and clear */}
              <div className="flex items-center gap-2 px-3 border-r border-border">
                <span
                  className="text-sm font-medium text-primary tabular-nums"
                  aria-live="polite"
                >
                  {getSelectionLabel()}
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
                  <TooltipContent side="top">
                    Clear selection (Esc)
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Actions */}
              <div
                className="flex items-center gap-1 px-1"
                role="group"
                aria-label="Bulk actions"
              >
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
                      disabled={disablePlaybackActions}
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {disablePlaybackActions
                      ? "Deselect missing entries to play"
                      : "Play now"}
                  </TooltipContent>
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
                        disabled={disablePlaybackActions}
                      >
                        <Shuffle className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {disablePlaybackActions
                        ? "Deselect missing entries to shuffle"
                        : "Shuffle"}
                    </TooltipContent>
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
                        disabled={disablePlaybackActions}
                      >
                        <ListPlus className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {disablePlaybackActions
                        ? "Deselect missing entries to play next"
                        : "Play next"}
                    </TooltipContent>
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
                        disabled={disablePlaybackActions}
                      >
                        <ListEnd className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {disablePlaybackActions
                        ? "Deselect missing entries to add to queue"
                        : "Add to queue"}
                    </TooltipContent>
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
                        disabled={disablePlaybackActions}
                      >
                        <FolderPlus className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {disablePlaybackActions
                        ? "Deselect missing entries to add to playlist"
                        : "Add to playlist"}
                    </TooltipContent>
                  </Tooltip>
                )}

                {supportsStarring && (
                  <>
                    <div
                      className="w-px h-6 bg-border mx-1"
                      role="separator"
                      aria-orientation="vertical"
                    />

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
                      <TooltipContent side="top">
                        Add to favorites
                      </TooltipContent>
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
                      <TooltipContent side="top">
                        Remove from favorites
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}

                {/* Playlist-specific actions */}
                {isPlaylistType && (
                  <>
                    <div
                      className="w-px h-6 bg-border mx-1"
                      role="separator"
                      aria-orientation="vertical"
                    />

                    {onMerge && canMerge && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            onClick={() => setMergeDialogOpen(true)}
                            aria-label="Merge playlists"
                          >
                            <Merge className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          Merge playlists
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {onDelete && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirmOpen(true)}
                            aria-label="Delete playlists"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          Delete playlists
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </>
                )}

                {/* Playlist songs - remove from playlist */}
                {isPlaylistSongsType && onRemoveFromPlaylist && (
                  <>
                    <div
                      className="w-px h-6 bg-border mx-1"
                      role="separator"
                      aria-orientation="vertical"
                    />

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-destructive hover:text-destructive"
                          onClick={onRemoveFromPlaylist}
                          aria-label="Remove from playlist"
                        >
                          <ListMinus className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Remove from playlist
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}

                {/* More actions dropdown for songs */}
                {canShuffleExclude && !disablePlaybackActions && (
                  <>
                    <div
                      className="w-px h-6 bg-border mx-1"
                      role="separator"
                      aria-orientation="vertical"
                    />

                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9"
                              aria-label="More actions"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="top">More actions</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent
                        align="center"
                        side="top"
                        className="mb-2"
                      >
                        <DropdownMenuItem
                          onClick={() => handleBulkShuffleExclude(true)}
                        >
                          <Shuffle className="w-4 h-4 mr-2 text-muted-foreground line-through" />
                          Exclude from shuffle
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleBulkShuffleExclude(false)}
                        >
                          <Shuffle className="w-4 h-4 mr-2" />
                          Include in shuffle
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
          songIds={
            addToPlaylistOpen && "selectedIds" in props && props.selectedIds
              ? Array.from(props.selectedIds)
              : undefined
          }
        />
      )}

      {/* Delete confirmation dialog for playlists */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {props.selectedCount} {pluralLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected playlists will be
              permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete?.();
                setDeleteConfirmOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge playlists dialog */}
      {onMerge && (
        <MergePlaylistsDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          selectedCount={props.selectedCount}
          onConfirm={onMerge}
        />
      )}
    </>
  );
}
