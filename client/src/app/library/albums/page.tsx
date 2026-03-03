"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Music } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useItemSelection } from "@/lib/hooks/use-track-selection";
import { useSparsePagination } from "@/lib/hooks/use-sparse-pagination";
import {
  albumViewModeAtom,
  libraryFilterAtom,
  librarySortAtom,
  advancedFiltersAtom,
  libraryAlbumColumnVisibilityAtom,
} from "@/lib/store/ui";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { useInvalidateFavorites } from "@/lib/store/starred";
import { getClient } from "@/lib/api/client";
import type { Album, Song } from "@/lib/api/types";
import {
  AlbumCard,
  AlbumCardSkeleton,
  AlbumCardCompact,
} from "@/components/browse/album-card";
import { MediaRowSkeleton } from "@/components/shared/media-row";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { AlbumListHeader } from "@/components/shared/song-list-header";
import { EmptyState } from "@/components/shared/empty-state";

const PAGE_SIZE = 50;

export default function AlbumsPage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const sortConfig = useAtomValue(librarySortAtom);
  const advancedFilters = useAtomValue(advancedFiltersAtom);
  const columnVisibility = useAtomValue(libraryAlbumColumnVisibilityAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const invalidateFavorites = useInvalidateFavorites();

  // Virtualized scroll restoration - pass viewMode to store separate positions per view
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration(
    "main-scroll-container",
    viewMode,
  );

  // Fetch albums using sparse pagination for random-access scrolling
  // Note: We request "medium" thumbnails for both views to prevent refetching when toggling view mode.
  const {
    items: displayAlbums,
    totalCount: totalAlbums,
    isLoading,
    isFetching: _isFetching,
    ensureRange,
  } = useSparsePagination<Album>({
    queryKey: [
      "albums",
      "all",
      debouncedFilter,
      sortConfig.field,
      sortConfig.direction,
      advancedFilters,
    ],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.search3({
        query: debouncedFilter || "*",
        albumCount: PAGE_SIZE,
        albumOffset: offset,
        artistCount: 0,
        songCount: 0,
        albumSort: sortConfig.field,
        albumSortDir: sortConfig.direction,
        minYear: advancedFilters.minYear,
        maxYear: advancedFilters.maxYear,
        genre: advancedFilters.genre,
        minRating: advancedFilters.minRating,
        maxRating: advancedFilters.maxRating,
        starredOnly: advancedFilters.starredOnly,
        musicFolderId: advancedFilters.musicFolderId,
        artistFilter: advancedFilters.artistFilter,
        inlineImages: "medium",
      });
      const albums = response.searchResult3.album ?? [];
      const total = response.searchResult3.albumTotal ?? albums.length;
      return { items: albums, total };
    },
    enabled: isReady,
  });

  const isLoadingData = isLoading;

  // Album selection
  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedItems,
  } = useItemSelection(displayAlbums);

  // Get songs from selected albums
  const getSelectedAlbumsSongs = async (): Promise<Song[]> => {
    const client = getClient();
    if (!client) return [];

    const albums = getSelectedItems();
    const songsPromises = albums.map((album) =>
      client.getAlbum(album.id).then((res) => res.album.song ?? []),
    );
    const songsArrays = await Promise.all(songsPromises);
    return songsArrays.flat();
  };

  // Bulk action handlers
  const handlePlaySelected = async () => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "library",
        sourceName: "Library",
        songIds: songs.map((s) => s.id),
      });
      clearSelection();
      toast.success(
        `Playing ${songs.length} songs from ${selectedCount} albums`,
      );
    }
  };

  const handleShuffleSelected = async () => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "library",
        sourceName: "Library",
        songIds: songs.map((s) => s.id),
        shuffle: true,
      });
      clearSelection();
      toast.success(
        `Shuffling ${songs.length} songs from ${selectedCount} albums`,
      );
    }
  };

  const handleAddSelectedToQueue = async (position: "next" | "last") => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      addToQueue({
        songIds: songs.map((s) => s.id),
        position: position === "last" ? "end" : position,
      });
      clearSelection();
      toast.success(
        `Added ${songs.length} songs to ${position === "next" ? "play next" : "queue"}`,
      );
    }
  };

  const handleStarSelected = async (star: boolean) => {
    const client = getClient();
    if (!client) return;

    const albums = getSelectedItems();
    try {
      if (star) {
        await Promise.all(albums.map((a) => client.star({ albumId: a.id })));
        toast.success(`Added ${albums.length} albums to favorites`);
      } else {
        await Promise.all(albums.map((a) => client.unstar({ albumId: a.id })));
        toast.success(`Removed ${albums.length} albums from favorites`);
      }
      invalidateFavorites("album");
      clearSelection();
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  // Play album handler - accepts id for stable callback reference
  const handlePlayAlbum = (id: string) => {
    const album = displayAlbums.find((a) => a.id === id);
    if (album) {
      startQueue({
        sourceType: "album",
        sourceId: album.id,
        sourceName: album.name,
      });
    }
  };

  if (authLoading) {
    return (
      <div className="p-4 lg:p-6">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaRowSkeleton key={i} showIndex />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "p-4 lg:p-6",
        hasSelection && "select-none-during-selection",
      )}
    >
      {isLoadingData && displayAlbums.length === 0 ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaRowSkeleton key={i} showIndex />
            ))}
          </div>
        )
      ) : displayAlbums.length > 0 || totalAlbums > 0 ? (
        viewMode === "grid" ? (
          <VirtualizedGrid
            items={displayAlbums}
            totalCount={totalAlbums}
            renderItem={(album) => (
              <AlbumCard
                album={album}
                onPlay={handlePlayAlbum}
                isSelected={isSelected(album.id)}
                isSelectionMode={hasSelection}
                onSelect={handleSelect}
              />
            )}
            renderSkeleton={() => <AlbumCardSkeleton />}
            getItemKey={(album) => album.id}
            ensureRange={ensureRange}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
          <>
            <AlbumListHeader columnVisibility={columnVisibility} showIndex />
            <VirtualizedList
              items={displayAlbums}
              totalCount={totalAlbums}
              renderItem={(album, index) => (
                <AlbumCardCompact
                  album={album}
                  index={index}
                  onPlay={handlePlayAlbum}
                  isSelected={isSelected(album.id)}
                  isSelectionMode={hasSelection}
                  onSelect={handleSelect}
                  showArtist={columnVisibility.artist}
                  showYear={columnVisibility.year}
                  showSongCount={columnVisibility.songCount}
                  showDuration={columnVisibility.duration}
                  showGenre={columnVisibility.genre}
                  showStarred={columnVisibility.starred}
                  showRating={columnVisibility.rating}
                  showDateAdded={columnVisibility.dateAdded}
                />
              )}
              renderSkeleton={() => <MediaRowSkeleton showIndex />}
              getItemKey={(album) => album.id}
              estimateItemHeight={56}
              ensureRange={ensureRange}
              initialOffset={getInitialOffset()}
              onScrollChange={saveOffset}
            />
          </>
        )
      ) : (
        <EmptyState
          icon={Music}
          title={
            debouncedFilter
              ? "No albums match your filter"
              : "No albums in your library"
          }
        />
      )}

      {/* Bulk actions bar */}
      <BulkActionsBar
        mediaType="album"
        selectedCount={selectedCount}
        onClear={clearSelection}
        onPlayNow={handlePlaySelected}
        onShuffle={handleShuffleSelected}
        onPlayNext={() => handleAddSelectedToQueue("next")}
        onAddToQueue={() => handleAddSelectedToQueue("last")}
        onStar={() => handleStarSelected(true)}
        onUnstar={() => handleStarSelected(false)}
        onSelectAll={selectAll}
        getSelectedItems={getSelectedItems}
      />
    </div>
  );
}
