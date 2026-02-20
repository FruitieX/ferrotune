"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  MoreHorizontal,
  Play,
  ListPlus,
  ListEnd,
  Heart,
  HeartOff,
  FolderPlus,
  Shuffle,
  Pen,
  Trash2,
  Ban,
  Settings,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  selectionStateAtom,
  clearSelectionAtom,
  selectedCountAtom,
} from "@/lib/store/selection";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { starredItemsAtom, useInvalidateFavorites } from "@/lib/store/starred";
import { shuffleExcludesAtom } from "@/lib/store/shuffle-excludes";
import { disabledSongsAtom } from "@/lib/store/disabled-songs";
import {
  taggerSessionAtom,
  taggerTracksAtom,
  createTrackState,
} from "@/lib/store/tagger";
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
// Hook for bulk song actions
// ===================================

function useBulkSongActions(songs: Song[]) {
  const router = useRouter();
  const selectionState = useAtomValue(selectionStateAtom);
  const selectedCount = useAtomValue(selectedCountAtom);
  const clearSelection = useSetAtom(clearSelectionAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const setStarredItems = useSetAtom(starredItemsAtom);
  const invalidateFavorites = useInvalidateFavorites();
  const [_shuffleExcludes, setShuffleExcludes] = useAtom(shuffleExcludesAtom);
  const [_disabledSongs, setDisabledSongs] = useAtom(disabledSongsAtom);
  const [tracks, setTracks] = useAtom(taggerTracksAtom);
  const setSession = useSetAtom(taggerSessionAtom);

  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  // Get selected song IDs
  const selectedIds = Array.from(selectionState.selectedIds);

  // Check if we should show bulk actions (multiple items selected and song is selected)
  const shouldShowBulkActions = (songId: string) =>
    selectedCount > 1 && selectionState.selectedIds.has(songId);

  // Get selected songs that are in the current list
  const getSelectedSongs = (): Song[] => {
    return songs.filter((song) => selectionState.selectedIds.has(song.id));
  };

  // Play selected songs
  const handlePlay = () => {
    if (selectedIds.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: `${selectedCount} selected songs`,
      songIds: selectedIds,
      startIndex: 0,
    });
    clearSelection();
  };

  // Shuffle play selected songs
  const handleShuffle = () => {
    if (selectedIds.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: `${selectedCount} selected songs`,
      songIds: selectedIds,
      startIndex: 0,
      shuffle: true,
    });
    clearSelection();
  };

  // Play next
  const handlePlayNext = async () => {
    if (selectedIds.length === 0) return;
    const result = await addToQueue({ songIds: selectedIds, position: "next" });
    if (result.success) {
      toast.success(`Added ${selectedIds.length} songs to play next`);
    } else {
      toast.error("Failed to add songs to queue");
    }
    clearSelection();
  };

  // Add to queue
  const handleAddToQueue = async () => {
    if (selectedIds.length === 0) return;
    const result = await addToQueue({ songIds: selectedIds, position: "end" });
    if (result.success) {
      toast.success(`Added ${selectedIds.length} songs to queue`);
    } else {
      toast.error("Failed to add songs to queue");
    }
    clearSelection();
  };

  // Star all selected
  const handleStar = async () => {
    const client = getClient();
    if (!client || selectedIds.length === 0) return;

    try {
      // Star in batches
      const batchSize = 50;
      for (let i = 0; i < selectedIds.length; i += batchSize) {
        const batch = selectedIds.slice(i, i + batchSize);
        await Promise.all(batch.map((id) => client.star({ id })));
      }

      // Update local state
      setStarredItems((current) => {
        const updated = new Map(current);
        for (const id of selectedIds) {
          updated.set(`song:${id}`, true);
        }
        return updated;
      });

      toast.success(`Added ${selectedIds.length} songs to favorites`);
      invalidateFavorites("song");
      clearSelection();
    } catch (error) {
      toast.error("Failed to add to favorites");
      console.error(error);
    }
  };

  // Unstar all selected
  const handleUnstar = async () => {
    const client = getClient();
    if (!client || selectedIds.length === 0) return;

    try {
      // Unstar in batches
      const batchSize = 50;
      for (let i = 0; i < selectedIds.length; i += batchSize) {
        const batch = selectedIds.slice(i, i + batchSize);
        await Promise.all(batch.map((id) => client.unstar({ id })));
      }

      // Update local state
      setStarredItems((current) => {
        const updated = new Map(current);
        for (const id of selectedIds) {
          updated.set(`song:${id}`, false);
        }
        return updated;
      });

      toast.success(`Removed ${selectedIds.length} songs from favorites`);
      invalidateFavorites("song");
      clearSelection();
    } catch (error) {
      toast.error("Failed to remove from favorites");
      console.error(error);
    }
  };

  // Exclude from shuffle
  const handleExcludeFromShuffle = async () => {
    const client = getClient();
    if (!client || selectedIds.length === 0) return;

    try {
      await client.bulkSetShuffleExcludes(selectedIds, true);

      setShuffleExcludes((prev: Set<string>) => {
        const next = new Set(prev);
        selectedIds.forEach((id) => next.add(id));
        return next;
      });

      toast.success(`Excluded ${selectedIds.length} songs from shuffle`);
      clearSelection();
    } catch (error) {
      toast.error("Failed to update shuffle settings");
      console.error(error);
    }
  };

  // Include in shuffle
  const handleIncludeInShuffle = async () => {
    const client = getClient();
    if (!client || selectedIds.length === 0) return;

    try {
      await client.bulkSetShuffleExcludes(selectedIds, false);

      setShuffleExcludes((prev: Set<string>) => {
        const next = new Set(prev);
        selectedIds.forEach((id) => next.delete(id));
        return next;
      });

      toast.success(`Included ${selectedIds.length} songs in shuffle`);
      clearSelection();
    } catch (error) {
      toast.error("Failed to update shuffle settings");
      console.error(error);
    }
  };

  // Disable tracks
  const handleDisable = async () => {
    const client = getClient();
    if (!client || selectedIds.length === 0) return;

    try {
      await client.bulkSetDisabled(selectedIds, true);

      setDisabledSongs((prev: Set<string>) => {
        const next = new Set(prev);
        selectedIds.forEach((id) => next.add(id));
        return next;
      });

      toast.success(`Disabled ${selectedIds.length} tracks`);
      clearSelection();
    } catch (error) {
      toast.error("Failed to update disabled status");
      console.error(error);
    }
  };

  // Enable tracks
  const handleEnable = async () => {
    const client = getClient();
    if (!client || selectedIds.length === 0) return;

    try {
      await client.bulkSetDisabled(selectedIds, false);

      setDisabledSongs((prev: Set<string>) => {
        const next = new Set(prev);
        selectedIds.forEach((id) => next.delete(id));
        return next;
      });

      toast.success(`Enabled ${selectedIds.length} tracks`);
      clearSelection();
    } catch (error) {
      toast.error("Failed to update disabled status");
      console.error(error);
    }
  };

  // Mark for editing in tagger
  const handleMarkForEditing = async () => {
    const client = getClient();
    if (!client || selectedIds.length === 0) return;

    // Filter out already-added tracks
    const newIds = selectedIds.filter((id) => !tracks.has(id));
    if (newIds.length === 0) {
      toast.info(
        selectedIds.length === 1
          ? "Track already marked for editing"
          : "All tracks already marked for editing",
        {
          action: {
            label: "Open Tagger",
            onClick: () => router.push("/tagger"),
          },
        },
      );
      return;
    }

    try {
      const response = await client.stageLibraryTracks(newIds);

      // Add tracks to tracks atom
      const newTracks = new Map(tracks);
      for (const track of response.tracks) {
        newTracks.set(track.id, createTrackState(track));
      }
      setTracks(newTracks);

      // Add to session
      setSession((prev) => {
        const existingIds = new Set(prev.tracks.map((t) => t.id));
        const tracksToAdd = response.tracks
          .filter((t) => !existingIds.has(t.id))
          .map((t) => ({ id: t.id, trackType: "library" as const }));
        return {
          ...prev,
          tracks: [...prev.tracks, ...tracksToAdd],
        };
      });

      const skippedCount = selectedIds.length - newIds.length;
      const message =
        skippedCount > 0
          ? `${newIds.length} tracks marked for editing (${skippedCount} already added)`
          : `${newIds.length} tracks marked for editing`;

      toast.success(message, {
        action: {
          label: "Open Tagger",
          onClick: () => router.push("/tagger"),
        },
      });
      clearSelection();
    } catch (error) {
      console.error("Failed to mark for editing:", error);
      toast.error("Failed to mark tracks for editing");
    }
  };

  // State for deletion confirmation
  const [confirmDeletionOpen, setConfirmDeletionOpen] = useState(false);

  // Mark for deletion (move to recycle bin)
  const handleConfirmDeletion = async () => {
    const client = getClient();
    if (!client || selectedIds.length === 0) return;

    try {
      await client.markForDeletion(selectedIds);
      setConfirmDeletionOpen(false);
      toast.success(
        `${selectedIds.length} song${selectedIds.length > 1 ? "s" : ""} moved to recycle bin`,
        {
          description: "Files will be permanently deleted in 30 days",
          action: {
            label: "View Recycle Bin",
            onClick: () => router.push("/admin/recycle-bin"),
          },
        },
      );
      clearSelection();
    } catch (error) {
      toast.error("Failed to mark for deletion");
      console.error(error);
    }
  };

  return {
    selectedCount,
    selectedIds,
    shouldShowBulkActions,
    getSelectedSongs,
    handlePlay,
    handleShuffle,
    handlePlayNext,
    handleAddToQueue,
    handleStar,
    handleUnstar,
    handleExcludeFromShuffle,
    handleIncludeInShuffle,
    handleDisable,
    handleEnable,
    handleMarkForEditing,
    confirmDeletionOpen,
    setConfirmDeletionOpen,
    handleConfirmDeletion,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
  };
}

