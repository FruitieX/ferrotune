"use client";

import { useState, useEffect, useMemo, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useAtom, useSetAtom } from "jotai";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  ListMusic,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { playlistViewModeAtom, playlistSortAtom, playlistColumnVisibilityAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { SortableSongRow } from "@/components/shared/sortable-song-row";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { EditPlaylistDialog } from "@/components/playlists/edit-playlist-dialog";
import { formatDuration, formatCount, formatDate, formatTotalDuration } from "@/lib/utils/format";
import { sortSongs } from "@/lib/utils/sort-songs";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";

function PlaylistDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const playlistId = searchParams.get("id");

  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
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

  // Fetch playlist details
  const { data: playlist, isLoading } = useQuery({
    queryKey: ["playlist", playlistId],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylist(playlistId!);
      return response.playlist;
    },
    enabled: isReady && !!playlistId,
  });

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
      toast.success("Playlist order updated");
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      toast.error("Failed to update playlist order");
    },
  });

  // Remove songs mutation
  const removeSongsMutation = useMutation({
    mutationFn: async (songIndices: number[]) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.updatePlaylist({ playlistId: playlistId!, songIndexToRemove: songIndices });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Songs removed from playlist");
    },
    onError: () => {
      toast.error("Failed to remove songs from playlist");
    },
  });

  const songs = playlist?.entry ?? [];
  
  // Local state for optimistic reordering
  const [localSongOrder, setLocalSongOrder] = useState<Song[]>([]);
  
  // Sync local order with fetched data
  useEffect(() => {
    setLocalSongOrder(songs);
  }, [playlistId, songs]);

  // Use local order for display (allows optimistic updates)
  const orderedSongs = localSongOrder.length > 0 ? localSongOrder : songs;
  
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = localSongOrder.findIndex((item) => item.id === active.id);
        const newIndex = localSongOrder.findIndex((item) => item.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(localSongOrder, oldIndex, newIndex);
          setLocalSongOrder(newOrder);
          reorderMutation.mutate(newOrder.map((s) => s.id));
        }
      }
    },
    [localSongOrder, reorderMutation]
  );

  // Check if drag-and-drop should be enabled
  const isDragEnabled = !debouncedFilter.trim() && sortConfig.field === "custom" && viewMode === "list";
  
  // Filter and sort songs
  const displaySongs = useMemo(() => {
    let filtered = orderedSongs;
    
    if (debouncedFilter.trim()) {
      const query = debouncedFilter.toLowerCase();
      filtered = orderedSongs.filter(song =>
        song.title?.toLowerCase().includes(query) ||
        song.artist?.toLowerCase().includes(query) ||
        song.album?.toLowerCase().includes(query)
      );
    }
    
    if (sortConfig.field !== "custom") {
      return sortSongs(filtered, sortConfig.field, sortConfig.direction);
    }
    
    return filtered;
  }, [orderedSongs, debouncedFilter, sortConfig]);

  const totalDuration = displaySongs.reduce((acc, song) => acc + (song.duration ?? 0), 0);

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
    orderedSongs.forEach((song, index) => {
      if (selectedIds.has(song.id)) {
        indices.push(index);
      }
    });
    return indices;
  }, [getSelectedSongs, orderedSongs]);

  const handleRemoveSelected = useCallback(() => {
    const indices = getSelectedIndices();
    if (indices.length > 0) {
      removeSongsMutation.mutate(indices);
      clearSelection();
    }
  }, [getSelectedIndices, removeSongsMutation, clearSelection]);

  const handlePlaySelected = () => {
    const selected = getSelectedSongs();
    if (selected.length > 0) {
      playNow(selected);
      clearSelection();
    }
  };

  const handlePlayAll = () => {
    if (displaySongs.length > 0) {
      setIsShuffled(false);
      playNow(displaySongs);
    }
  };

  const handleShuffle = () => {
    if (displaySongs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...displaySongs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
    }
  };

  // Loading state
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
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
        coverAlt={playlist?.name ?? "Playlist"}
        icon={ListMusic}
        iconClassName="bg-linear-to-br from-emerald-500 to-emerald-800"
        coverSize="lg"
        useBlurredBackground={!!coverUrl}
        gradientColor="rgba(16,185,129,0.2)"
        label="Playlist"
        title={isLoading ? "Loading..." : (playlist?.name ?? "Playlist")}
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
        ) : displaySongs.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={displaySongs}
              renderItem={(song) => (
                <SongCard
                  song={song}
                  queueSongs={displaySongs}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={(e) => handleSelect(song.id, e)}
                />
              )}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(song) => song.id}
            />
          ) : isDragEnabled ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displaySongs.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1">
                  {displaySongs.map((song, index) => (
                    <SortableSongRow
                      key={song.id}
                      song={song}
                      index={index}
                      showCover
                      showArtist={columnVisibility.artist}
                      showAlbum={columnVisibility.album}
                      showDuration={columnVisibility.duration}
                      showPlayCount={columnVisibility.playCount}
                      showYear={columnVisibility.year}
                      showDateAdded={columnVisibility.dateAdded}
                      queueSongs={displaySongs}
                      isSelected={isSelected(song.id)}
                      isSelectionMode={hasSelection}
                      onSelect={(e) => handleSelect(song.id, e)}
                      disabled={hasSelection}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <VirtualizedList
              items={displaySongs}
              renderItem={(song, index) => (
                <SongRow
                  song={song}
                  index={index}
                  showCover
                  showArtist={columnVisibility.artist}
                  showAlbum={columnVisibility.album}
                  showDuration={columnVisibility.duration}
                  showPlayCount={columnVisibility.playCount}
                  showYear={columnVisibility.year}
                  showDateAdded={columnVisibility.dateAdded}
                  queueSongs={displaySongs}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={(e) => handleSelect(song.id, e)}
                />
              )}
              renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
              getItemKey={(song) => song.id}
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
        onAddToQueue={() => addSelectedToQueue("last")}
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

      {/* Edit playlist dialog */}
      {playlist && (
        <EditPlaylistDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          playlist={playlist}
        />
      )}
    </div>
  );
}

export default function PlaylistDetailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    }>
      <PlaylistDetailContent />
    </Suspense>
  );
}
