"use client";

import { useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  Play,
  ListPlus,
  ListEnd,
  Heart,
  Star,
  Download,
  MoreHorizontal,
  User,
  Disc,
  FolderPlus,
  Info,
  X,
  Shuffle,
  Move,
  RefreshCw,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { DetailsDialog } from "@/components/shared/details-dialog";
import {
  startQueueAtom,
  addToQueueAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import { useStarred } from "@/lib/store/starred";
import { shuffleExcludesAtom } from "@/lib/store/shuffle-excludes";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import Link from "next/link";

// Global function to dismiss any open context menu by simulating an escape key press
function dismissContextMenu() {
  // Dispatch Escape key to close any open context menu
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

interface SongContextMenuProps {
  song: Song;
  children: React.ReactNode;
  queueSongs?: Song[];
  /** The index of this song in the queue/list (for views with duplicate songs) */
  songIndex?: number;
  /** Source info for the queue when playing from a collection */
  queueSource?: {
    type: string;
    id?: string | null;
    name?: string | null;
    filters?: Record<string, unknown>;
    sort?: { field: string; direction: string };
  };
  /** Hide Play, Play Next, Add to Queue options (for queue items) */
  hideQueueActions?: boolean;
  /** Show "Remove from Queue" option */
  showRemoveFromQueue?: boolean;
  /** Callback for removing from queue */
  onRemoveFromQueue?: () => void;
  /** Show "Remove from Playlist" option */
  showRemoveFromPlaylist?: boolean;
  /** Callback for removing from playlist */
  onRemoveFromPlaylist?: (songId: string) => void;
  /** Show "Move to Position" option */
  showMoveToPosition?: boolean;
  /** Callback for move to position */
  onMoveToPosition?: (song: Song, index: number) => void;
  /** Label for move to position action */
  moveToPositionLabel?: string;
  /** Show "Refine Match" option (for songs that were auto-matched from playlist imports) */
  showRefineMatch?: boolean;
  /** Callback for refine match */
  onRefineMatch?: (song: Song, index: number) => void;
}

export function SongContextMenu({
  song,
  children,
  queueSongs,
  songIndex,
  queueSource,
  hideQueueActions = false,
  showRemoveFromQueue = false,
  onRemoveFromQueue,
  showRemoveFromPlaylist = false,
  onRemoveFromPlaylist,
  showMoveToPosition = false,
  onMoveToPosition,
  moveToPositionLabel = "Move to Position",
  showRefineMatch = false,
  onRefineMatch,
}: SongContextMenuProps) {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);
  const [shuffleExcludes, setShuffleExcludes] = useAtom(shuffleExcludesAtom);
  const [currentRating, setCurrentRating] = useState(song.userRating ?? 0);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isExcludedFromShuffle = shuffleExcludes.has(song.id);

  const handleToggleShuffleExclude = async () => {
    const client = getClient();
    if (!client) return;

    const newExcluded = !isExcludedFromShuffle;
    try {
      await client.setShuffleExclude(song.id, newExcluded);
      setShuffleExcludes((prev: Set<string>) => {
        const next = new Set(prev);
        if (newExcluded) {
          next.add(song.id);
        } else {
          next.delete(song.id);
        }
        return next;
      });
      toast.success(
        newExcluded
          ? `"${song.title}" excluded from shuffle`
          : `"${song.title}" included in shuffle`,
      );
    } catch (error) {
      toast.error("Failed to update shuffle setting");
      console.error(error);
    }
  };

  const handlePlay = () => {
    if (queueSource?.type && queueSource.type !== "other") {
      // Use server-side queue materialization for known sources
      // Prefer songIndex if provided (handles duplicate songs), otherwise find by ID
      const index =
        songIndex ?? queueSongs?.findIndex((s) => s.id === song.id) ?? 0;
      startQueue({
        sourceType: queueSource.type as QueueSourceType,
        sourceId: queueSource.id ?? undefined,
        sourceName: queueSource.name ?? undefined,
        startIndex: index >= 0 ? index : 0,
        filters: queueSource.filters,
        sort: queueSource.sort,
      });
    } else if (queueSongs && queueSongs.length > 0) {
      // Fallback to explicit song IDs for custom lists
      // Prefer songIndex if provided, otherwise find by ID
      const index = songIndex ?? queueSongs.findIndex((s) => s.id === song.id);
      startQueue({
        sourceType: (queueSource?.type as QueueSourceType) || "other",
        sourceName: queueSource?.name ?? undefined,
        startIndex: index >= 0 ? index : 0,
        songIds: queueSongs.map((s) => s.id),
      });
    } else {
      // Single song
      startQueue({
        sourceType: "other",
        startIndex: 0,
        songIds: [song.id],
      });
    }
  };

  const handlePlayNext = () => {
    addToQueue({ songIds: [song.id], position: "next" });
    toast.success(`Added "${song.title}" to play next`);
  };

  const handleAddToQueue = () => {
    addToQueue({ songIds: [song.id], position: "end" });
    toast.success(`Added "${song.title}" to queue`);
  };

  const handleRate = async (rating: number) => {
    const client = getClient();
    if (!client) return;

    try {
      await client.setRating(song.id, rating);
      setCurrentRating(rating);
      toast.success(
        rating > 0
          ? `Rated "${song.title}" ${rating} stars`
          : `Removed rating from "${song.title}"`,
      );
    } catch (error) {
      toast.error("Failed to set rating");
      console.error(error);
    }
  };

  const handleDownload = () => {
    const client = getClient();
    if (!client) return;

    const downloadUrl = client.getDownloadUrl(song.id);
    window.open(downloadUrl, "_blank");
  };

  const menuItems = (
    <>
      {!hideQueueActions && (
        <>
          <ContextMenuItem onClick={handlePlay}>
            <Play className="w-4 h-4 mr-2" />
            Play
          </ContextMenuItem>
          <ContextMenuItem onClick={handlePlayNext}>
            <ListPlus className="w-4 h-4 mr-2" />
            Play Next
          </ContextMenuItem>
          <ContextMenuItem onClick={handleAddToQueue}>
            <ListEnd className="w-4 h-4 mr-2" />
            Add to Queue
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem onClick={() => setAddToPlaylistOpen(true)}>
        <FolderPlus className="w-4 h-4 mr-2" />
        Add to Playlist
      </ContextMenuItem>
      {showRemoveFromQueue && onRemoveFromQueue && (
        <ContextMenuItem onClick={onRemoveFromQueue}>
          <X className="w-4 h-4 mr-2" />
          Remove from Queue
        </ContextMenuItem>
      )}
      {showMoveToPosition && onMoveToPosition && songIndex !== undefined && (
        <ContextMenuItem onClick={() => onMoveToPosition(song, songIndex)}>
          <Move className="w-4 h-4 mr-2" />
          {moveToPositionLabel}
        </ContextMenuItem>
      )}
      {showRemoveFromPlaylist && onRemoveFromPlaylist && (
        <ContextMenuItem
          onClick={() => onRemoveFromPlaylist(song.id)}
          className="text-destructive"
        >
          <X className="w-4 h-4 mr-2" />
          Remove from Playlist
        </ContextMenuItem>
      )}
      {showRefineMatch && onRefineMatch && songIndex !== undefined && (
        <ContextMenuItem onClick={() => onRefineMatch(song, songIndex)}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refine Match
        </ContextMenuItem>
      )}

      <ContextMenuSeparator />

      <ContextMenuItem onClick={toggleStar}>
        <Heart
          className={`w-4 h-4 mr-2 ${isStarred ? "fill-red-500 text-red-500" : ""}`}
        />
        {isStarred ? "Remove from Favorites" : "Add to Favorites"}
      </ContextMenuItem>

      <ContextMenuItem onClick={handleToggleShuffleExclude}>
        <Shuffle
          className={`w-4 h-4 mr-2 ${isExcludedFromShuffle ? "text-muted-foreground line-through" : ""}`}
        />
        {isExcludedFromShuffle ? "Include in Shuffle" : "Exclude from Shuffle"}
      </ContextMenuItem>

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Star
            className={`w-4 h-4 mr-2 ${currentRating > 0 ? "fill-yellow-500 text-yellow-500" : ""}`}
          />
          Rate {currentRating > 0 && `(${currentRating})`}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {[5, 4, 3, 2, 1].map((rating) => (
            <ContextMenuItem
              key={rating}
              onClick={() => handleRate(rating)}
              className={currentRating === rating ? "bg-accent" : ""}
            >
              {Array.from({ length: rating }).map((_, i) => (
                <Star
                  key={i}
                  className="w-3 h-3 fill-yellow-500 text-yellow-500"
                />
              ))}
              {Array.from({ length: 5 - rating }).map((_, i) => (
                <Star key={i} className="w-3 h-3 text-muted-foreground" />
              ))}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handleRate(0)}>
            Remove Rating
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />

      <ContextMenuItem asChild>
        <Link href={`/library/artists/details?id=${song.artistId}`}>
          <User className="w-4 h-4 mr-2" />
          Go to Artist
        </Link>
      </ContextMenuItem>
      <ContextMenuItem asChild>
        <Link href={`/library/albums/details?id=${song.albumId}`}>
          <Disc className="w-4 h-4 mr-2" />
          Go to Album
        </Link>
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={handleDownload}>
        <Download className="w-4 h-4 mr-2" />
        Download
      </ContextMenuItem>
      <ContextMenuItem onClick={() => setDetailsOpen(true)}>
        <Info className="w-4 h-4 mr-2" />
        View Details
      </ContextMenuItem>
    </>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {menuItems}
        </ContextMenuContent>
      </ContextMenu>
      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={[song]}
      />
      <DetailsDialog
        item={{ type: "song", data: song }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

// Dropdown variant for mobile and click-triggered menu
interface SongDropdownMenuProps {
  song: Song;
  queueSongs?: Song[];
  /** The index of this song in the queue/list (for views with duplicate songs) */
  songIndex?: number;
  queueSource?: {
    type: string;
    id?: string | null;
    name?: string | null;
    filters?: Record<string, unknown>;
    sort?: { field: string; direction: string };
  };
  trigger?: React.ReactNode;
  /** Hide Play, Play Next, Add to Queue options (for queue items) */
  hideQueueActions?: boolean;
  /** Show "Remove from Queue" option */
  showRemoveFromQueue?: boolean;
  /** Callback for removing from queue */
  onRemoveFromQueue?: () => void;
  /** Show "Remove from Playlist" option */
  showRemoveFromPlaylist?: boolean;
  /** Callback for removing from playlist */
  onRemoveFromPlaylist?: (songId: string) => void;
  /** Show "Move to Position" option */
  showMoveToPosition?: boolean;
  /** Callback for move to position */
  onMoveToPosition?: (song: Song, index: number) => void;
  /** Label for move to position action */
  moveToPositionLabel?: string;
  /** Show "Refine Match" option (for songs that were auto-matched from playlist imports) */
  showRefineMatch?: boolean;
  /** Callback for refine match */
  onRefineMatch?: (song: Song, index: number) => void;
}

export function SongDropdownMenu({
  song,
  queueSongs,
  songIndex,
  queueSource,
  trigger,
  hideQueueActions = false,
  showRemoveFromQueue = false,
  onRemoveFromQueue,
  showRemoveFromPlaylist = false,
  onRemoveFromPlaylist,
  showMoveToPosition = false,
  onMoveToPosition,
  moveToPositionLabel = "Move to Position",
  showRefineMatch = false,
  onRefineMatch,
}: SongDropdownMenuProps) {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const { isStarred, toggleStar } = useStarred(song.id, !!song.starred);
  const [shuffleExcludes, setShuffleExcludes] = useAtom(shuffleExcludesAtom);
  const [currentRating, setCurrentRating] = useState(song.userRating ?? 0);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isExcludedFromShuffle = shuffleExcludes.has(song.id);

  const handleToggleShuffleExclude = async () => {
    const client = getClient();
    if (!client) return;

    const newExcluded = !isExcludedFromShuffle;
    try {
      await client.setShuffleExclude(song.id, newExcluded);
      setShuffleExcludes((prev: Set<string>) => {
        const next = new Set(prev);
        if (newExcluded) {
          next.add(song.id);
        } else {
          next.delete(song.id);
        }
        return next;
      });
      toast.success(
        newExcluded
          ? `"${song.title}" excluded from shuffle`
          : `"${song.title}" included in shuffle`,
      );
    } catch (error) {
      toast.error("Failed to update shuffle setting");
      console.error(error);
    }
  };

  const handlePlay = () => {
    if (queueSource?.type && queueSource.type !== "other") {
      // Use server-side queue materialization for known sources
      // Prefer songIndex if provided (handles duplicate songs), otherwise find by ID
      const index =
        songIndex ?? queueSongs?.findIndex((s) => s.id === song.id) ?? 0;
      startQueue({
        sourceType: queueSource.type as QueueSourceType,
        sourceId: queueSource.id ?? undefined,
        sourceName: queueSource.name ?? undefined,
        startIndex: index >= 0 ? index : 0,
        filters: queueSource.filters,
        sort: queueSource.sort,
      });
    } else if (queueSongs && queueSongs.length > 0) {
      // Prefer songIndex if provided, otherwise find by ID
      const index = songIndex ?? queueSongs.findIndex((s) => s.id === song.id);
      startQueue({
        sourceType: (queueSource?.type as QueueSourceType) || "other",
        sourceName: queueSource?.name ?? undefined,
        songIds: queueSongs.map((s) => s.id),
        startIndex: index >= 0 ? index : 0,
      });
    } else {
      startQueue({
        sourceType: "other",
        songIds: [song.id],
        startIndex: 0,
      });
    }
  };

  const handlePlayNext = () => {
    addToQueue({ songIds: [song.id], position: "next" });
    toast.success(`Added "${song.title}" to play next`);
  };

  const handleAddToQueue = () => {
    addToQueue({ songIds: [song.id], position: "end" });
    toast.success(`Added "${song.title}" to queue`);
  };

  const handleRate = async (rating: number) => {
    const client = getClient();
    if (!client) return;

    try {
      await client.setRating(song.id, rating);
      setCurrentRating(rating);
      toast.success(
        rating > 0
          ? `Rated "${song.title}" ${rating} stars`
          : `Removed rating from "${song.title}"`,
      );
    } catch (error) {
      toast.error("Failed to set rating");
      console.error(error);
    }
  };

  const handleDownload = () => {
    const client = getClient();
    if (!client) return;

    const downloadUrl = client.getDownloadUrl(song.id);
    window.open(downloadUrl, "_blank");
  };

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 bg-background/80 hover:bg-background"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <MoreHorizontal className="w-4 h-4" />
      <span className="sr-only">More options</span>
    </Button>
  );

  // Dismiss any open context menu when dropdown opens
  const handleDropdownOpenChange = (open: boolean) => {
    if (open) {
      dismissContextMenu();
    }
  };

  return (
    <>
      <DropdownMenu onOpenChange={handleDropdownOpenChange}>
        <DropdownMenuTrigger asChild>
          {trigger ?? defaultTrigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {!hideQueueActions && (
            <>
              <DropdownMenuItem onClick={handlePlay}>
                <Play className="w-4 h-4 mr-2" />
                Play
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePlayNext}>
                <ListPlus className="w-4 h-4 mr-2" />
                Play Next
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAddToQueue}>
                <ListEnd className="w-4 h-4 mr-2" />
                Add to Queue
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onClick={() => setAddToPlaylistOpen(true)}>
            <FolderPlus className="w-4 h-4 mr-2" />
            Add to Playlist
          </DropdownMenuItem>
          {showRemoveFromQueue && onRemoveFromQueue && (
            <DropdownMenuItem onClick={onRemoveFromQueue}>
              <X className="w-4 h-4 mr-2" />
              Remove from Queue
            </DropdownMenuItem>
          )}
          {showMoveToPosition &&
            onMoveToPosition &&
            songIndex !== undefined && (
              <DropdownMenuItem
                onClick={() => onMoveToPosition(song, songIndex)}
              >
                <Move className="w-4 h-4 mr-2" />
                {moveToPositionLabel}
              </DropdownMenuItem>
            )}
          {showRemoveFromPlaylist && onRemoveFromPlaylist && (
            <DropdownMenuItem
              onClick={() => onRemoveFromPlaylist(song.id)}
              className="text-destructive"
            >
              <X className="w-4 h-4 mr-2" />
              Remove from Playlist
            </DropdownMenuItem>
          )}
          {showRefineMatch && onRefineMatch && songIndex !== undefined && (
            <DropdownMenuItem onClick={() => onRefineMatch(song, songIndex)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refine Match
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={toggleStar}>
            <Heart
              className={`w-4 h-4 mr-2 ${isStarred ? "fill-red-500 text-red-500" : ""}`}
            />
            {isStarred ? "Remove from Favorites" : "Add to Favorites"}
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleToggleShuffleExclude}>
            <Shuffle
              className={`w-4 h-4 mr-2 ${isExcludedFromShuffle ? "text-muted-foreground line-through" : ""}`}
            />
            {isExcludedFromShuffle
              ? "Include in Shuffle"
              : "Exclude from Shuffle"}
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Star
                className={`w-4 h-4 mr-2 ${currentRating > 0 ? "fill-yellow-500 text-yellow-500" : ""}`}
              />
              Rate {currentRating > 0 && `(${currentRating})`}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {[5, 4, 3, 2, 1].map((rating) => (
                <DropdownMenuItem
                  key={rating}
                  onClick={() => handleRate(rating)}
                  className={currentRating === rating ? "bg-accent" : ""}
                >
                  {Array.from({ length: rating }).map((_, i) => (
                    <Star
                      key={i}
                      className="w-3 h-3 fill-yellow-500 text-yellow-500"
                    />
                  ))}
                  {Array.from({ length: 5 - rating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 text-muted-foreground" />
                  ))}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleRate(0)}>
                Remove Rating
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <Link href={`/library/artists/details?id=${song.artistId}`}>
              <User className="w-4 h-4 mr-2" />
              Go to Artist
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/library/albums/details?id=${song.albumId}`}>
              <Disc className="w-4 h-4 mr-2" />
              Go to Album
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
            <Info className="w-4 h-4 mr-2" />
            View Details
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={[song]}
      />
      <DetailsDialog
        item={{ type: "song", data: song }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}
