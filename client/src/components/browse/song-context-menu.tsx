"use client";

import { MoreHorizontal } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { DetailsDialog } from "@/components/shared/details-dialog";
import {
  SongMenuItemsQueue,
  SongMenuItemsStarring,
  SongMenuItemsNavigation,
  type MenuComponents,
} from "@/components/shared/media-menu-items";
import { useSongActions, type QueueSource } from "@/lib/hooks/use-song-actions";
import type { Song } from "@/lib/api/types";
import { useSetAtom, useAtom } from "jotai";
import {
  taggerSessionAtom,
  taggerTracksAtom,
  createTrackState,
} from "@/lib/store/tagger";
import { useRouter } from "next/navigation";

import { toast } from "sonner";
import { getClient } from "@/lib/api/client";

// Global function to dismiss any open context menu
// Uses a targeted approach to only close context menus, not other overlays like fullscreen player
function dismissContextMenu() {
  // Find any open context menu and simulate clicking outside it
  const contextMenu = document.querySelector(
    '[data-state="open"][data-slot="context-menu-content"]',
  );
  if (contextMenu) {
    // Dispatch escape only to the context menu's document context
    // by using a custom event that context menus listen for
    contextMenu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  }
}

// ===================================
// Menu component adapters
// ===================================

const contextMenuComponents: MenuComponents = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

const dropdownMenuComponents: MenuComponents = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

// ===================================
// Shared hook for mark for editing
// ===================================

function useMarkForEditing(song: Song) {
  const router = useRouter();
  const setSession = useSetAtom(taggerSessionAtom);
  const [tracks, setTracks] = useAtom(taggerTracksAtom);

  async function handleMarkForEditing() {
    // If already in tracks, just show toast
    if (tracks.has(song.id)) {
      toast.info("Track already marked for editing", {
        action: {
          label: "Open Tagger",
          onClick: () => router.push("/tagger"),
        },
      });
      return;
    }

    try {
      const client = getClient();
      if (!client) {
        toast.error("Not connected");
        return;
      }

      // Stage the track via API
      const response = await client.stageLibraryTracks([song.id]);

      // Add track to tracks atom
      const newTracks = new Map(tracks);
      for (const track of response.tracks) {
        newTracks.set(track.id, createTrackState(track));
      }
      setTracks(newTracks);

      // Add to session
      setSession((prev) => {
        if (prev.tracks.some((t) => t.id === song.id)) return prev;
        return {
          ...prev,
          tracks: [
            ...prev.tracks,
            { id: song.id, trackType: "library" as const },
          ],
        };
      });

      toast.success("Track marked for editing", {
        action: {
          label: "Open Tagger",
          onClick: () => router.push("/tagger"),
        },
      });
    } catch (error) {
      console.error("Failed to mark for editing:", error);
      toast.error("Failed to mark for editing");
    }
  }

  return handleMarkForEditing;
}

// ===================================
// Shared dialogs component
// ===================================

interface SongDialogsProps {
  song: Song;
  addToPlaylistOpen: boolean;
  setAddToPlaylistOpen: (open: boolean) => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  confirmDeletionOpen: boolean;
  setConfirmDeletionOpen: (open: boolean) => void;
  handleConfirmDeletion: () => void;
}

