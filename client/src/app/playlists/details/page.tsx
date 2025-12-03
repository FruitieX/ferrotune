"use client";

import { useState, useEffect, useMemo, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useAtom, useSetAtom } from "jotai";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
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
  Play,
  Shuffle,
  MoreHorizontal,
  Clock,
  Pencil,
  Trash2,
  ArrowLeft,
  GripVertical,
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
import { PlaylistCover, usePlaylistCoverUrl } from "@/components/shared/playlist-cover";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { SortableSongRow } from "@/components/shared/sortable-song-row";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { EditPlaylistDialog } from "@/components/playlists/edit-playlist-dialog";
import { formatDuration, formatCount, formatDate } from "@/lib/utils/format";
import { sortSongs } from "@/lib/utils/sort-songs";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import { Music } from "lucide-react";

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
      // Don't invalidate - we already have the optimistic update in localSongOrder
      toast.success("Playlist order updated");
    },
    onError: () => {
      // On error, refetch to restore the correct order
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      toast.error("Failed to update playlist order");
    },
  });

  const songs = playlist?.entry ?? [];
  
  // Local state for optimistic reordering
  const [localSongOrder, setLocalSongOrder] = useState<Song[]>([]);
  
  // Sync local order with fetched data
  useEffect(() => {
    if (songs.length > 0) {
      setLocalSongOrder(songs);
    }
  }, [songs]);

  // Use local order for display (allows optimistic updates)
  const orderedSongs = localSongOrder.length > 0 ? localSongOrder : songs;
  
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
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
          
          // Update local state for optimistic UI
          setLocalSongOrder(newOrder);
          
          // Persist the new order to the server
          reorderMutation.mutate(newOrder.map((s) => s.id));
        }
      }
    },
    [localSongOrder, reorderMutation]
  );

  // Check if drag-and-drop should be enabled (only when no filter/sort applied)
  const isDragEnabled = !debouncedFilter.trim() && sortConfig.field === "custom" && viewMode === "list";
  
  // Filter and sort songs
  const displaySongs = useMemo(() => {
    // When drag is enabled, use local order; otherwise use ordered songs
    const sourceSongs = isDragEnabled ? orderedSongs : orderedSongs;
    let filtered = sourceSongs;
    
    // Apply filter
    if (debouncedFilter.trim()) {
      const query = debouncedFilter.toLowerCase();
      filtered = sourceSongs.filter(song =>
        song.title?.toLowerCase().includes(query) ||
        song.artist?.toLowerCase().includes(query) ||
        song.album?.toLowerCase().includes(query)
      );
    }
    
    // Apply sort (skip for custom/playlist order)
    if (sortConfig.field !== "custom") {
      return sortSongs(filtered, sortConfig.field, sortConfig.direction);
    }
    
    return filtered;
  }, [orderedSongs, debouncedFilter, sortConfig, isDragEnabled]);

  // Track selection - use displaySongs for selection
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

  // Always render the same loading state on server and during hydration
  // This prevents hydration mismatches
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen">
        {/* Header with gradient background */}
        <div className="relative">
          <div className="absolute inset-0 h-[400px] bg-gradient-to-b from-primary/20 to-background" />
          <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              <Skeleton className="w-48 h-48 md:w-56 md:h-56 rounded-lg" />
              <div className="space-y-4 text-center md:text-left">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </div>
        </div>
        {/* Action buttons skeleton */}
        <div className="px-4 lg:px-6 py-4 border-b border-border">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-28 rounded-full" />
            <Skeleton className="h-12 w-28 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </div>
        {/* Track list skeleton */}
        <div className="px-4 lg:px-6 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="w-8 h-4" />
              <Skeleton className="w-10 h-10 rounded" />
              <div className="flex-1">
                <Skeleton className="h-4 w-40 mb-1" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!playlistId) {
    return null;
  }

  // Get the cover URL for background
  const coverUrl = usePlaylistCoverUrl(playlist?.id ?? null, 400);

  return (
    <div className="min-h-screen">
      {/* Header with blurred background */}
      <div className="relative">
        {/* Background image with blur */}
        {coverUrl && (
          <div 
            className="absolute inset-0 h-[400px] overflow-hidden"
            style={{
              backgroundImage: `url(${coverUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {/* Blur and gradient overlay */}
            <div className="absolute inset-0 backdrop-blur-3xl bg-background/60" />
            <div 
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, transparent 0%, hsl(var(--background)) 100%)`
              }}
            />
          </div>
        )}
        {/* Fallback gradient when no cover image */}
        {!coverUrl && (
          <div
            className="absolute inset-0 h-[400px]"
            style={{
              background: `linear-gradient(180deg, rgba(var(--primary-rgb, 30, 215, 96), 0.2) 0%, hsl(var(--background)) 100%)`,
            }}
          />
        )}

        {/* Back button */}
        <div className="relative z-10 p-4 lg:p-6">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-background/50 hover:bg-background/80"
            onClick={() => router.back()}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </div>

        <div className="relative z-10 px-4 lg:px-6 pb-6">
          {isLoading ? (
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              <Skeleton className="w-48 h-48 md:w-56 md:h-56 rounded-lg" />
              <div className="space-y-4 text-center md:text-left">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          ) : playlist ? (
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-48 h-48 md:w-56 md:h-56 shrink-0"
              >
                <PlaylistCover
                  playlistId={playlist.id}
                  alt={playlist.name}
                  size="full"
                  className="rounded-lg shadow-2xl"
                  priority
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-center md:text-left"
              >
                <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Playlist
                </span>
                <h1 className="text-3xl md:text-5xl font-bold mt-2">
                  {playlist.name}
                </h1>
                {playlist.comment && (
                  <p className="mt-4 text-muted-foreground max-w-lg">
                    {playlist.comment}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-center md:justify-start gap-2 text-sm text-muted-foreground">
                  {playlist.owner && (
                    <>
                      <span className="font-medium text-foreground">{playlist.owner}</span>
                      <span>•</span>
                    </>
                  )}
                  <span>{formatCount(playlist.songCount, "song")}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(playlist.duration)}
                  </span>
                  {playlist.created && (
                    <>
                      <span>•</span>
                      <span>Created {formatDate(playlist.created)}</span>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Action buttons and toolbar */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
          <Button
            size="lg"
            className="rounded-full gap-2 px-8"
            onClick={handlePlayAll}
            disabled={isLoading || displaySongs.length === 0}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleShuffle}
            disabled={isLoading || displaySongs.length === 0}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </Button>

          <div className="flex-1" />
          
          {/* Toolbar with filter/sort/columns/view mode */}
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
        </div>
      </div>

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
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Music className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              {debouncedFilter ? "No songs match your filter" : "This playlist is empty"}
            </p>
          </div>
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedCount}
        onClear={clearSelection}
        onPlayNow={handlePlaySelected}
        onPlayNext={() => addSelectedToQueue("next")}
        onAddToQueue={() => addSelectedToQueue("last")}
        onStar={() => starSelected(true)}
        onUnstar={() => starSelected(false)}
        onSelectAll={selectAll}
        getSelectedSongs={getSelectedSongs}
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
      <div className="min-h-screen">
        <div className="relative">
          <div className="absolute inset-0 h-[400px] bg-gradient-to-b from-primary/20 to-background" />
          <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              <Skeleton className="w-48 h-48 md:w-56 md:h-56 rounded-lg" />
              <div className="space-y-4 text-center md:text-left">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </div>
        </div>
      </div>
    }>
      <PlaylistDetailContent />
    </Suspense>
  );
}
