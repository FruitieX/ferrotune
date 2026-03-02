"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Pencil, Trash2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { useSparsePagination } from "@/lib/hooks/use-sparse-pagination";
import {
  playlistViewModeAtom,
  playlistSortAtom,
  playlistColumnVisibilityAtom,
} from "@/lib/store/ui";
import {
  startQueueAtom,
  addToQueueAtom,
  serverQueueStateAtom,
  toggleShuffleAtom,
} from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
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
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyState } from "@/components/shared/empty-state";
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
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { SmartPlaylistDialog } from "@/components/playlists/smart-playlist-dialog";
import {
  PlaylistBreadcrumb,
  getPlaylistDisplayName,
} from "@/components/shared/playlist-breadcrumb";
import { formatTotalDuration } from "@/lib/utils/format";
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
  const toggleShuffle = useSetAtom(toggleShuffleAtom);
  const queueState = useAtomValue(serverQueueStateAtom);

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

  // Fetch smart playlist with sparse pagination
  const {
    items: songs,
    totalCount,
    isLoading,
    ensureRange,
    metadata,
  } = useSparsePagination<Song, { totalDuration: number }>({
    // Include filter and sort in query key for proper refetching
    queryKey: [
      "smartPlaylistSongs",
      id,
      viewMode,
      debouncedFilter,
      sortConfig.field,
      sortConfig.direction,
    ],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const client = getClient();
      if (!client || !id) throw new Error("Not connected");
      const response = await client.getSmartPlaylistSongs(id, {
        offset,
        count: PAGE_SIZE,
        // Use medium thumbnails for grid view, small for list view
        inlineImages: viewMode === "grid" ? "medium" : "small",
        // Server-side filtering and sorting
        filter: debouncedFilter || undefined,
        sortField: sortConfig.field,
        sortDirection: sortConfig.direction,
      });
      return {
        items: response.songs as Song[],
        total: response.totalCount,
        metadata: { totalDuration: response.totalDuration },
      };
    },
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

  // Filter out undefined entries from sparse array
  const loadedSongs: Song[] = songs.filter(
    (song): song is Song => song !== undefined,
  );

  // Get display name using shared utility
  const displayName = getPlaylistDisplayName(smartPlaylist?.name);

  // Determine if this smart playlist is the current queue source
  const isSmartPlaylistInQueue =
    queueState?.source?.type === "smartPlaylist" &&
    queueState?.source?.id === id;

  // Queue source for song cards/rows - extracted to avoid recreating on every render
  const smartPlaylistQueueSource = {
    type: "smartPlaylist" as const,
    id: id!,
    name: smartPlaylist?.name ?? "Smart Playlist",
    filters: debouncedFilter ? { filter: debouncedFilter } : undefined,
    sort:
      sortConfig.field !== "custom"
        ? {
            field: sortConfig.field,
            direction: sortConfig.direction,
          }
        : undefined,
  };

  // Check if a song at a given position is the currently playing track
  // When shuffled, return undefined to let SongRow fall back to song ID matching
  // This ensures the correct track is highlighted even when shuffle reorders the queue
  const getIsCurrentQueuePosition = (index: number): boolean | undefined => {
    if (!queueState || !isSmartPlaylistInQueue) return undefined;

    // When queue is shuffled, positions don't match - fall back to song ID
    if (queueState.isShuffled) return undefined;

    // Check if position matches (only reliable when not shuffled)
    const positionMatches = queueState.currentIndex === index;
    if (positionMatches) return true;

    // Position doesn't match, return undefined to allow song ID fallback
    // (sort/filter might have changed since playback started)
    return undefined;
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
  } = useTrackSelection(loadedSongs);

  const handlePlay = () => {
    if (loadedSongs.length === 0 || !id) return;
    // If currently shuffled, turn off shuffle first so playback starts from first track
    if (queueState?.isShuffled) {
      toggleShuffle();
    }
    startQueue({
      sourceType: "smartPlaylist",
      sourceId: id,
      sourceName: smartPlaylist?.name,
      // Pass filter and sort options so server materializes with same order as displayed
      filters: debouncedFilter ? { filter: debouncedFilter } : undefined,
      sort:
        sortConfig.field !== "custom"
          ? {
              field: sortConfig.field,
              direction: sortConfig.direction,
            }
          : undefined,
    });
  };

  const handleShuffle = () => {
    if (loadedSongs.length === 0 || !id) return;
    startQueue({
      sourceType: "smartPlaylist",
      sourceId: id,
      sourceName: smartPlaylist?.name,
      shuffle: true,
      // Pass filter and sort options
      filters: debouncedFilter ? { filter: debouncedFilter } : undefined,
      sort:
        sortConfig.field !== "custom"
          ? {
              field: sortConfig.field,
              direction: sortConfig.direction,
            }
          : undefined,
    });
  };

  const handleDelete = async () => {
    if (!id) return;
    const client = getClient();
    if (!client) return;
    try {
      await client.deleteSmartPlaylist(id);
      toast.success("Smart playlist deleted");
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
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
      sourceName: `Selected from ${smartPlaylist?.name}`,
      songIds: selected.map((s) => s.id),
    });
    clearSelection();
  };

  const shuffleSelected = () => {
    const selected = getSelectedSongs();
    if (selected.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: `Selected from ${smartPlaylist?.name}`,
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

  // Use server-provided total duration
  const totalDuration = metadata?.totalDuration ?? 0;

  // Get cover art URL for smart playlist (uses sp- prefix for tiled cover generation)
  const coverUrl = id ? getClient()?.getCoverArtUrl(`sp-${id}`, 400) : null;
  const fullSizeCoverUrl = id
    ? getClient()?.getCoverArtUrl(`sp-${id}`, "large")
    : null;

  if (!id) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-muted-foreground">No playlist ID provided</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <DetailHeader
        showBackButton
        coverUrl={coverUrl}
        fullSizeCoverUrl={fullSizeCoverUrl}
        coverAlt={displayName}
        coverType="smartPlaylist"
        coverSize="lg"
        useBlurredBackground={!!coverUrl}
        icon={Sparkles}
        iconClassName="bg-linear-to-br from-purple-500 to-purple-800"
        gradientColor="rgba(168,85,247,0.2)"
        label="Smart Playlist"
        title={displayName}
        subtitle={
          !isLoading &&
          totalCount > 0 &&
          `${totalCount} songs • ${formatTotalDuration(totalDuration)}`
        }
        isLoading={isLoading}
      />

      {/* Breadcrumb navigation (only if playlist is in a folder) */}
      <PlaylistBreadcrumb playlistName={smartPlaylist?.name} />

      <ActionBar
        onPlayAll={handlePlay}
        onShuffle={handleShuffle}
        disablePlay={loadedSongs.length === 0}
        showShuffleOnMobile
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
        mobileFilter={
          <MobileFilterInput
            filter={filter}
            onFilterChange={setFilter}
            placeholder="Filter songs..."
          />
        }
        mobileMenuContent={
          <SongListMobileMenu
            onEditPlaylist={() => setEditDialogOpen(true)}
            onDeletePlaylist={() => setDeleteDialogOpen(true)}
            sortConfig={sortConfig}
            onSortChange={setSortConfig}
            showCustomSort
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
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Smart Playlist
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ActionBar>

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
        ) : totalCount > 0 || songs.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={songs}
              totalCount={totalCount || undefined}
              renderItem={(song: Song, index: number) => (
                <SongCard
                  song={song}
                  index={index}
                  inlineImagesRequested
                  queueSource={smartPlaylistQueueSource}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={handleSelect}
                  isCurrentQueuePosition={getIsCurrentQueuePosition(index)}
                />
              )}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(song: Song) => song.id}
              ensureRange={ensureRange}
            />
          ) : (
            <>
              <SongListHeader
                columnVisibility={columnVisibility}
                showIndex
                showCover
                sortConfig={sortConfig}
                onSortChange={setSortConfig}
              />
              <VirtualizedList
                items={songs}
                totalCount={totalCount || undefined}
                renderItem={(song: Song, index: number) => (
                  <SongRow
                    song={song}
                    index={index}
                    showCover
                    inlineImagesRequested
                    queueSource={smartPlaylistQueueSource}
                    isSelected={isSelected(song.id)}
                    isSelectionMode={hasSelection}
                    onSelect={handleSelect}
                    isCurrentQueuePosition={getIsCurrentQueuePosition(index)}
                    showAlbum={columnVisibility.album}
                    showArtist={columnVisibility.artist}
                    showDuration={columnVisibility.duration}
                    showPlayCount={columnVisibility.playCount}
                    showYear={columnVisibility.year}
                    showDateAdded={columnVisibility.dateAdded}
                    showLastPlayed={columnVisibility.lastPlayed}
                    showStarred={columnVisibility.starred}
                    showGenre={columnVisibility.genre}
                    showBitRate={columnVisibility.bitRate}
                    showFormat={columnVisibility.format}
                    showRating={columnVisibility.rating}
                  />
                )}
                renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
                getItemKey={(song: Song) => song.id}
                estimateItemHeight={56}
                ensureRange={ensureRange}
              />
            </>
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
              Are you sure you want to delete &quot;{smartPlaylist?.name}&quot;?
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
        <div className="min-h-dvh">
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