function SongDialogs({
  song,
  addToPlaylistOpen,
  setAddToPlaylistOpen,
  detailsOpen,
  setDetailsOpen,
  confirmDeletionOpen,
  setConfirmDeletionOpen,
  handleConfirmDeletion,
}: SongDialogsProps) {
  return (
    <>
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
      <AlertDialog
        open={confirmDeletionOpen}
        onOpenChange={setConfirmDeletionOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark for Deletion?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{song.title}&quot; will be moved to the recycle bin and
              permanently deleted after 30 days. This action can be undone from
              the Administration page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeletion}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Mark for Deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ===================================
// Context Menu Component
// ===================================

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
    confirmDeletionOpen,
    setConfirmDeletionOpen,
    handleConfirmDeletion,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    detailsOpen,
    setDetailsOpen,
  } = useSongActions({ song, queueSongs, songIndex, queueSource });

  const handleMarkForEditing = useMarkForEditing(song);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <SongMenuItemsQueue
            components={contextMenuComponents}
            handlers={{
              handlePlay,
              handlePlayNext,
              handleAddToQueue,
              setAddToPlaylistOpen,
            }}
            options={{
              hideQueueActions,
              showRemoveFromQueue,
              onRemoveFromQueue,
              showRemoveFromPlaylist,
              onRemoveFromPlaylist: onRemoveFromPlaylist
                ? () => onRemoveFromPlaylist(song.id)
                : undefined,
              showMoveToPosition: showMoveToPosition && songIndex !== undefined,
              onMoveToPosition:
                onMoveToPosition && songIndex !== undefined
                  ? () => onMoveToPosition(song, songIndex)
                  : undefined,
              moveToPositionLabel,
              showRefineMatch: showRefineMatch && songIndex !== undefined,
              onRefineMatch:
                onRefineMatch && songIndex !== undefined
                  ? () => onRefineMatch(song, songIndex)
                  : undefined,
              showUnmatch: showUnmatch && songIndex !== undefined,
              onUnmatch:
                onUnmatch && songIndex !== undefined
                  ? () => onUnmatch(song, songIndex)
                  : undefined,
            }}
          />
          <SongMenuItemsStarring
            components={contextMenuComponents}
            handlers={{
              toggleStar,
              handleToggleShuffleExclude,
              handleRate,
            }}
            state={{
              isStarred,
              isExcludedFromShuffle,
              currentRating,
            }}
          />
          <SongMenuItemsNavigation
            components={contextMenuComponents}
            handlers={{
              handleDownload,
              handleMarkForEditing,
              setDetailsOpen,
              setConfirmDeletionOpen,
            }}
            song={{
              artistId: song.artistId,
              albumId: song.albumId,
            }}
          />
        </ContextMenuContent>
      </ContextMenu>
      <SongDialogs
        song={song}
        addToPlaylistOpen={addToPlaylistOpen}
        setAddToPlaylistOpen={setAddToPlaylistOpen}
        detailsOpen={detailsOpen}
        setDetailsOpen={setDetailsOpen}
        confirmDeletionOpen={confirmDeletionOpen}
        setConfirmDeletionOpen={setConfirmDeletionOpen}
        handleConfirmDeletion={handleConfirmDeletion}
      />
    </>
  );
}

// ===================================
// Dropdown Menu Component
// ===================================

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
    confirmDeletionOpen,
    setConfirmDeletionOpen,
    handleConfirmDeletion,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    detailsOpen,
    setDetailsOpen,
  } = useSongActions({ song, queueSongs, songIndex, queueSource });

  const handleMarkForEditing = useMarkForEditing(song);

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
          <SongMenuItemsQueue
            components={dropdownMenuComponents}
            handlers={{
              handlePlay,
              handlePlayNext,
              handleAddToQueue,
              setAddToPlaylistOpen,
            }}
            options={{
              hideQueueActions,
              showRemoveFromQueue,
              onRemoveFromQueue,
              showRemoveFromPlaylist,
              onRemoveFromPlaylist: onRemoveFromPlaylist
                ? () => onRemoveFromPlaylist(song.id)
                : undefined,
              showMoveToPosition: showMoveToPosition && songIndex !== undefined,
              onMoveToPosition:
                onMoveToPosition && songIndex !== undefined
                  ? () => onMoveToPosition(song, songIndex)
                  : undefined,
              moveToPositionLabel,
              showRefineMatch: showRefineMatch && songIndex !== undefined,
              onRefineMatch:
                onRefineMatch && songIndex !== undefined
                  ? () => onRefineMatch(song, songIndex)
                  : undefined,
              showUnmatch: showUnmatch && songIndex !== undefined,
              onUnmatch:
                onUnmatch && songIndex !== undefined
                  ? () => onUnmatch(song, songIndex)
                  : undefined,
            }}
          />
          <SongMenuItemsStarring
            components={dropdownMenuComponents}
            handlers={{
              toggleStar,
              handleToggleShuffleExclude,
              handleRate,
            }}
            state={{
              isStarred,
              isExcludedFromShuffle,
              currentRating,
            }}
          />
          <SongMenuItemsNavigation
            components={dropdownMenuComponents}
            handlers={{
              handleDownload,
              handleMarkForEditing,
              setDetailsOpen,
              setConfirmDeletionOpen,
            }}
            song={{
              artistId: song.artistId,
              albumId: song.albumId,
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <SongDialogs
        song={song}
        addToPlaylistOpen={addToPlaylistOpen}
        setAddToPlaylistOpen={setAddToPlaylistOpen}
        detailsOpen={detailsOpen}
        setDetailsOpen={setDetailsOpen}
        confirmDeletionOpen={confirmDeletionOpen}
        setConfirmDeletionOpen={setConfirmDeletionOpen}
        handleConfirmDeletion={handleConfirmDeletion}
      />
    </>
  );
}
