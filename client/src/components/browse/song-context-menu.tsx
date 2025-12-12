"use client";

import Link from "next/link";
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
  Unlink,
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
import { useSongActions, type QueueSource } from "@/lib/hooks/use-song-actions";
import type { Song } from "@/lib/api/types";

// Global function to dismiss any open context menu by simulating an escape key press
function dismissContextMenu() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

interface SongContextMenuProps {
  song: Song;
  children: React.ReactNode;
  queueSongs?: Song[];
  songIndex?: number;
  queueSource?: QueueSource;
  hideQueueActions?: boolean;
  showRemoveFromQueue?: boolean;
  onRemoveFromQueue?: () => void;
  showRemoveFromPlaylist?: boolean;
  onRemoveFromPlaylist?: (songId: string) => void;
  showMoveToPosition?: boolean;
  onMoveToPosition?: (song: Song, index: number) => void;
  moveToPositionLabel?: string;
  showRefineMatch?: boolean;
  onRefineMatch?: (song: Song, index: number) => void;
  showUnmatch?: boolean;
  onUnmatch?: (song: Song, index: number) => void;
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
  showUnmatch = false,
  onUnmatch,
}: SongContextMenuProps) {
  const {
    isStarred,
    toggleStar,
    isExcludedFromShuffle,
    handleToggleShuffleExclude,
    currentRating,
    handleRate,
    handlePlay,
    handlePlayNext,
    handleAddToQueue,
    handleDownload,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    detailsOpen,
    setDetailsOpen,
  } = useSongActions({ song, queueSongs, songIndex, queueSource });

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
      {showUnmatch && onUnmatch && songIndex !== undefined && (
        <ContextMenuItem
          onClick={() => onUnmatch(song, songIndex)}
          className="text-destructive"
        >
          <Unlink className="w-4 h-4 mr-2" />
          Unmatch Song
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
  songIndex?: number;
  queueSource?: QueueSource;
  trigger?: React.ReactNode;
  hideQueueActions?: boolean;
  showRemoveFromQueue?: boolean;
  onRemoveFromQueue?: () => void;
  showRemoveFromPlaylist?: boolean;
  onRemoveFromPlaylist?: (songId: string) => void;
  showMoveToPosition?: boolean;
  onMoveToPosition?: (song: Song, index: number) => void;
  moveToPositionLabel?: string;
  showRefineMatch?: boolean;
  onRefineMatch?: (song: Song, index: number) => void;
  showUnmatch?: boolean;
  onUnmatch?: (song: Song, index: number) => void;
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
  showUnmatch = false,
  onUnmatch,
}: SongDropdownMenuProps) {
  const {
    isStarred,
    toggleStar,
    isExcludedFromShuffle,
    handleToggleShuffleExclude,
    currentRating,
    handleRate,
    handlePlay,
    handlePlayNext,
    handleAddToQueue,
    handleDownload,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    detailsOpen,
    setDetailsOpen,
  } = useSongActions({ song, queueSongs, songIndex, queueSource });

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
          {showUnmatch && onUnmatch && songIndex !== undefined && (
            <DropdownMenuItem
              onClick={() => onUnmatch(song, songIndex)}
              className="text-destructive"
            >
              <Unlink className="w-4 h-4 mr-2" />
              Unmatch Song
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