// ===================================
// Bulk song menu content component
// ===================================

interface BulkSongMenuContentProps {
  components: MenuComponents;
  selectedCount: number;
  handlers: {
    handlePlay: () => void;
    handleShuffle: () => void;
    handlePlayNext: () => void;
    handleAddToQueue: () => void;
    handleStar: () => void;
    handleUnstar: () => void;
    handleExcludeFromShuffle: () => void;
    handleIncludeInShuffle: () => void;
    handleDisable: () => void;
    handleEnable: () => void;
    handleMarkForEditing: () => void;
    setConfirmDeletionOpen: (open: boolean) => void;
    setAddToPlaylistOpen: (open: boolean) => void;
  };
}

function BulkSongMenuContent({
  components,
  selectedCount,
  handlers,
}: BulkSongMenuContentProps) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = components;

  return (
    <>
      {/* Header showing selection count */}
      <div className="px-2 py-1.5 text-sm font-medium text-muted-foreground border-b border-border mb-1">
        {selectedCount} songs selected
      </div>

      {/* Playback actions */}
      <Item onClick={handlers.handlePlay}>
        <Play className="w-4 h-4 mr-2" />
        Play All
      </Item>
      <Item onClick={handlers.handleShuffle}>
        <Shuffle className="w-4 h-4 mr-2" />
        Shuffle All
      </Item>
      <Separator />

      {/* Queue actions */}
      <Item onClick={handlers.handlePlayNext}>
        <ListPlus className="w-4 h-4 mr-2" />
        Play Next
      </Item>
      <Item onClick={handlers.handleAddToQueue}>
        <ListEnd className="w-4 h-4 mr-2" />
        Add to Queue
      </Item>
      <Item onClick={() => handlers.setAddToPlaylistOpen(true)}>
        <FolderPlus className="w-4 h-4 mr-2" />
        Add to Playlist
      </Item>
      <Separator />

      {/* Starring actions */}
      <Item onClick={handlers.handleStar}>
        <Heart className="w-4 h-4 mr-2" />
        Add All to Favorites
      </Item>
      <Item onClick={handlers.handleUnstar}>
        <HeartOff className="w-4 h-4 mr-2" />
        Remove All from Favorites
      </Item>

      {/* Track Options submenu */}
      {Sub && SubTrigger && SubContent && (
        <>
          <Separator />
          <Sub>
            <SubTrigger>
              <Settings className="w-4 h-4 mr-2" />
              Track Options
            </SubTrigger>
            <SubContent>
              <Item onClick={handlers.handleExcludeFromShuffle}>
                <Shuffle className="w-4 h-4 mr-2 text-muted-foreground line-through" />
                Exclude from Shuffle
              </Item>
              <Item onClick={handlers.handleIncludeInShuffle}>
                <Shuffle className="w-4 h-4 mr-2" />
                Include in Shuffle
              </Item>
              <Separator />
              <Item onClick={handlers.handleDisable}>
                <Ban className="w-4 h-4 mr-2 text-muted-foreground" />
                Disable Tracks
              </Item>
              <Item onClick={handlers.handleEnable}>
                <Ban className="w-4 h-4 mr-2" />
                Enable Tracks
              </Item>
            </SubContent>
          </Sub>
        </>
      )}
      <Separator />

      {/* Editing actions (grouped together) */}
      <Item onClick={handlers.handleMarkForEditing}>
        <Pen className="w-4 h-4 mr-2" />
        Mark for Editing
      </Item>
      <Item
        onClick={() => handlers.setConfirmDeletionOpen(true)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Mark for Deletion
      </Item>
    </>
  );
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
  /** Padding from viewport edges for collision detection. Use larger bottom value for elements near screen bottom. */
  collisionPadding?:
    | number
    | { top?: number; right?: number; bottom?: number; left?: number };
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
  collisionPadding,
}: SongContextMenuProps) {
  // Single song actions
  const {
    isStarred,
    toggleStar,
    isExcludedFromShuffle,
    handleToggleShuffleExclude,
    isDisabled,
    handleToggleDisabled,
    currentRating,
    handleRate,
    handlePlay,
    handlePlayNext,
    handleAddToQueue,
    handleDownload,
    confirmDeletionOpen,
    setConfirmDeletionOpen,
    handleConfirmDeletion,
    addToPlaylistOpen: singleAddToPlaylistOpen,
    setAddToPlaylistOpen: setSingleAddToPlaylistOpen,
    detailsOpen,
    setDetailsOpen,
  } = useSongActions({ song, queueSongs, songIndex, queueSource });

  const handleMarkForEditing = useMarkForEditing(song);

  async function handleRescan() {
    const client = getClient();
    if (!client) return;
    try {
      await client.rescanFiles([song.id]);
      toast.success("Song rescanned");
    } catch {
      toast.error("Failed to rescan song");
    }
  }

  // Bulk actions - use queueSongs for finding selected songs
  const bulkActions = useBulkSongActions(queueSongs ?? [song]);

  // Determine if we should show bulk actions
  const showBulkMenu = bulkActions.shouldShowBulkActions(song.id);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          onDoubleClick={(e) => e.stopPropagation()}
          collisionPadding={collisionPadding}
        >
          {showBulkMenu ? (
            <BulkSongMenuContent
              components={contextMenuComponents}
              selectedCount={bulkActions.selectedCount}
              handlers={{
                handlePlay: bulkActions.handlePlay,
                handleShuffle: bulkActions.handleShuffle,
                handlePlayNext: bulkActions.handlePlayNext,
                handleAddToQueue: bulkActions.handleAddToQueue,
                handleStar: bulkActions.handleStar,
                handleUnstar: bulkActions.handleUnstar,
                handleExcludeFromShuffle: bulkActions.handleExcludeFromShuffle,
                handleIncludeInShuffle: bulkActions.handleIncludeInShuffle,
                handleDisable: bulkActions.handleDisable,
                handleEnable: bulkActions.handleEnable,
                handleMarkForEditing: bulkActions.handleMarkForEditing,
                setConfirmDeletionOpen: bulkActions.setConfirmDeletionOpen,
                setAddToPlaylistOpen: bulkActions.setAddToPlaylistOpen,
              }}
            />
          ) : (
            <>
              <SongMenuItemsQueue
                components={contextMenuComponents}
                handlers={{
                  handlePlay,
                  handlePlayNext,
                  handleAddToQueue,
                  setAddToPlaylistOpen: setSingleAddToPlaylistOpen,
                }}
                options={{
                  hideQueueActions,
                  showRemoveFromQueue,
                  onRemoveFromQueue,
                  showRemoveFromPlaylist,
                  onRemoveFromPlaylist: onRemoveFromPlaylist
                    ? () => onRemoveFromPlaylist(song.id)
                    : undefined,
                  showMoveToPosition:
                    showMoveToPosition && songIndex !== undefined,
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
                  handleToggleDisabled,
                  handleRate,
                }}
                state={{
                  isStarred,
                  isExcludedFromShuffle,
                  isDisabled,
                  currentRating,
                }}
              />
              <SongMenuItemsNavigation
                components={contextMenuComponents}
                handlers={{
                  handleDownload,
                  handleMarkForEditing,
                  handleRescan,
                  setDetailsOpen,
                  setConfirmDeletionOpen,
                }}
                song={{
                  artistId: song.artistId,
                  albumId: song.albumId,
                }}
              />
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Dialogs for single song actions */}
      <SongDialogs
        song={song}
        addToPlaylistOpen={singleAddToPlaylistOpen}
        setAddToPlaylistOpen={setSingleAddToPlaylistOpen}
        detailsOpen={detailsOpen}
        setDetailsOpen={setDetailsOpen}
        confirmDeletionOpen={confirmDeletionOpen}
        setConfirmDeletionOpen={setConfirmDeletionOpen}
        handleConfirmDeletion={handleConfirmDeletion}
      />

      {/* Dialog for bulk add to playlist */}
      <AddToPlaylistDialog
        open={bulkActions.addToPlaylistOpen}
        onOpenChange={bulkActions.setAddToPlaylistOpen}
        songs={
          bulkActions.addToPlaylistOpen ? bulkActions.getSelectedSongs() : []
        }
        songIds={
          bulkActions.addToPlaylistOpen ? bulkActions.selectedIds : undefined
        }
      />

      {/* Dialog for bulk deletion confirmation */}
      <AlertDialog
        open={bulkActions.confirmDeletionOpen}
        onOpenChange={bulkActions.setConfirmDeletionOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark {bulkActions.selectedCount} Songs for Deletion?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected songs will be moved to the recycle bin and
              permanently deleted after 30 days. This action can be undone from
              the Administration page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkActions.handleConfirmDeletion}
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
    isDisabled,
    handleToggleDisabled,
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

  async function handleRescan() {
    const client = getClient();
    if (!client) return;
    try {
      await client.rescanFiles([song.id]);
      toast.success("Song rescanned");
    } catch {
      toast.error("Failed to rescan song");
    }
  }

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
              handleToggleDisabled,
              handleRate,
            }}
            state={{
              isStarred,
              isExcludedFromShuffle,
              isDisabled,
              currentRating,
            }}
          />
          <SongMenuItemsNavigation
            components={dropdownMenuComponents}
            handlers={{
              handleDownload,
              handleMarkForEditing,
              handleRescan,
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
