"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAtom, useSetAtom } from "jotai";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Sparkles, Pencil, Trash2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import {
  playlistViewModeAtom,
  playlistSortAtom,
  playlistColumnVisibilityAtom,
} from "@/lib/store/ui";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyState } from "@/components/shared/empty-state";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
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
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { SmartPlaylistDialog } from "@/components/playlists/smart-playlist-dialog";
import { formatTotalDuration } from "@/lib/utils/format";
import { parsePlaylistPath } from "@/lib/utils/playlist-folders";
import type { Song } from "@/lib/api/types";

const PAGE_SIZE = 50;

function SmartPlaylistPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const queryClient = useQueryClient();
  const { isReady } = useAuth({ redirectToLogin: true });
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  // UI state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 200);
  const [viewMode, setViewMode] = useAtom(playlistViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(playlistSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(
    playlistColumnVisibilityAtom,
  );

  // Fetch smart playlist with pagination
  const {
    data: playlistData,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    // Include filter and sort in query key for proper refetching
    queryKey: [
      "smartPlaylistSongs",
      id,
      viewMode,
      debouncedFilter,
      sortConfig.field,
      sortConfig.direction,
    ],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client || !id) throw new Error("Not connected");
      return client.getSmartPlaylistSongs(id, {
        offset: pageParam,
        count: PAGE_SIZE,
        // Use medium thumbnails for grid view, small for list view
        inlineImages: viewMode === "grid" ? "medium" : "small",
        // Server-side filtering and sorting
        filter: debouncedFilter || undefined,
        sortField: sortConfig.field,
        sortDirection: sortConfig.direction,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce(
        (sum, page) => sum + page.songs.length,
        0,
      );
      return loadedCount < lastPage.totalCount ? loadedCount : undefined;
    },
    initialPageParam: 0,
    enabled: isReady && !!id,
  });

  // Also fetch the smart playlist details for editing
  const { data: smartPlaylist } = useQuery({
    queryKey: ["smartPlaylist", id],
    queryFn: async () => {
      const client = getClient();
      if (!client || !id) throw new Error("Not connected");
      const response = await client.getSmartPlaylists();
      return response.smartPlaylists.find((sp) => sp.id === id);
    },
    enabled: isReady && !!id,
  });

  // Flatten songs from all pages (no client-side filtering - server handles it)
  const songs: Song[] = (playlistData?.pages.flatMap((page) => page.songs) ??
    []) as Song[];

  // Get metadata from first page
  const firstPage = playlistData?.pages[0];

  // Track selection
  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedSongs,
  } = useTrackSelection(songs);

  const handlePlay = () => {
    if (songs.length === 0 || !id) return;
    startQueue({
      sourceType: "smartPlaylist",
      sourceId: id,
      sourceName: firstPage?.name,
    });
  };

  const handleShuffle = () => {
    if (songs.length === 0 || !id) return;
    startQueue({
      sourceType: "smartPlaylist",
      sourceId: id,
      sourceName: firstPage?.name,
      shuffle: true,
    });
  };

  const handleDelete = async () => {
    if (!id) return;
    const client = getClient();
    if (!client) return;
    try {
      await client.deleteSmartPlaylist(id);
      toast.success("Smart playlist deleted");
      router.push("/playlists");
    } catch {
      toast.error("Failed to delete smart playlist");
    }
  };

  // Bulk actions
  const playSelectedNow = () => {
    const selected = getSelectedSongs();
    if (selected.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: `Selected from ${firstPage?.name}`,
      songIds: selected.map((s) => s.id),
    });
    clearSelection();
  };

  const shuffleSelected = () => {
    const selected = getSelectedSongs();
    if (selected.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: `Selected from ${firstPage?.name}`,
      songIds: selected.map((s) => s.id),
      shuffle: true,
    });
    clearSelection();
  };

  const playSelectedNext = async () => {
    const selected = getSelectedSongs();
    if (selected.length === 0) return;
    const result = await addToQueue({
      songIds: selected.map((s) => s.id),
      position: "next",
    });
    if (result.success) {
      toast.success(
        `Added ${result.addedCount} song${result.addedCount !== 1 ? "s" : ""} to queue`,
      );
      clearSelection();
    }
  };

  const addSelectedToQueue = async () => {
    const selected = getSelectedSongs();
    if (selected.length === 0) return;
    const result = await addToQueue({
      songIds: selected.map((s) => s.id),
      position: "end",
    });
    if (result.success) {
      toast.success(
        `Added ${result.addedCount} song${result.addedCount !== 1 ? "s" : ""} to queue`,
      );
      clearSelection();
    }
  };

  const totalDuration = songs.reduce(
    (acc: number, s: Song) => acc + (s.duration ?? 0),
    0,
  );

  if (!id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">No playlist ID provided</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-destructive">Failed to load smart playlist</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <DetailHeader
        icon={Sparkles}
        iconClassName="bg-linear-to-br from-purple-500 to-purple-800"
        gradientColor="rgba(168,85,247,0.2)"
        label="Smart Playlist"
        title={
          firstPage?.name
            ? parsePlaylistPath(firstPage.name).displayName || firstPage.name
            : "Loading..."
        }
        subtitle={
          !isLoading &&
          firstPage &&
          `${firstPage.totalCount} songs • ${formatTotalDuration(totalDuration)}`
        }
        isLoading={isLoading}
      />

      <ActionBar
        onPlayAll={handlePlay}
        onShuffle={handleShuffle}
        disablePlay={songs.length === 0}
        actions={
          <>
            <Button
              variant="ghost"
              size="lg"
              className="rounded-full gap-2"
              onClick={() => setEditDialogOpen(true)}
            >
              <Pencil className="w-5 h-5" />
              Edit Rules
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <MoreHorizontal className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Smart Playlist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        toolbar={
          <SongListToolbar
            filter={filter}
            onFilterChange={setFilter}
            filterPlaceholder="Filter songs..."
            sortConfig={sortConfig}
            onSortChange={setSortConfig}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showCustomSort={true}
          />
        }
      />

      {/* Bulk Actions Bar */}
      {hasSelection && (
        <BulkActionsBar
          selectedCount={selectedCount}
          onClear={clearSelection}
          onSelectAll={selectAll}
          onPlayNow={playSelectedNow}
          onShuffle={shuffleSelected}
          onPlayNext={playSelectedNext}
          onAddToQueue={addSelectedToQueue}
          getSelectedSongs={getSelectedSongs}
        />
      )}

      <div className="px-4 lg:px-6 pb-32">
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
                <SongRowSkeleton key={i} />
              ))}
            </div>
          )
        ) : songs.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={songs}
              totalCount={
                firstPage?.totalCount ? Number(firstPage.totalCount) : undefined
              }
              renderItem={(song: Song, index: number) => (
                <SongCard
                  song={song}
                  index={index}
                  queueSource={{
                    type: "smartPlaylist",
                    id: id!,
                    name: firstPage?.name ?? "Smart Playlist",
                  }}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={handleSelect}
                />
              )}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(song: Song) => song.id}
              hasNextPage={hasNextPage ?? false}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
            />
          ) : (
            <VirtualizedList
              items={songs}
              totalCount={
                firstPage?.totalCount ? Number(firstPage.totalCount) : undefined
              }
              renderItem={(song: Song, index: number) => (
                <SongRow
                  song={song}
                  index={index}
                  showCover
                  queueSource={{
                    type: "smartPlaylist",
                    id: id!,
                    name: firstPage?.name ?? "Smart Playlist",
                  }}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={handleSelect}
                  showAlbum={columnVisibility.album}
                  showArtist={columnVisibility.artist}
                  showDuration={columnVisibility.duration}
                  showPlayCount={columnVisibility.playCount}
                  showYear={columnVisibility.year}
                  showDateAdded={columnVisibility.dateAdded}
                  showLastPlayed={columnVisibility.lastPlayed}
                />
              )}
              renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
              getItemKey={(song: Song) => song.id}
              estimateItemHeight={56}
              hasNextPage={hasNextPage ?? false}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
            />
          )
        ) : debouncedFilter ? (
          <EmptyState
            icon={Sparkles}
            title="No matching songs"
            description="No songs match your filter. Try adjusting your search."
          />
        ) : (
          <EmptyState
            icon={Sparkles}
            title="No matching songs"
            description="No songs match the rules for this smart playlist. Try adjusting the filters."
          />
        )}
      </div>

      {/* Edit Rules Dialog */}
      {smartPlaylist && (
        <SmartPlaylistDialog
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              // Refresh the data after editing
              queryClient.invalidateQueries({
                queryKey: ["smartPlaylist", id],
              });
            }
          }}
          editPlaylist={smartPlaylist}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Smart Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{firstPage?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function SmartPlaylistPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen">
          <DetailHeader
            icon={Sparkles}
            iconClassName="bg-linear-to-br from-purple-500 to-purple-800"
            gradientColor="rgba(168,85,247,0.2)"
            label="Smart Playlist"
            title="Loading..."
            isLoading
          />
        </div>
      }
    >
      <SmartPlaylistPageContent />
    </Suspense>
  );
}
