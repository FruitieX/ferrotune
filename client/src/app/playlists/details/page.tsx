"use client";

import { useState, useEffect, useMemo, Suspense, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  ListMusic,
  ChevronRight,
  Home,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { playlistViewModeAtom, playlistSortAtom, playlistColumnVisibilityAtom } from "@/lib/store/ui";
import { startQueueAtom, serverQueueStateAtom, toggleShuffleAtom } from "@/lib/store/server-queue";
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
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { MoveToPositionDialog } from "@/components/shared/move-to-position-dialog";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { EditPlaylistDialog } from "@/components/playlists/edit-playlist-dialog";
import { MissingEntryRow, MissingEntryCard } from "@/components/playlists/missing-entry-row";
import { MassResolveDialog } from "@/components/playlists/mass-resolve-dialog";
import { formatCount, formatDate, formatTotalDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import type { PlaylistSongEntry } from "@/lib/api/generated/PlaylistSongEntry";

const PAGE_SIZE = 50;

// Display item types for rendering
type DisplayItem = 
  | { type: "song"; song: Song; position: number }
  | { type: "missing"; entry: PlaylistSongEntry; position: number };

function PlaylistDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const playlistId = searchParams.get("id");

  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const startQueue = useSetAtom(startQueueAtom);
  const toggleShuffle = useSetAtom(toggleShuffleAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [removeTracksDialogOpen, setRemoveTracksDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [massResolveDialogOpen, setMassResolveDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogItem, setMoveDialogItem] = useState<{ name: string; position: number } | null>(null);
  const [filter, setFilter] = useState("");
  // Track selected missing entry IDs separately (format: "missing-{position}")
  const [selectedMissingIds, setSelectedMissingIds] = useState<Set<string>>(new Set());
  // Track anchor position for shift-selection across all items (songs + missing)
  const [selectionAnchorPosition, setSelectionAnchorPosition] = useState<number | null>(null);
  const debouncedFilter = useDebounce(filter, 300);
  const isMounted = useIsMounted();
  
  // View settings
  const [viewMode, setViewMode] = useAtom(playlistViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(playlistSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(playlistColumnVisibilityAtom);

  // Redirect to playlists if no ID
  useEffect(() => {
    if (!playlistId && isMounted && !authLoading) {
      router.replace("/playlists");
    }
  }, [playlistId, isMounted, authLoading, router]);

  // Fetch playlist songs with infinite scroll
  const {
    data: playlistData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["playlistSongs", playlistId, sortConfig.field, sortConfig.direction, debouncedFilter],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistSongs(playlistId!, {
        offset: pageParam,
        count: PAGE_SIZE,
        sort: sortConfig.field,
        sortDir: sortConfig.direction,
        filter: debouncedFilter.trim() || undefined,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.entries.length, 0);
      return loadedCount < lastPage.filteredCount ? loadedCount : undefined;
    },
    initialPageParam: 0,
    enabled: isReady && !!playlistId,
    placeholderData: (prev) => prev,
  });

  // Extract playlist metadata from first page
  const playlist = playlistData?.pages[0];
  
  // Flatten entries from all pages
  const allEntries = playlistData?.pages.flatMap((page) => page.entries) ?? [];
  
  // Convert entries to display items
  const displayItems: DisplayItem[] = allEntries.map((entry) => {
    if (entry.entryType === "song" && entry.song) {
      return {
        type: "song" as const,
        song: entry.song as Song,
        position: entry.position,
      };
    } else {
      return {
        type: "missing" as const,
        entry,
        position: entry.position,
      };
    }
  });

  // Extract just the songs for selection tracking
  const displaySongs: Song[] = displayItems
    .filter((item): item is Extract<DisplayItem, { type: "song" }> => item.type === "song")
    .map((item) => item.song);

  // Check if there are missing entries
  const hasMissingEntries = (playlist?.missingCount ?? 0) > 0;
  const missingEntryCount = playlist?.missingCount ?? 0;
  const totalEntries = playlist?.totalEntries ?? 0;
  const filteredCount = playlist?.filteredCount ?? displayItems.length;
  const totalDuration = playlist?.duration ?? 0;

  // Get the cover URL
  const coverUrl = usePlaylistCoverUrl(playlist?.id ?? null, 400, playlist?.coverArt);

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

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: async (songIds: string[]) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.reorderPlaylistSongs(playlistId!, songIds);
    },
    onSuccess: () => {
      // Invalidate to ensure we have the correct order from server
      queryClient.invalidateQueries({ queryKey: ["playlistSongs", playlistId] });
      toast.success("Playlist order updated");
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["playlistSongs", playlistId] });
      toast.error("Failed to update playlist order");
    },
  });

  // Add songs back mutation (for undo)
  const addSongsBackMutation = useMutation({
    mutationFn: async (songIds: string[]) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.updatePlaylist({ playlistId: playlistId!, songIdToAdd: songIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlistSongs", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Songs restored to playlist");
    },
    onError: () => {
      toast.error("Failed to restore songs");
    },
  });

  // Remove songs mutation
  const removeSongsMutation = useMutation({
    mutationFn: async ({ indices, songIds }: { indices: number[]; songIds: string[] }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.updatePlaylist({ playlistId: playlistId!, songIndexToRemove: indices });
      return songIds; // Return for undo
    },
    onSuccess: (songIds) => {
      queryClient.invalidateQueries({ queryKey: ["playlistSongs", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      const count = songIds.length;
      toast.success(count === 1 ? "Song removed from playlist" : `${count} songs removed from playlist`, {
        action: {
          label: "Undo",
          onClick: () => {
            addSongsBackMutation.mutate(songIds);
          },
        },
        duration: 8000, // Give user more time to undo
      });
    },
    onError: () => {
      toast.error("Failed to remove songs from playlist");
    },
  });

  // Use ref to access current display items without adding to callback dependencies
  const displayItemsRef = useRef(displayItems);
  displayItemsRef.current = displayItems;

  // Helper to remove a single song by its position (for context menu)
  const handleRemoveSingleSong = useCallback((songId: string) => {
    // Find the position of the song in the display items
    const item = displayItemsRef.current.find(
      (item) => item.type === "song" && item.song.id === songId
    );
    if (!item) return;
    removeSongsMutation.mutate({ indices: [item.position], songIds: [songId] });
  }, [removeSongsMutation]);

  // Helper to remove a missing entry by position (no undo since we can't add it back)
  const handleRemoveMissingEntry = useCallback(async (position: number) => {
    const client = getClient();
    if (!client) return;
    try {
      await client.updatePlaylist({ playlistId: playlistId!, songIndexToRemove: [position] });
      queryClient.invalidateQueries({ queryKey: ["playlistSongs", playlistId] });
      toast.success("Entry removed from playlist");
    } catch {
      toast.error("Failed to remove entry from playlist");
    }
  }, [playlistId, queryClient]);
  
  // Handle move to position for playlists (works for both songs and missing entries)
  const handleMoveToPosition = useCallback((item: { name: string; position: number }) => {
    setMoveDialogItem(item);
    setMoveDialogOpen(true);
  }, []);

  // Wrapper for song move to position (adapts Song to the generic interface)
  const handleSongMoveToPosition = useCallback((song: Song, currentIndex: number) => {
    handleMoveToPosition({ name: song.title, position: currentIndex });
  }, [handleMoveToPosition]);

  // Handler for missing entry move to position
  const handleMissingMoveToPosition = useCallback((name: string, position: number) => {
    handleMoveToPosition({ name, position });
  }, [handleMoveToPosition]);

  const handleMoveItem = useCallback(async (newPosition: number) => {
    if (!moveDialogItem) return;
    
    const { position: oldPosition } = moveDialogItem;
    if (oldPosition === newPosition) return;
    
    // Use the server-side move endpoint
    const client = getClient();
    if (!client) return;
    
    try {
      await client.movePlaylistEntry(playlistId!, oldPosition, newPosition);
      queryClient.invalidateQueries({ queryKey: ["playlistSongs", playlistId] });
      toast.success("Entry moved");
    } catch (error) {
      toast.error("Failed to move entry");
      console.error(error);
    }
  }, [moveDialogItem, playlistId, queryClient]);

  // Queue source for playlist - server materializes with same sort
  const playlistQueueSource = useMemo(() => ({
    type: "playlist" as const,
    id: playlistId,
    name: playlist?.name ?? "Playlist",
    sort: sortConfig.field !== "custom" ? {
      field: sortConfig.field,
      direction: sortConfig.direction,
    } : undefined,
  }), [playlistId, playlist?.name, sortConfig.field, sortConfig.direction]);

  // Check if a song at a given index is the currently playing track
  // This handles playlists with duplicate songs by comparing the queue position
  // Returns undefined if we can't determine (falls back to song ID matching in SongRow)
  const isCurrentQueuePosition = useCallback((index: number, _songId: string): boolean | undefined => {
    if (!queueState) return undefined;
    
    // Check if the queue source is this playlist
    const isPlaylistQueue = queueState.source?.type === "playlist" && queueState.source?.id === playlistId;
    
    if (isPlaylistQueue) {
      // When playing from this playlist, only highlight the exact position
      return queueState.currentIndex === index;
    }
    
    // For other sources, we can't reliably determine position
    // Return undefined to let SongRow fall back to song ID matching
    return undefined;
  }, [queueState, playlistId]);

  // Determine if we should use position-based highlighting
  const isPlaylistInQueue = queueState?.source?.type === "playlist" && queueState?.source?.id === playlistId;

  // Build breadcrumb items from playlist name (which includes folder path)
  const breadcrumbItems = useMemo(() => {
    const items: { label: string; path: string }[] = [{ label: "Playlists", path: "" }];
    if (!playlist?.name) return items;
    
    // Playlist names include the full path like "Folder/SubFolder/PlaylistName"
    const parts = playlist.name.split("/");
    
    // If there's only one part, there's no folder, just the playlist name
    if (parts.length <= 1) return items;
    
    // Build folder breadcrumbs (all parts except the last, which is the playlist name)
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      items.push({ label: parts[i], path: currentPath });
    }
    
    return items;
  }, [playlist?.name]);

  // Get the display name (last part of the path)
  const displayName = useMemo(() => {
    if (!playlist?.name) return "Playlist";
    const parts = playlist.name.split("/");
    return parts[parts.length - 1];
  }, [playlist?.name]);

  // Navigate to a folder
  const navigateToFolder = useCallback((path: string) => {
    if (path === "") {
      router.push("/playlists");
    } else {
      router.push(`/playlists?folder=${encodeURIComponent(path)}`);
    }
  }, [router]);

  // Clear missing entries selection
  const clearMissingSelection = useCallback(() => {
    setSelectedMissingIds(new Set());
    setSelectionAnchorPosition(null);
  }, []);

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
  const getSelectedIndices = useCallback(() => {
    const selected = getSelectedSongs();
    const selectedIds = new Set(selected.map(s => s.id));
    const indices: number[] = [];
    displayItems.forEach((item) => {
      if (item.type === "song" && selectedIds.has(item.song.id)) {
        indices.push(item.position);
      }
    });
    return indices;
  }, [getSelectedSongs, displayItems]);

  // Get all selected indices including missing entries
  const getAllSelectedIndices = useCallback(() => {
    const songIndices = getSelectedIndices();
    const missingIndices: number[] = [];
    selectedMissingIds.forEach(id => {
      // Extract position from "missing-{position}" format
      const match = id.match(/^missing-(\d+)$/);
      if (match) {
        missingIndices.push(parseInt(match[1], 10));
      }
    });
    // Combine and sort in descending order (remove from end first to preserve indices)
    return [...songIndices, ...missingIndices].sort((a, b) => b - a);
  }, [getSelectedIndices, selectedMissingIds]);

  const handleRemoveSelected = useCallback(() => {
    const indices = getAllSelectedIndices();
    if (indices.length > 0) {
      setRemoveTracksDialogOpen(true);
    }
  }, [getAllSelectedIndices]);

  // Unified selection handler for both songs and missing entries with shift-click support
  const handleUnifiedSelect = useCallback((
    itemId: string,
    position: number,
    isMissing: boolean,
    event?: React.MouseEvent
  ) => {
    const shiftKey = event?.shiftKey ?? false;
    
    if (shiftKey && selectionAnchorPosition !== null) {
      // Range selection: select all items between anchor and current position
      const start = Math.min(selectionAnchorPosition, position);
      const end = Math.max(selectionAnchorPosition, position);
      
      const newMissingIds = new Set(selectedMissingIds);
      
      displayItems.forEach(item => {
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
        setSelectedMissingIds(prev => {
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
  }, [selectionAnchorPosition, selectedMissingIds, displayItems, handleSelect]);

  // Missing entry selection handler (wrapper for unified handler)
  const handleMissingSelect = useCallback((id: string, selected: boolean, event?: React.MouseEvent) => {
    // Extract position from "missing-{position}" format
    const match = id.match(/^missing-(\d+)$/);
    if (match) {
      const position = parseInt(match[1], 10);
      handleUnifiedSelect(id, position, true, event);
    }
  }, [handleUnifiedSelect]);

  // Song selection handler (wrapper for unified handler with position tracking)
  const handleSongSelect = useCallback((id: string, event?: React.MouseEvent) => {
    const item = displayItems.find(i => i.type === "song" && i.song.id === id);
    if (item) {
      handleUnifiedSelect(id, item.position, false, event);
    } else {
      // Fallback to original handler if item not found
      handleSelect(id, event);
    }
  }, [displayItems, handleUnifiedSelect, handleSelect]);

  const isMissingSelected = useCallback((id: string) => {
    return selectedMissingIds.has(id);
  }, [selectedMissingIds]);

  // Clear all selection (songs + missing)
  const clearAllSelection = useCallback(() => {
    clearSelection();
    setSelectedMissingIds(new Set());
    setSelectionAnchorPosition(null);
  }, [clearSelection]);

  // Select all items (songs + missing entries)
  const selectAllItems = useCallback(() => {
    // Select all songs
    selectAll();
    // Select all missing entries
    const allMissingIds = new Set<string>();
    displayItems.forEach(item => {
      if (item.type === "missing") {
        allMissingIds.add(`missing-${item.position}`);
      }
    });
    setSelectedMissingIds(allMissingIds);
  }, [selectAll, displayItems]);

  // Total selection count
  const totalSelectedCount = selectedCount + selectedMissingIds.size;
  const hasMissingInSelection = selectedMissingIds.size > 0;

  const confirmRemoveSelected = useCallback(() => {
    const indices = getAllSelectedIndices();
    const songIds = getSelectedSongs().map(s => s.id);
    if (indices.length > 0) {
      removeSongsMutation.mutate({ indices, songIds });
      clearAllSelection();
    }
    setRemoveTracksDialogOpen(false);
  }, [getAllSelectedIndices, getSelectedSongs, removeSongsMutation, clearAllSelection]);

  const handlePlaySelected = () => {
    const selected = getSelectedSongs();
    if (selected.length > 0) {
      startQueue({
        sourceType: "playlist",
        sourceId: playlistId ?? undefined,
        sourceName: displayName,
        songIds: selected.map(s => s.id),
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
      });
    }
  };

  // Loading state
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen">
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
    <div className="min-h-screen">
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
                  <span className="font-medium text-foreground">{playlist.owner}</span>
                  <span>•</span>
                </>
              )}
              <span>{formatCount(playlist.matchedCount, "song")}</span>
              {hasMissingEntries && (
                <>
                  <span>•</span>
                  <Badge variant="secondary" className="bg-orange-500/20 text-orange-500 h-5">
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
      {breadcrumbItems.length > 1 && (
        <div className="relative z-20 px-4 lg:px-6 py-2 flex items-center gap-1 text-sm text-muted-foreground border-b border-border bg-background/80 backdrop-blur-sm">
          {breadcrumbItems.map((item, index) => (
            <div key={item.path} className="flex items-center">
              {index > 0 && <ChevronRight className="w-4 h-4 mx-1" />}
              <button
                onClick={() => navigateToFolder(item.path)}
                className="hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-accent"
              >
                {index === 0 ? <Home className="w-4 h-4" /> : item.label}
              </button>
            </div>
          ))}
          <ChevronRight className="w-4 h-4 mx-1" />
          <span className="font-medium text-foreground">{displayName}</span>
        </div>
      )}

      {/* Action bar */}
      <ActionBar
        onPlayAll={handlePlayAll}
        onShuffle={handleShuffle}
        disablePlay={isLoading || displaySongs.length === 0}
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
        {isLoading && displayItems.length === 0 ? (
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
        ) : displayItems.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={displayItems}
              totalCount={filteredCount}
              renderItem={(item, index) => {
                if (item.type === "missing" && item.entry.missing) {
                  const missingId = `missing-${item.position}`;
                  return (
                    <MissingEntryCard
                      playlistId={playlistId!}
                      position={item.position}
                      missing={item.entry.missing}
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
                    isCurrentQueuePosition={isPlaylistInQueue ? isCurrentQueuePosition(songItem.position, songItem.song.id) : undefined}
                    showMoveToPosition={sortConfig.field === "custom"}
                    onMoveToPosition={handleSongMoveToPosition}
                  />
                );
              }}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(item, index) => 
                item.type === "song" 
                  ? `${item.position}-${item.song.id}`
                  : `missing-${item.position}`
              }
              hasNextPage={hasNextPage ?? false}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
            />
          ) : (
            <VirtualizedList
              items={displayItems}
              totalCount={filteredCount}
              renderItem={(item, index) => {
                if (item.type === "missing" && item.entry.missing) {
                  const missingId = `missing-${item.position}`;
                  return (
                    <MissingEntryRow
                      playlistId={playlistId!}
                      position={item.position}
                      missing={item.entry.missing}
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
                    showLastPlayed={columnVisibility.lastPlayed}
                    queueSource={playlistQueueSource}
                    isSelected={isSelected(songItem.song.id)}
                    isSelectionMode={totalSelectedCount > 0}
                    onSelect={handleSongSelect}
                    showRemoveFromPlaylist
                    onRemoveFromPlaylist={handleRemoveSingleSong}
                    isCurrentQueuePosition={isPlaylistInQueue ? isCurrentQueuePosition(songItem.position, songItem.song.id) : undefined}
                    showMoveToPosition={sortConfig.field === "custom"}
                    onMoveToPosition={handleSongMoveToPosition}
                  />
                );
              }}
              renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
              getItemKey={(item, index) => 
                item.type === "song" 
                  ? `${item.position}-${item.song.id}`
                  : `missing-${item.position}`
              }
              estimateItemHeight={56}
              hasNextPage={hasNextPage ?? false}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
            />
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
              This will permanently delete &quot;{playlist?.name}&quot;. This action
              cannot be undone.
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

      {/* Remove tracks confirmation dialog */}
      <AlertDialog open={removeTracksDialogOpen} onOpenChange={setRemoveTracksDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {totalSelectedCount === 1 ? "entry" : "entries"} from playlist?</AlertDialogTitle>
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

      {/* Mass resolve missing entries dialog */}
      {playlist && hasMissingEntries && (
        <MassResolveDialog
          open={massResolveDialogOpen}
          onOpenChange={setMassResolveDialogOpen}
          playlistId={playlistId!}
          entries={allEntries.map((e) => ({
            position: e.position,
            songId: e.song?.id ?? null,
            missing: e.missing ?? null,
          }))}
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
    </div>
  );
}

export default function PlaylistDetailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen">
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
    }>
      <PlaylistDetailContent />
    </Suspense>
  );
}
