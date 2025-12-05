"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useItemSelection } from "@/lib/hooks/use-track-selection";
import { albumViewModeAtom, libraryFilterAtom, librarySortAtom, advancedFiltersAtom, hasActiveFiltersAtom } from "@/lib/store/ui";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { AlbumCard, AlbumCardSkeleton, AlbumCardCompact } from "@/components/browse/album-card";
import { MediaRowSkeleton } from "@/components/shared/media-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import type { Album, Song } from "@/lib/api/types";

const PAGE_SIZE = 50;

export default function AlbumsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const sortConfig = useAtomValue(librarySortAtom);
  const advancedFilters = useAtomValue(advancedFiltersAtom);
  const hasActiveFilters = useAtomValue(hasActiveFiltersAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  
  // Virtualized scroll restoration
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration();

  // Fetch albums using search3 with filters and sorting
  const {
    data: albumsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["albums", "all", sortConfig.field, sortConfig.direction, advancedFilters],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.search3({
        query: "*", // Wildcard to match all
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
      });
      const albums = response.searchResult3.album ?? [];
      const total = response.searchResult3.albumTotal;
      return {
        albums,
        total,
        nextOffset: albums.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isReady && !debouncedFilter,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Search albums when filter is active (with server-side sorting and filters)
  const { data: searchData, isLoading: isSearching } = useQuery({
    queryKey: ["albums", "search", debouncedFilter, sortConfig.field, sortConfig.direction, advancedFilters],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.search3({
        query: debouncedFilter,
        albumCount: 100,
        artistCount: 0,
        songCount: 0,
        albumSort: sortConfig.field,
        albumSortDir: sortConfig.direction,
        // Pass advanced filters
        minYear: advancedFilters.minYear,
        maxYear: advancedFilters.maxYear,
        genre: advancedFilters.genre,
        minRating: advancedFilters.minRating,
        maxRating: advancedFilters.maxRating,
        starredOnly: advancedFilters.starredOnly,
      });
      return response.searchResult3.album ?? [];
    },
    enabled: isReady && debouncedFilter.length >= 1,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Flatten albums from all pages
  const allAlbums = albumsData?.pages.flatMap((page) => page.albums) ?? [];
  const totalAlbums = albumsData?.pages[0]?.total ?? allAlbums.length;
  
  // Use search results when filtering, otherwise use paginated list
  const displayAlbums = debouncedFilter ? (searchData ?? []) : allAlbums;
  const displayCount = debouncedFilter ? displayAlbums.length : totalAlbums;
  const isLoadingData = debouncedFilter ? isSearching : isLoading;

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
    const songsPromises = albums.map(album => 
      client.getAlbum(album.id).then(res => res.album.song ?? [])
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
        songIds: songs.map(s => s.id),
      });
      clearSelection();
      toast.success(`Playing ${songs.length} songs from ${selectedCount} albums`);
    }
  };

  const handleShuffleSelected = async () => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "library",
        sourceName: "Library",
        songIds: songs.map(s => s.id),
        shuffle: true,
      });
      clearSelection();
      toast.success(`Shuffling ${songs.length} songs from ${selectedCount} albums`);
    }
  };

  const handleAddSelectedToQueue = async (position: "next" | "last") => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      addToQueue({ songIds: songs.map(s => s.id), position: position === "last" ? "end" : position });
      clearSelection();
      toast.success(`Added ${songs.length} songs to ${position === "next" ? "play next" : "queue"}`);
    }
  };

  const handleStarSelected = async (star: boolean) => {
    const client = getClient();
    if (!client) return;
    
    const albums = getSelectedItems();
    try {
      if (star) {
        await Promise.all(albums.map(a => client.star({ albumId: a.id })));
        toast.success(`Added ${albums.length} albums to favorites`);
      } else {
        await Promise.all(albums.map(a => client.unstar({ albumId: a.id })));
        toast.success(`Removed ${albums.length} albums from favorites`);
      }
      clearSelection();
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  // Play album handler
  const handlePlayAlbum = async (album: Album) => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
    });
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
    <div className={cn("p-4 lg:p-6", hasSelection && "select-none-during-selection")}>
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
            totalCount={displayCount}
            renderItem={(album) => (
              <AlbumCard 
                album={album} 
                onPlay={() => handlePlayAlbum(album)}
                isSelected={isSelected(album.id)}
                isSelectionMode={hasSelection}
                onSelect={(e) => handleSelect(album.id, e)}
              />
            )}
            renderSkeleton={() => <AlbumCardSkeleton />}
            getItemKey={(album) => album.id}
            hasNextPage={!debouncedFilter && (hasNextPage ?? false)}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
          <VirtualizedList
            items={displayAlbums}
            totalCount={displayCount}
            renderItem={(album, index) => (
              <AlbumCardCompact 
                album={album} 
                index={index}
                onPlay={() => handlePlayAlbum(album)}
                isSelected={isSelected(album.id)}
                isSelectionMode={hasSelection}
                onSelect={(e) => handleSelect(album.id, e)}
              />
            )}
            renderSkeleton={() => (
              <MediaRowSkeleton showIndex />
            )}
            getItemKey={(album) => album.id}
            estimateItemHeight={56}
            hasNextPage={!debouncedFilter && (hasNextPage ?? false)}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        )
      ) : (
        <EmptyState message={debouncedFilter ? "No albums match your filter" : "No albums in your library"} />
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

// Empty state component
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
        <Music className="w-10 h-10 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
