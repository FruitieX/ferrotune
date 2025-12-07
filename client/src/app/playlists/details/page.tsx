"use client";

import { useState, useEffect, useMemo, Suspense, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { MissingEntryRow } from "@/components/playlists/missing-entry-row";
import { MassResolveDialog } from "@/components/playlists/mass-resolve-dialog";
import { formatDuration, formatCount, formatDate, formatTotalDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import type { PlaylistEntryResponse } from "@/lib/api/generated/PlaylistEntryResponse";

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
  const [moveDialogSong, setMoveDialogSong] = useState<{ song: Song; index: number } | null>(null);
  const [filter, setFilter] = useState("");
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

  // Fetch playlist details with server-side sort/filter
  const { data: playlist, isLoading } = useQuery({
    queryKey: ["playlist", playlistId, sortConfig.field, sortConfig.direction, debouncedFilter],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylist(playlistId!, {
        sort: sortConfig.field !== "custom" ? sortConfig.field : undefined,
        sortDir: sortConfig.field !== "custom" ? sortConfig.direction : undefined,
        filter: debouncedFilter.trim() || undefined,
      });
      return response.playlist;
    },
    enabled: isReady && !!playlistId,
    // Keep previous data while fetching new sort/filter results
    placeholderData: (prev) => prev,
  });

  // Fetch playlist entries (to check for missing entries)
  // This is separate from the main playlist query because it needs to include missing entries
  const { data: playlistEntries } = useQuery({
    queryKey: ["playlistEntries", playlistId],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistEntries(playlistId!);
    },
    enabled: isReady && !!playlistId,
  });

  // Check if there are missing entries
  const hasMissingEntries = (playlistEntries?.missing ?? 0) > 0;
  const missingEntryCount = playlistEntries?.missing ?? 0;

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
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      toast.success("Playlist order updated");
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
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
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
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
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
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

  const songs = playlist?.entry ?? [];
  
  // Use ref to access current songs without adding to callback dependencies
  const songsRef = useRef(songs);
  songsRef.current = songs;

  // Helper to remove a single song by its ID (for context menu)
  // Uses songsRef to avoid recreating callback when songs change
  const handleRemoveSingleSong = useCallback((songId: string) => {
    // Find the index of the song in the original playlist order
    const index = songsRef.current.findIndex((s) => s.id === songId);
    if (index === -1) return;
    removeSongsMutation.mutate({ indices: [index], songIds: [songId] });
  }, [removeSongsMutation]);

  // Helper to remove a missing entry by position (no undo since we can't add it back)
  const handleRemoveMissingEntry = useCallback(async (position: number) => {
    const client = getClient();
    if (!client) return;
    try {
      await client.updatePlaylist({ playlistId: playlistId!, songIndexToRemove: [position] });
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlistEntries", playlistId] });
      toast.success("Entry removed from playlist");
    } catch {
      toast.error("Failed to remove entry from playlist");
    }
  }, [playlistId, queryClient]);
  
  // Handle move to position for playlists
  const handleMoveToPosition = useCallback((song: Song, currentIndex: number) => {
    setMoveDialogSong({ song, index: currentIndex });
    setMoveDialogOpen(true);
  }, []);

  const handleMoveSong = useCallback((newIndex: number) => {
    if (!moveDialogSong) return;
    
    const { index: oldIndex } = moveDialogSong;
    if (oldIndex === newIndex) return;
    
    // Create new order by moving the song
    const newOrder = [...songs];
    const [movedSong] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, movedSong);
    
    // Submit reorder with all song IDs in new order
    reorderMutation.mutate(newOrder.map(s => s.id));
  }, [moveDialogSong, songs, reorderMutation]);
  
  // Songs come from server already sorted and filtered
  const displaySongs = songs;

  // Build display items that include both songs and missing entries
  // Only show missing entries in custom sort mode with no filter
  type DisplayItem = 
    | { type: "song"; song: Song; position: number }
    | { type: "missing"; entry: PlaylistEntryResponse; position: number };

  const displayItems = useMemo((): DisplayItem[] => {
    // If there are no missing entries, just show songs as usual
    if (!hasMissingEntries || !playlistEntries) {
      return displaySongs.map((song, index) => ({
        type: "song" as const,
        song,
        position: index,
      }));
    }

    // Only show missing entries in custom sort mode with no filter
    const showMissing = sortConfig.field === "custom" && !debouncedFilter.trim();
    
    if (!showMissing) {
      // When filtering or sorting, only show matched songs
      return displaySongs.map((song, index) => ({
        type: "song" as const,
        song,
        position: index,
      }));
    }

    // Build unified list with both songs and missing entries in position order
    // The playlist entries have position info, but songs from getPlaylist may be filtered/sorted
    // We need to match them up by position

    // Create a map of song_id to Song for quick lookup
    const songMap = new Map(songs.map(s => [s.id, s]));

    // Build display items from entries
    const items: DisplayItem[] = [];
    for (const entry of playlistEntries.entries) {
      if (entry.songId && songMap.has(entry.songId)) {
        items.push({
          type: "song",
          song: songMap.get(entry.songId)!,
          position: entry.position,
        });
      } else if (entry.missing) {
        items.push({
          type: "missing",
          entry,
          position: entry.position,
        });
      }
    }

    return items;
  }, [displaySongs, songs, hasMissingEntries, playlistEntries, sortConfig.field, debouncedFilter]);

  const totalDuration = displaySongs.reduce((acc, song) => acc + (song.duration ?? 0), 0);

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
  } = useTrackSelection(displaySongs);

  // Get indices of selected songs in the original order (for removal)
  const getSelectedIndices = useCallback(() => {
    const selected = getSelectedSongs();
    const selectedIds = new Set(selected.map(s => s.id));
    const indices: number[] = [];
    songs.forEach((song, index) => {
      if (selectedIds.has(song.id)) {
        indices.push(index);
      }
    });
    return indices;
  }, [getSelectedSongs, songs]);

  const handleRemoveSelected = useCallback(() => {
    const indices = getSelectedIndices();
    if (indices.length > 0) {
      setRemoveTracksDialogOpen(true);
    }
  }, [getSelectedIndices]);

  const confirmRemoveSelected = useCallback(() => {
    const indices = getSelectedIndices();
    const songIds = getSelectedSongs().map(s => s.id);
    if (indices.length > 0) {
      removeSongsMutation.mutate({ indices, songIds });
      clearSelection();
    }
    setRemoveTracksDialogOpen(false);
  }, [getSelectedIndices, getSelectedSongs, removeSongsMutation, clearSelection]);

  const handlePlaySelected = () => {
    const selected = getSelectedSongs();
    if (selected.length > 0) {
      startQueue({
        sourceType: "playlist",
        sourceId: playlistId ?? undefined,
        sourceName: displayName,
        songIds: selected.map(s => s.id),
      });
      clearSelection();
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
        subtitle={playlist?.comment}
        metadata={
          playlist && (
            <span className="flex flex-wrap items-center gap-2">
              {playlist.owner && (
                <>
                  <span className="font-medium text-foreground">{playlist.owner}</span>
                  <span>•</span>
                </>
              )}
              <span>{formatCount(displaySongs.length, "song")}</span>
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
        ) : displayItems.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={displayItems.filter((item): item is Extract<typeof item, { type: "song" }> => item.type === "song")}
              renderItem={(item, index) => (
                <SongCard
                  song={item.song}
                  index={item.position}
                  queueSource={playlistQueueSource}
                  isSelected={isSelected(item.song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={handleSelect}
                  isCurrentQueuePosition={isPlaylistInQueue ? isCurrentQueuePosition(item.position, item.song.id) : undefined}
                  showMoveToPosition={sortConfig.field === "custom"}
                  onMoveToPosition={handleMoveToPosition}
                />
              )}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(item, index) => `${item.position}-${item.song.id}`}
            />
          ) : (
            <VirtualizedList
              items={displayItems}
              renderItem={(item, index) => {
                if (item.type === "missing" && item.entry.missing) {
                  return (
                    <MissingEntryRow
                      playlistId={playlistId!}
                      position={item.position}
                      missing={item.entry.missing}
                      isSelected={false}
                      isSelectionMode={hasSelection}
                      onRemove={handleRemoveMissingEntry}
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
                    isSelectionMode={hasSelection}
                    onSelect={handleSelect}
                    showRemoveFromPlaylist
                    onRemoveFromPlaylist={handleRemoveSingleSong}
                    isCurrentQueuePosition={isPlaylistInQueue ? isCurrentQueuePosition(songItem.position, songItem.song.id) : undefined}
                    showMoveToPosition={sortConfig.field === "custom"}
                    onMoveToPosition={handleMoveToPosition}
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
            />
          )
        ) : songs.length > 0 ? (
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
        selectedCount={selectedCount}
        onClear={clearSelection}
        onPlayNow={handlePlaySelected}
        onPlayNext={() => addSelectedToQueue("next")}
        onAddToQueue={() => addSelectedToQueue("end")}
        onStar={() => starSelected(true)}
        onUnstar={() => starSelected(false)}
        onSelectAll={selectAll}
        getSelectedSongs={getSelectedSongs}
        onRemoveFromPlaylist={handleRemoveSelected}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
            <AlertDialogTitle>Remove tracks from playlist?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount === 1
                ? "This will remove 1 track from the playlist."
                : `This will remove ${selectedCount} tracks from the playlist.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveSelected}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
          playlist={{...playlist, comment: playlist.comment ?? undefined}}
        />
      )}

      {/* Mass resolve missing entries dialog */}
      {playlistEntries && hasMissingEntries && (
        <MassResolveDialog
          open={massResolveDialogOpen}
          onOpenChange={setMassResolveDialogOpen}
          playlistId={playlistId!}
          entries={playlistEntries.entries}
        />
      )}
      
      {/* Move to position dialog */}
      {moveDialogSong && (
        <MoveToPositionDialog
          open={moveDialogOpen}
          onOpenChange={setMoveDialogOpen}
          currentPosition={moveDialogSong.index}
          totalCount={displaySongs.length}
          itemName={moveDialogSong.song.title}
          onMove={handleMoveSong}
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
