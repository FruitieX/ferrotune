"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  ListMusic,
  AlertCircle,
  RefreshCw,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { usePlaylistSparsePagination } from "@/lib/hooks/use-playlist-sparse-pagination";
import {
  playlistViewModeAtom,
  playlistSortAtom,
  playlistColumnVisibilityAtom,
} from "@/lib/store/ui";
import {
  startQueueAtom,
  serverQueueStateAtom,
  toggleShuffleAtom,
} from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { usePlaylistCoverUrl } from "@/components/shared/playlist-cover";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import {
  SongListToolbar,
  SongListMobileMenu,
  MobileFilterInput,
} from "@/components/shared/song-list-toolbar";
import { SongListHeader } from "@/components/shared/song-list-header";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import {
  SongRow,
  SongRowSkeleton,
  SongCard,
  SongCardSkeleton,
} from "@/components/browse/song-row";
import { MoveToPositionDialog } from "@/components/shared/move-to-position-dialog";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { EditPlaylistDialog } from "@/components/playlists/edit-playlist-dialog";
import {
  MissingEntryRow,
  MissingEntryCard,
} from "@/components/playlists/missing-entry-row";
import { RefineMatchDialog } from "@/components/playlists/refine-match-dialog";
import { MassResolveDialog } from "@/components/playlists/mass-resolve-dialog";
import { AddSongToPlaylistDialog } from "@/components/playlists/add-song-dialog";
import {
  PlaylistBreadcrumb,
  getPlaylistDisplayName,
} from "@/components/shared/playlist-breadcrumb";
import {
  formatCount,
  formatDate,
  formatTotalDuration,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import type { PlaylistSongEntry } from "@/lib/api/generated/PlaylistSongEntry";
import type { MissingEntryDataResponse } from "@/lib/api/generated/MissingEntryDataResponse";

const PAGE_SIZE = 50;

// Display item types for rendering
type DisplayItem =
  | {
      type: "song";
      song: Song;
      position: number;
      entryId: string;
      songIndex?: number;
      missing?: MissingEntryDataResponse | null;
      addedToPlaylist?: string | null;
    }
  | {
      type: "missing";
      entry: PlaylistSongEntry;
      position: number;
      entryId: string;
    };

function PlaylistDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const playlistId = searchParams.get("id");

  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const startQueue = useSetAtom(startQueueAtom);
  const toggleShuffle = useSetAtom(toggleShuffleAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [removeTracksDialogOpen, setRemoveTracksDialogOpen] = useState(false);
  const [removeSingleSongDialogOpen, setRemoveSingleSongDialogOpen] =
    useState(false);
  const [pendingSingleRemove, setPendingSingleRemove] = useState<{
    songId: string;
    songTitle: string;
    entryId: string;
    position: number;
  } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addSongDialogOpen, setAddSongDialogOpen] = useState(false);
  const [massResolveDialogOpen, setMassResolveDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogItem, setMoveDialogItem] = useState<{
    name: string;
    entryId: string;
    position: number;
  } | null>(null);
  const [refineMatchDialogOpen, setRefineMatchDialogOpen] = useState(false);
  const [refineMatchItem, setRefineMatchItem] = useState<{
    entryId: string;
    position: number;
    missing: MissingEntryDataResponse;
  } | null>(null);
  const [unmatchDialogOpen, setUnmatchDialogOpen] = useState(false);
  const [pendingUnmatch, setPendingUnmatch] = useState<{
    songTitle: string;
    entryId: string;
    position: number;
  } | null>(null);
  const [filter, setFilter] = useState("");
  // Track selected missing entry IDs separately (format: "missing-{entryId}")
  const [selectedMissingIds, setSelectedMissingIds] = useState<Set<string>>(
    new Set(),
  );
  // Track anchor position for shift-selection across all items (songs + missing)
  const [selectionAnchorPosition, setSelectionAnchorPosition] = useState<
    number | null
  >(null);
  const debouncedFilter = useDebounce(filter, 300);
  const isMounted = useIsMounted();

  // View settings
  const [viewMode, setViewMode] = useAtom(playlistViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(playlistSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(
    playlistColumnVisibilityAtom,
  );

  // Redirect to playlists if no ID
  useEffect(() => {
    if (!playlistId && isMounted && !authLoading) {
      router.replace("/playlists");
    }
  }, [playlistId, isMounted, authLoading, router]);

  // Fetch playlist songs with sparse pagination
  const {
    entries: allEntries,
    metadata: playlist,
    isLoading,
    ensureRange,
    reset: resetPlaylistData,
  } = usePlaylistSparsePagination({
    queryKey: [
      "playlistSongs",
      playlistId,
      sortConfig.field,
      sortConfig.direction,
      debouncedFilter,
      viewMode,
    ],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistSongs(playlistId!, {
        offset,
        count: PAGE_SIZE,
        sort: sortConfig.field,
        sortDir: sortConfig.direction,
        filter: debouncedFilter.trim() || undefined,
        inlineImages: viewMode === "grid" ? "medium" : "small",
      });
    },
    enabled: isReady && !!playlistId,
  });

  // Convert entries to display items, including the server-provided songIndex
  // Keep undefined slots for sparse pagination - VirtualizedGrid/List will render skeletons
  const displayItems: (DisplayItem | undefined)[] = allEntries.map((entry) => {
    if (entry === undefined) {
      return undefined;
    }
    if (entry.entryType === "song" && entry.song) {
      return {
        type: "song" as const,
        song: entry.song as Song,
        position: entry.position,
        entryId: entry.entryId,
        songIndex: entry.songIndex ?? undefined,
        missing: entry.missing,
        addedToPlaylist: entry.addedToPlaylist,
      };
    } else {
      return {
        type: "missing" as const,
        entry,
        position: entry.position,
        entryId: entry.entryId,
      };
    }
  });

  // Loaded display items for operations (filtered, without undefined slots)
  const loadedDisplayItems: DisplayItem[] = displayItems.filter(
    (item): item is DisplayItem => item !== undefined,
  );

  // Extract just the songs for selection tracking (filter out undefined and missing)
  const displaySongs: Song[] = loadedDisplayItems
    .filter(
      (item): item is Extract<DisplayItem, { type: "song" }> =>
        item.type === "song",
    )
    .map((item) => item.song);

  // Check if there are missing entries
  const hasMissingEntries = (playlist?.missingCount ?? 0) > 0;
  const missingEntryCount = playlist?.missingCount ?? 0;
  const totalEntries = playlist?.totalEntries ?? 0;
  const filteredCount = playlist?.filteredCount ?? displayItems.length;
  const totalDuration = playlist?.duration ?? 0;

  // Get the cover URL
  const coverUrl = usePlaylistCoverUrl(
    playlist?.id ?? null,
    400,
    playlist?.coverArt,
  );

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.deletePlaylist(playlistId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Playlist deleted");
      router.push("/playlists");
    },
    onError: () => {
      toast.error("Failed to delete playlist");
    },
  });

  // Reorder mutation (kept for potential future use)
  const _reorderMutation = useMutation({
    mutationFn: async (songIds: string[]) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.reorderPlaylistSongs(playlistId!, songIds);
    },
    onSuccess: () => {
      // Invalidate to ensure we have the correct order from server
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      toast.success("Playlist order updated");
    },
    onError: () => {
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      toast.error("Failed to update playlist order");
    },
  });

  // Add songs back mutation (for undo)
  const addSongsBackMutation = useMutation({
    mutationFn: async (songIds: string[]) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.updatePlaylist({
        playlistId: playlistId!,
        songIdToAdd: songIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Songs restored to playlist");
    },
    onError: () => {
      toast.error("Failed to restore songs");
    },
  });

  // Remove songs mutation
  const removeSongsMutation = useMutation({
    mutationFn: async ({
      indices,
      songIds,
    }: {
      indices: number[];
      songIds: string[];
    }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.updatePlaylist({
        playlistId: playlistId!,
        songIndexToRemove: indices,
      });
      return songIds; // Return for undo
    },
    onSuccess: async (songIds) => {
      await queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
      const count = songIds.length;
      toast.success(
        count === 1
          ? "Song removed from playlist"
          : `${count} songs removed from playlist`,
        {
          action: {
            label: "Undo",
            onClick: () => {
              addSongsBackMutation.mutate(songIds);
            },
          },
          duration: 8000, // Give user more time to undo
        },
      );
    },
    onError: () => {
      toast.error("Failed to remove songs from playlist");
    },
  });

  // Helper to remove a single song by its position (for context menu)
  // Shows confirmation dialog instead of direct removal
  const handleRemoveSingleSong = (songId: string) => {
    // Find the position of the song in the display items
    const item = loadedDisplayItems.find(
      (item) => item.type === "song" && item.song.id === songId,
    );
    if (!item || item.type !== "song") return;
    setPendingSingleRemove({
      songId,
      songTitle: item.song.title,
      entryId: item.entryId,
      position: item.position,
    });
    setRemoveSingleSongDialogOpen(true);
  };

  // Confirm single song removal
  const confirmRemoveSingleSong = () => {
    if (pendingSingleRemove) {
      removeSongsMutation.mutate({
        indices: [pendingSingleRemove.position],
        songIds: [pendingSingleRemove.songId],
      });
    }
    setRemoveSingleSongDialogOpen(false);
    setPendingSingleRemove(null);
  };

  // Helper to remove a missing entry by entryId (no undo since we can't add it back)
  // Note: OpenSubsonic API uses position-based indices, so we look up the position
  const handleRemoveMissingEntry = async (entryId: string) => {
    const item = loadedDisplayItems.find((i) => i.entryId === entryId);
    if (!item) return;

    const client = getClient();
    if (!client) return;
    try {
      await client.updatePlaylist({
        playlistId: playlistId!,
        songIndexToRemove: [item.position],
      });
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      toast.success("Entry removed from playlist");
    } catch {
      toast.error("Failed to remove entry from playlist");
    }
  };

  // Handle move to position for playlists (works for both songs and missing entries)
  const handleMoveToPosition = (item: {
    name: string;
    entryId: string;
    position: number;
  }) => {
    setMoveDialogItem(item);
    setMoveDialogOpen(true);
  };

  // Wrapper for song move to position (adapts Song to the generic interface)
  const handleSongMoveToPosition = (song: Song, currentIndex: number) => {
    const item = loadedDisplayItems.find(
      (i) =>
        i.type === "song" &&
        i.song.id === song.id &&
        i.position === currentIndex,
    );
    if (!item) return;
    handleMoveToPosition({
      name: song.title,
      entryId: item.entryId,
      position: currentIndex,
    });
  };

  // Handler for missing entry move to position
  const handleMissingMoveToPosition = (name: string, entryId: string) => {
    const item = loadedDisplayItems.find((i) => i.entryId === entryId);
    if (!item) return;
    handleMoveToPosition({ name, entryId, position: item.position });
  };

  // Handler for refine match (for songs that have associated missing data)
  const handleRefineMatch = (song: Song, index: number) => {
    // Find the display item to get the missing data
    const item = loadedDisplayItems.find(
      (i) => i.type === "song" && i.song.id === song.id && i.position === index,
    );
    if (!item || item.type !== "song" || !item.missing) return;

    setRefineMatchItem({
      entryId: item.entryId,
      position: index,
      missing: item.missing,
    });
    setRefineMatchDialogOpen(true);
  };

  // Handler for unmatch (revert a matched song back to missing)
  // Shows confirmation dialog instead of immediate action
  const handleUnmatch = (song: Song, index: number) => {
    const item = loadedDisplayItems.find(
      (i) => i.type === "song" && i.song.id === song.id && i.position === index,
    );
    if (!item) return;
    setPendingUnmatch({
      songTitle: song.title,
      entryId: item.entryId,
      position: index,
    });
    setUnmatchDialogOpen(true);
  };

  // Confirm unmatch action
  const confirmUnmatch = async () => {
    if (!pendingUnmatch) return;

    const client = getClient();
    if (!client || !playlistId) return;

    try {
      await client.unmatchEntry(playlistId, pendingUnmatch.entryId);
      // Reset the sparse pagination cache to refetch data
      resetPlaylistData();
      await queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      toast.success("Song unmatched");
    } catch (error) {
      console.error("Failed to unmatch entry:", error);
      toast.error("Failed to unmatch entry");
    }
    setUnmatchDialogOpen(false);
    setPendingUnmatch(null);
  };

  const handleMoveItem = async (newPosition: number) => {
    if (!moveDialogItem) return;

    const { entryId, position: oldPosition } = moveDialogItem;
    if (oldPosition === newPosition) return;

    // Use the server-side move endpoint
    const client = getClient();
    if (!client) return;

    try {
      await client.movePlaylistEntry(playlistId!, entryId, newPosition);
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      toast.success("Entry moved");
    } catch (error) {
      toast.error("Failed to move entry");
      console.error(error);
    }
  };

  // Queue source for playlist - server materializes with same sort/filter
  const playlistQueueSource = {
    type: "playlist" as const,
    id: playlistId,
    name: playlist?.name ?? "Playlist",
    filters: debouncedFilter.trim()
      ? { filter: debouncedFilter.trim() }
      : undefined,
    sort:
      sortConfig.field !== "custom"
        ? {
            field: sortConfig.field,
            direction: sortConfig.direction,
          }
        : undefined,
  };

  // Check if a song at a given playlist position is the currently playing track
  // Uses the server-provided songIndex which maps directly to queue indices
  // Returns undefined if we can't determine (falls back to song ID matching in SongRow)
  const isCurrentQueuePosition = (
    songIndex: number | undefined,
    _songId: string,
  ): boolean | undefined => {
    if (!queueState || songIndex === undefined) return undefined;

    // Check if the queue source is this playlist
    const isPlaylistQueue =
      queueState.source?.type === "playlist" &&
      queueState.source?.id === playlistId;

    if (isPlaylistQueue) {
      // When queue is shuffled, positions don't match the display order
      // Fall back to song ID matching in SongRow
      if (queueState.isShuffled) return undefined;

      // Check if the current view's filter/sort matches what was used to create the queue
      // If they don't match, the display order differs from the queue order
      const queueFilters = queueState.source?.filters;
      const queueSort = queueState.source?.sort;

      // Compare filters (normalize undefined vs empty object)
      const currentFilter = debouncedFilter.trim() || undefined;
      const queueFilter = queueFilters?.filter as string | undefined;
      const filtersMatch = currentFilter === queueFilter;

      // Compare sort (only if not in custom order)
      const currentSort =
        sortConfig.field !== "custom"
          ? { field: sortConfig.field, direction: sortConfig.direction }
          : undefined;
      const sortMatch =
        (currentSort === undefined &&
          (queueSort === undefined || queueSort === null)) ||
        (currentSort !== undefined &&
          queueSort !== undefined &&
          queueSort !== null &&
          currentSort.field === queueSort.field &&
          currentSort.direction === queueSort.direction);

      // If filter/sort don't match, display order differs from queue order
      // Fall back to song ID matching
      if (!filtersMatch || !sortMatch) return undefined;

      // Check if position matches
      const positionMatches = queueState.currentIndex === songIndex;
      if (positionMatches) {
        // Position matches - this is the current track
        return true;
      }
      // Position doesn't match - this is not the current track
      // Since we've verified filter/sort match, we can be confident about this
      return false;
    }

    // For other sources, we can't reliably determine position
    // Return undefined to let SongRow fall back to song ID matching
    return undefined;
  };

  // Determine if we should use position-based highlighting
  const isPlaylistInQueue =
    queueState?.source?.type === "playlist" &&
    queueState?.source?.id === playlistId;

  // Get the display name (last part of the path) using shared utility
  const displayName = getPlaylistDisplayName(playlist?.name);

  // Clear missing entries selection
  const clearMissingSelection = () => {
    setSelectedMissingIds(new Set());
    setSelectionAnchorPosition(null);
  };

  // Track selection
  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedSongs,
    addSelectedToQueue,
    starSelected,
  } = useTrackSelection(displaySongs, { onClear: clearMissingSelection });

  // Get indices of selected songs in the original order (for removal)
  const getSelectedIndices = () => {
    const selected = getSelectedSongs();
    const selectedIds = new Set(selected.map((s) => s.id));
    const indices: number[] = [];
    loadedDisplayItems.forEach((item) => {
      if (item.type === "song" && selectedIds.has(item.song.id)) {
        indices.push(item.position);
      }
    });
    return indices;
  };

  // Get all selected indices including missing entries
  const getAllSelectedIndices = () => {
    const songIndices = getSelectedIndices();
    const missingIndices: number[] = [];
    selectedMissingIds.forEach((id) => {
      // Extract position from "missing-{position}" format
      const match = id.match(/^missing-(\d+)$/);
      if (match) {
        missingIndices.push(parseInt(match[1], 10));
      }
    });
    // Combine and sort in descending order (remove from end first to preserve indices)
    return [...songIndices, ...missingIndices].sort((a, b) => b - a);
  };

  const handleRemoveSelected = () => {
    const indices = getAllSelectedIndices();
    if (indices.length > 0) {
      setRemoveTracksDialogOpen(true);
    }
  };

  // Unified selection handler for both songs and missing entries with shift-click support
  const handleUnifiedSelect = (
    itemId: string,
    position: number,
    isMissing: boolean,
    event?: React.MouseEvent,
  ) => {
    const shiftKey = event?.shiftKey ?? false;

    if (shiftKey && selectionAnchorPosition !== null) {
      // Range selection: select all items between anchor and current position
      const start = Math.min(selectionAnchorPosition, position);
      const end = Math.max(selectionAnchorPosition, position);

      const newMissingIds = new Set(selectedMissingIds);

      loadedDisplayItems.forEach((item) => {
        if (item.position >= start && item.position <= end) {
          if (item.type === "missing") {
            newMissingIds.add(`missing-${item.position}`);
          } else {
            // For songs, we use the handleSelect from useTrackSelection
            // but we need to add them without shift since we're handling range ourselves
            handleSelect(item.song.id);
          }
        }
      });

      setSelectedMissingIds(newMissingIds);
      // Don't update anchor on shift-click to allow extending selection
    } else {
      // Normal selection - toggle the item
      if (isMissing) {
        setSelectedMissingIds((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) {
            next.delete(itemId);
          } else {
            next.add(itemId);
          }
          return next;
        });
      } else {
        handleSelect(itemId, event);
      }
      // Update anchor position
      setSelectionAnchorPosition(position);
    }
  };

  // Missing entry selection handler (wrapper for unified handler)
  const handleMissingSelect = (
    id: string,
    selected: boolean,
    event?: React.MouseEvent,
  ) => {
    // Extract position from "missing-{position}" format
    const match = id.match(/^missing-(\d+)$/);
    if (match) {
      const position = parseInt(match[1], 10);
      handleUnifiedSelect(id, position, true, event);
    }
  };

  // Song selection handler (wrapper for unified handler with position tracking)
  const handleSongSelect = (id: string, event?: React.MouseEvent) => {
    const item = loadedDisplayItems.find(
      (i) => i.type === "song" && i.song.id === id,
    );
    if (item) {
      handleUnifiedSelect(id, item.position, false, event);
    } else {
      // Fallback to original handler if item not found
      handleSelect(id, event);
    }
  };

  const isMissingSelected = (id: string) => {
    return selectedMissingIds.has(id);
  };

  // Clear all selection (songs + missing)
  const clearAllSelection = () => {
    clearSelection();
    setSelectedMissingIds(new Set());
    setSelectionAnchorPosition(null);
  };

  // Select all items (songs + missing entries)
  const selectAllItems = () => {
    // Select all songs
    selectAll();
    // Select all missing entries
    const allMissingIds = new Set<string>();
    loadedDisplayItems.forEach((item) => {
      if (item.type === "missing") {
        allMissingIds.add(`missing-${item.position}`);
      }
    });
    setSelectedMissingIds(allMissingIds);
  };

  // Total selection count
  const totalSelectedCount = selectedCount + selectedMissingIds.size;
  const hasMissingInSelection = selectedMissingIds.size > 0;

  const confirmRemoveSelected = () => {
    const indices = getAllSelectedIndices();
    const songIds = getSelectedSongs().map((s) => s.id);
    if (indices.length > 0) {
      removeSongsMutation.mutate({ indices, songIds });
      clearAllSelection();
    }
    setRemoveTracksDialogOpen(false);
  };

  const handlePlaySelected = () => {
    const selected = getSelectedSongs();
    if (selected.length > 0) {
      startQueue({
        sourceType: "playlist",
        sourceId: playlistId ?? undefined,
        sourceName: displayName,
        songIds: selected.map((s) => s.id),
      });
      clearAllSelection();
    }
  };

  const handlePlayAll = () => {
    if (displaySongs.length > 0) {
      // If currently shuffled, turn off shuffle first
      if (queueState?.isShuffled) {
        toggleShuffle();
      }
      startQueue({
        sourceType: "playlist",
        sourceId: playlistId ?? undefined,
        sourceName: displayName,
        filters: debouncedFilter.trim()
          ? { filter: debouncedFilter.trim() }
          : undefined,
        sort:
          sortConfig.field !== "custom"
            ? {
                field: sortConfig.field,
                direction: sortConfig.direction,
              }
            : undefined,
      });
    }
  };

  const handleShuffle = () => {
    if (displaySongs.length > 0) {
      startQueue({
        sourceType: "playlist",
        sourceId: playlistId ?? undefined,
        sourceName: displayName,
        shuffle: true,
        filters: debouncedFilter.trim()
          ? { filter: debouncedFilter.trim() }
          : undefined,
        sort:
          sortConfig.field !== "custom"
            ? {
                field: sortConfig.field,
                direction: sortConfig.direction,
              }
            : undefined,
      });
    }
  };

  // Loading state
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-dvh">
        <DetailHeader
          showBackButton
          icon={ListMusic}
          iconClassName="bg-linear-to-br from-emerald-500 to-emerald-800"
          coverSize="lg"
          gradientColor="rgba(16,185,129,0.2)"
          label="Playlist"
          title=""
          isLoading
        />

        {/* Action bar skeleton */}
        <div className="px-4 lg:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 border-b border-border">
          {/* Play/Shuffle buttons */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-12 w-12 rounded-full" />
          </div>

          <div className="flex-1" />

          {/* Toolbar with dropdown */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-10 rounded-md" />
            <Skeleton className="h-10 w-64" />
          </div>
        </div>

        {/* Content skeleton */}
        <div className="px-4 lg:px-6 py-4">
          <div className="space-y-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <SongRowSkeleton key={i} showCover showIndex />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!playlistId) {
    return null;
  }

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <DetailHeader
        showBackButton
        coverUrl={coverUrl}
        coverAlt={displayName}
        icon={ListMusic}
        iconClassName="bg-linear-to-br from-emerald-500 to-emerald-800"
        coverSize="lg"
        useBlurredBackground={!!coverUrl}
        gradientColor="rgba(16,185,129,0.2)"
        label="Playlist"
        title={displayName}
        isLoading={isLoading}
        subtitle={playlist?.comment ?? undefined}
        metadata={
          playlist && (
            <span className="flex flex-wrap items-center gap-2">
              {playlist.owner && (
                <>
                  <span className="font-medium text-foreground">
                    {playlist.owner}
                  </span>
                  <span>•</span>
                </>
              )}
              <span>{formatCount(playlist.matchedCount, "song")}</span>
              {hasMissingEntries && (
                <>
                  <span>•</span>
                  <Badge
                    variant="secondary"
                    className="bg-orange-500/20 text-orange-500 h-5 cursor-pointer hover:bg-orange-500/30 transition-colors"
                    onClick={() => setMassResolveDialogOpen(true)}
                  >
                    <AlertCircle className="w-3 h-3 mr-1" />
                    {missingEntryCount} not found
                  </Badge>
                </>
              )}
              <span>•</span>
              <span>{formatTotalDuration(totalDuration)}</span>
              {playlist.created && (
                <>
                  <span>•</span>
                  <span>Created {formatDate(playlist.created)}</span>
                </>
              )}
            </span>
          )
        }
      />

      {/* Breadcrumb navigation (only if playlist is in a folder) */}
      {/* Breadcrumb navigation (only if playlist is in a folder) */}
      <PlaylistBreadcrumb playlistName={playlist?.name} />

      {/* Action bar */}
      <ActionBar
        onPlayAll={handlePlayAll}
        onShuffle={handleShuffle}
        disablePlay={isLoading || displaySongs.length === 0}
        showShuffleOnMobile
        toolbar={
          <SongListToolbar
            filter={filter}
            onFilterChange={setFilter}
            filterPlaceholder="Filter playlist..."
            sortConfig={sortConfig}
            onSortChange={setSortConfig}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showCustomSort
            showAddedToPlaylist
          />
        }
        mobileFilter={
          <MobileFilterInput
            filter={filter}
            onFilterChange={setFilter}
            placeholder="Filter playlist..."
          />
        }
        mobileMenuContent={
          <SongListMobileMenu
            onEditPlaylist={() => setEditDialogOpen(true)}
            onAddSong={() => setAddSongDialogOpen(true)}
            onResolveMissing={() => setMassResolveDialogOpen(true)}
            showResolveMissing={hasMissingEntries}
            onDeletePlaylist={() => setDeleteDialogOpen(true)}
            sortConfig={sortConfig}
            onSortChange={setSortConfig}
            showCustomSort
            showAddedToPlaylist
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
          />
        }
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit Playlist
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAddSongDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Song
            </DropdownMenuItem>
            {hasMissingEntries && (
              <DropdownMenuItem onClick={() => setMassResolveDialogOpen(true)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Resolve Missing Entries
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Playlist
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ActionBar>

      {/* Track list */}
      <div className={cn("px-4 lg:px-6 py-4", hasSelection && "select-none")}>
        {isLoading ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <SongCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <SongRowSkeleton key={i} showCover showIndex />
              ))}
            </div>
          )
        ) : filteredCount > 0 || displayItems.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={displayItems}
              totalCount={filteredCount}
              renderItem={(item, _index) => {
                if (item.type === "missing") {
                  const missingId = `missing-${item.entryId}`;
                  // If the entry has song data (from disabled library), extract it
                  const songData = item.entry.song
                    ? {
                        title: item.entry.song.title,
                        artist: item.entry.song.artist,
                        album: item.entry.song.album,
                      }
                    : null;
                  return (
                    <MissingEntryCard
                      playlistId={playlistId!}
                      entryId={item.entryId}
                      position={item.position}
                      missing={item.entry.missing}
                      song={songData}
                      entryType={
                        item.entry.entryType === "notFound"
                          ? "notFound"
                          : "missing"
                      }
                      isSelected={isMissingSelected(missingId)}
                      isSelectionMode={totalSelectedCount > 0}
                      onSelect={handleMissingSelect}
                      onRemove={handleRemoveMissingEntry}
                      showMoveToPosition={sortConfig.field === "custom"}
                      onMoveToPosition={handleMissingMoveToPosition}
                    />
                  );
                }
                // Song item
                const songItem = item as Extract<typeof item, { type: "song" }>;
                return (
                  <SongCard
                    song={songItem.song}
                    index={songItem.position}
                    queueSource={playlistQueueSource}
                    isSelected={isSelected(songItem.song.id)}
                    isSelectionMode={totalSelectedCount > 0}
                    onSelect={handleSongSelect}
                    isCurrentQueuePosition={
                      isPlaylistInQueue
                        ? isCurrentQueuePosition(
                            songItem.songIndex,
                            songItem.song.id,
                          )
                        : undefined
                    }
                    showMoveToPosition={sortConfig.field === "custom"}
                    onMoveToPosition={handleSongMoveToPosition}
                    showRefineMatch={!!songItem.missing}
                    onRefineMatch={handleRefineMatch}
                    showUnmatch={!!songItem.missing}
                    onUnmatch={handleUnmatch}
                  />
                );
              }}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(item, _index) =>
                item.type === "song"
                  ? `${item.position}-${item.song.id}`
                  : `missing-${item.position}`
              }
              ensureRange={ensureRange}
            />
          ) : (
            <>
              <SongListHeader
                columnVisibility={columnVisibility}
                showIndex
                showCover
              />
              <VirtualizedList
                items={displayItems}
                totalCount={filteredCount}
                renderItem={(item, _index) => {
                  if (item.type === "missing") {
                    const missingId = `missing-${item.entryId}`;
                    // If the entry has song data (from disabled library), extract it
                    const songData = item.entry.song
                      ? {
                          title: item.entry.song.title,
                          artist: item.entry.song.artist,
                          album: item.entry.song.album,
                        }
                      : null;
                    return (
                      <MissingEntryRow
                        playlistId={playlistId!}
                        entryId={item.entryId}
                        position={item.position}
                        missing={item.entry.missing}
                        song={songData}
                        entryType={
                          item.entry.entryType === "notFound"
                            ? "notFound"
                            : "missing"
                        }
                        isSelected={isMissingSelected(missingId)}
                        isSelectionMode={totalSelectedCount > 0}
                        onSelect={handleMissingSelect}
                        onRemove={handleRemoveMissingEntry}
                        showMoveToPosition={sortConfig.field === "custom"}
                        onMoveToPosition={handleMissingMoveToPosition}
                      />
                    );
                  }
                  // Song item
                  const songItem = item as Extract<
                    typeof item,
                    { type: "song" }
                  >;
                  return (
                    <SongRow
                      song={songItem.song}
                      index={songItem.position}
                      showCover
                      showArtist={columnVisibility.artist}
                      showAlbum={columnVisibility.album}
                      showDuration={columnVisibility.duration}
                      showPlayCount={columnVisibility.playCount}
                      showYear={columnVisibility.year}
                      showDateAdded={columnVisibility.dateAdded}
                      dateAddedOverride={songItem.addedToPlaylist}
                      showLastPlayed={columnVisibility.lastPlayed}
                      queueSource={playlistQueueSource}
                      isSelected={isSelected(songItem.song.id)}
                      isSelectionMode={totalSelectedCount > 0}
                      onSelect={handleSongSelect}
                      showRemoveFromPlaylist
                      onRemoveFromPlaylist={handleRemoveSingleSong}
                      isCurrentQueuePosition={
                        isPlaylistInQueue
                          ? isCurrentQueuePosition(
                              songItem.songIndex,
                              songItem.song.id,
                            )
                          : undefined
                      }
                      showMoveToPosition={sortConfig.field === "custom"}
                      onMoveToPosition={handleSongMoveToPosition}
                      showRefineMatch={!!songItem.missing}
                      onRefineMatch={handleRefineMatch}
                      showUnmatch={!!songItem.missing}
                      onUnmatch={handleUnmatch}
                    />
                  );
                }}
                renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
                getItemKey={(item, _index) =>
                  item.type === "song"
                    ? `${item.position}-${item.song.id}`
                    : `missing-${item.position}`
                }
                estimateItemHeight={56}
                ensureRange={ensureRange}
              />
            </>
          )
        ) : totalEntries > 0 ? (
          <EmptyFilterState message="No songs match your filter" />
        ) : (
          <EmptyState
            icon={ListMusic}
            title="This playlist is empty"
            description="Add songs to this playlist to see them here."
          />
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar
        mediaType="playlist-songs"
        selectedCount={totalSelectedCount}
        onClear={clearAllSelection}
        onPlayNow={handlePlaySelected}
        onPlayNext={() => addSelectedToQueue("next")}
        onAddToQueue={() => addSelectedToQueue("end")}
        onStar={() => starSelected(true)}
        onUnstar={() => starSelected(false)}
        onSelectAll={selectAllItems}
        getSelectedSongs={getSelectedSongs}
        onRemoveFromPlaylist={handleRemoveSelected}
        disablePlaybackActions={hasMissingInSelection}
        missingCount={selectedMissingIds.size}
      />

      {/* Spacer for player bar */}
      <div className="h-24" />

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete playlist?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{playlist?.name}&quot;. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove tracks confirmation dialog (bulk selection) */}
      <AlertDialog
        open={removeTracksDialogOpen}
        onOpenChange={setRemoveTracksDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {totalSelectedCount === 1 ? "entry" : "entries"} from
              playlist?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {totalSelectedCount === 1
                ? "This will remove 1 entry from the playlist."
                : `This will remove ${totalSelectedCount} entries from the playlist.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveSelected}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove single song confirmation dialog (context menu) */}
      <AlertDialog
        open={removeSingleSongDialogOpen}
        onOpenChange={(open) => {
          setRemoveSingleSongDialogOpen(open);
          if (!open) setPendingSingleRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove song from playlist?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{pendingSingleRemove?.songTitle}&quot; from
              the playlist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveSingleSong}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit playlist dialog */}
      {playlist && (
        <EditPlaylistDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          playlist={{
            id: playlist.id,
            name: playlist.name,
            comment: playlist.comment ?? undefined,
          }}
        />
      )}

      {/* Add song to playlist dialog */}
      {playlist && (
        <AddSongToPlaylistDialog
          open={addSongDialogOpen}
          onOpenChange={setAddSongDialogOpen}
          playlistId={playlist.id}
          playlistName={getPlaylistDisplayName(playlist.name)}
        />
      )}

      {/* Mass resolve missing entries dialog */}
      {playlist && hasMissingEntries && (
        <MassResolveDialog
          open={massResolveDialogOpen}
          onOpenChange={setMassResolveDialogOpen}
          playlistId={playlistId!}
          filter={debouncedFilter.trim() || undefined}
          sortField={sortConfig.field}
          sortDir={sortConfig.direction}
        />
      )}

      {/* Move to position dialog */}
      {moveDialogItem && (
        <MoveToPositionDialog
          open={moveDialogOpen}
          onOpenChange={setMoveDialogOpen}
          currentPosition={moveDialogItem.position}
          totalCount={totalEntries}
          itemName={moveDialogItem.name}
          onMove={handleMoveItem}
        />
      )}

      {/* Refine match dialog */}
      {refineMatchItem && playlistId && (
        <RefineMatchDialog
          open={refineMatchDialogOpen}
          onOpenChange={setRefineMatchDialogOpen}
          playlistId={playlistId}
          entryId={refineMatchItem.entryId}
          position={refineMatchItem.position}
          missing={refineMatchItem.missing}
          onMatched={resetPlaylistData}
        />
      )}

      {/* Unmatch confirmation dialog */}
      <AlertDialog
        open={unmatchDialogOpen}
        onOpenChange={(open) => {
          setUnmatchDialogOpen(open);
          if (!open) setPendingUnmatch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unmatch song?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert &quot;{pendingUnmatch?.songTitle}&quot; back to a
              missing entry. You can re-match it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnmatch}>
              Unmatch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function PlaylistDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh">
          <DetailHeader
            showBackButton
            icon={ListMusic}
            iconClassName="bg-linear-to-br from-emerald-500 to-emerald-800"
            coverSize="lg"
            gradientColor="rgba(16,185,129,0.2)"
            label="Playlist"
            title=""
            isLoading
          />
        </div>
      }
    >
      <PlaylistDetailContent />
    </Suspense>
  );
}
