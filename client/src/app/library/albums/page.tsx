"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useItemSelection } from "@/lib/hooks/use-track-selection";
import {
  albumViewModeAtom,
  libraryFilterAtom,
  librarySortAtom,
  advancedFiltersAtom,
} from "@/lib/store/ui";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { useInvalidateFavorites } from "@/lib/store/starred";
import { getClient } from "@/lib/api/client";
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
import { EmptyState } from "@/components/shared/empty-state";
import type { Song } from "@/lib/api/types";

const PAGE_SIZE = 50;

export default function AlbumsPage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const sortConfig = useAtomValue(librarySortAtom);
  const advancedFilters = useAtomValue(advancedFiltersAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const invalidateFavorites = useInvalidateFavorites();

  // Virtualized scroll restoration - pass viewMode to store separate positions per view
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration(
    "main-scroll-container",
    viewMode,
  );

  // Fetch albums using search3 with filters and sorting
  // Note: We request "medium" thumbnails for both views to prevent refetching when toggling view mode.
  const {
    data: albumsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "albums",
      "all",
      debouncedFilter, // Include filter in query key
      sortConfig.field,
      sortConfig.direction,
      advancedFilters,
      // Note: viewMode removed from query key to prevent refetching when toggling views
    ],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.search3({
        query: debouncedFilter || "*", // Use filter or wildcard to match all
        albumCount: PAGE_SIZE,
        albumOffset: pageParam,
        artistCount: 0,
        songCount: 0,
        albumSort: sortConfig.field,
        albumSortDir: sortConfig.direction,
        // Pass advanced filters (only album-applicable ones)
        minYear: advancedFilters.minYear,
        maxYear: advancedFilters.maxYear,
        genre: advancedFilters.genre,
        minRating: advancedFilters.minRating,
        maxRating: advancedFilters.maxRating,
        starredOnly: advancedFilters.starredOnly,
        // Request medium thumbnails for both views (prevents refetch on view toggle)
        inlineImages: "medium",
      });
      const albums = response.searchResult3.album ?? [];
      const total = response.searchResult3.albumTotal;
      return {
        albums,
        total,
        nextOffset:
          albums.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isReady,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Flatten albums from all pages
  const displayAlbums = albumsData?.pages.flatMap((page) => page.albums) ?? [];
  const totalAlbums = albumsData?.pages[0]?.total ?? displayAlbums.length;
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
      ) : displayAlbums.length > 0 ? (
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
            hasNextPage={hasNextPage ?? false}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
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
              />
            )}
            renderSkeleton={() => <MediaRowSkeleton showIndex />}
            getItemKey={(album) => album.id}
            estimateItemHeight={56}
            hasNextPage={hasNextPage ?? false}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
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
