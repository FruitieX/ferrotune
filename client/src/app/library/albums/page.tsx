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
import { albumViewModeAtom, libraryFilterAtom, librarySortAtom } from "@/lib/store/ui";
import { playNowAtom, addToQueueAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { AlbumCard, AlbumCardSkeleton, AlbumCardCompact } from "@/components/browse/album-card";
import { MediaRowSkeleton } from "@/components/shared/media-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import type { Album, AlbumListType, Song } from "@/lib/api/types";

const PAGE_SIZE = 50;

// Map sort config to getAlbumList2 type parameter
function getSortType(field: string, direction: string): AlbumListType {
  // Note: getAlbumList2 has limited sorting options compared to search3
  // For full sorting support, we'd need to use search3 for albums too
  switch (field) {
    case "artist":
      return "alphabeticalByArtist";
    case "year":
      return "byYear";
    case "dateAdded":
      return "newest";
    case "name":
    default:
      return "alphabeticalByName";
  }
}

export default function AlbumsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const sortConfig = useAtomValue(librarySortAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  
  // Virtualized scroll restoration
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration();

  // Get the appropriate list type for the current sort
  const listType = getSortType(sortConfig.field, sortConfig.direction);

  // Fetch albums with infinite scroll (when no filter)
  // Note: getAlbumList2 doesn't support desc sorting for all types, 
  // so for now we use what's available
  const {
    data: albumsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["albums", listType, sortConfig.direction],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: listType,
        size: PAGE_SIZE,
        offset: pageParam,
      });
      return {
        albums: response.albumList2.album ?? [],
        total: response.albumList2.total,
        nextOffset: response.albumList2.album?.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isReady && !debouncedFilter,
  });

  // Search albums when filter is active (with server-side sorting)
  const { data: searchData, isLoading: isSearching } = useQuery({
    queryKey: ["albums", "search", debouncedFilter, sortConfig.field, sortConfig.direction],
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
      });
      return response.searchResult3.album ?? [];
    },
    enabled: isReady && debouncedFilter.length >= 1,
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
      playNow(songs);
      clearSelection();
      toast.success(`Playing ${songs.length} songs from ${selectedCount} albums`);
    }
  };

  const handleShuffleSelected = async () => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      clearSelection();
      toast.success(`Shuffling ${songs.length} songs from ${selectedCount} albums`);
    }
  };

  const handleAddSelectedToQueue = async (position: "next" | "last") => {
    const client = getClient();
    if (!client) return;
    
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      songs.forEach(song => addToQueue(song, position));
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
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getAlbum(album.id);
      if (response.album.song?.length > 0) {
        playNow(response.album.song);
      }
    } catch (error) {
      console.error("Failed to play album:", error);
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
