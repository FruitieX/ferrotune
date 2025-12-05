"use client";

import { useMemo } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { albumViewModeAtom, libraryFilterAtom, librarySortAtom, columnVisibilityAtom, advancedFiltersAtom, hasActiveFiltersAtom } from "@/lib/store/ui";
import { startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import type { Song } from "@/lib/api/types";

const PAGE_SIZE = 50;

export default function SongsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const sortConfig = useAtomValue(librarySortAtom);
  const columnVisibility = useAtomValue(columnVisibilityAtom);
  const advancedFilters = useAtomValue(advancedFiltersAtom);
  const hasActiveFilters = useAtomValue(hasActiveFiltersAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const startQueue = useSetAtom(startQueueAtom);
  
  // Virtualized scroll restoration
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration();

  // Fetch all songs using search with wildcard (when no filter)
  // Server-side sorting is applied via songSort and songSortDir parameters
  // Advanced filters are passed to the API
  const {
    data: songsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["songs", "all", sortConfig.field, sortConfig.direction, advancedFilters],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      // Use search with an empty-ish query to get all songs, paginated
      // Pass sort parameters to server for server-side sorting
      const response = await client.search3({
        query: "*", // Wildcard to match all
        songCount: PAGE_SIZE,
        songOffset: pageParam,
        artistCount: 0,
        albumCount: 0,
        songSort: sortConfig.field,
        songSortDir: sortConfig.direction,
        // Pass advanced filters
        ...advancedFilters,
      });
      const songs = response.searchResult3.song ?? [];
      const total = response.searchResult3.songTotal;
      return {
        songs,
        total,
        nextOffset: songs.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isReady && !debouncedFilter,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Search songs when filter is active (also with server-side sorting)
  const { data: searchData, isLoading: isSearching } = useQuery({
    queryKey: ["songs", "search", debouncedFilter, sortConfig.field, sortConfig.direction, advancedFilters],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.search3({
        query: debouncedFilter,
        songCount: 200,
        artistCount: 0,
        albumCount: 0,
        songSort: sortConfig.field,
        songSortDir: sortConfig.direction,
        // Pass advanced filters
        ...advancedFilters,
      });
      return response.searchResult3.song ?? [];
    },
    enabled: isReady && debouncedFilter.length >= 1,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Flatten songs from all pages
  const allSongs = songsData?.pages.flatMap((page) => page.songs) ?? [];
  const totalSongs = songsData?.pages[0]?.total ?? allSongs.length;
  
  // Use search results when filtering, otherwise use paginated list
  // Sorting is now handled server-side, no need for client-side sorting
  const displaySongs = debouncedFilter ? (searchData ?? []) : allSongs;

  const displayCount = debouncedFilter ? displaySongs.length : totalSongs;
  const isLoadingData = debouncedFilter ? isSearching : isLoading;

  // Build queue source with filters and sort for server-side materialization
  const queueSource = useMemo(() => ({
    type: (debouncedFilter ? "search" : "library") as QueueSourceType,
    name: debouncedFilter ? `Search: ${debouncedFilter}` : "Library",
    filters: {
      query: debouncedFilter || "*",
      ...advancedFilters,
    },
    sort: {
      field: sortConfig.field,
      direction: sortConfig.direction,
    },
  }), [debouncedFilter, advancedFilters, sortConfig]);

  // Build search params for "select all" functionality
  const searchParamsForSelection = useMemo(() => ({
    query: debouncedFilter || "*",
    songSort: sortConfig.field,
    songSortDir: sortConfig.direction,
    ...advancedFilters,
  }), [debouncedFilter, sortConfig, advancedFilters]);

  // Track selection with support for selecting all songs from backend
  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    selectedIds,
    getSelectedSongs,
    addSelectedToQueue,
    starSelected,
  } = useTrackSelection(displaySongs, {
    totalCount: displayCount,
    searchParams: searchParamsForSelection,
  });

  const handlePlaySelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length > 0) {
      startQueue({
        sourceType: "library",
        sourceName: "Library (selection)",
        songIds: ids,
      });
      clearSelection();
    }
  };

  if (authLoading) {
    return (
      <div className="p-4 lg:p-6">
        {viewMode === "grid" ? (
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
        )}
      </div>
    );
  }

  return (
    <div className={cn("p-4 lg:p-6", hasSelection && "select-none-during-selection")}>
      {isLoadingData && displaySongs.length === 0 ? (
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
            totalCount={displayCount}
            renderItem={(song) => (
              <SongCard
                song={song}
                queueSongs={displaySongs}
                queueSource={queueSource}
                isSelected={isSelected(song.id)}
                isSelectionMode={hasSelection}
                onSelect={(e) => handleSelect(song.id, e)}
              />
            )}
            renderSkeleton={() => <SongCardSkeleton />}
            getItemKey={(song) => song.id}
            hasNextPage={!debouncedFilter && (hasNextPage ?? false)}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
          <VirtualizedList
            items={displaySongs}
            totalCount={displayCount}
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
                queueSource={queueSource}
                isSelected={isSelected(song.id)}
                isSelectionMode={hasSelection}
                onSelect={(e) => handleSelect(song.id, e)}
              />
            )}
            renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
            getItemKey={(song) => song.id}
            estimateItemHeight={56}
            hasNextPage={!debouncedFilter && (hasNextPage ?? false)}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        )
      ) : (
        <EmptyState message={debouncedFilter ? "No songs match your filter" : "No songs in your library"} />
      )}

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedCount}
        onClear={clearSelection}
        onPlayNow={handlePlaySelected}
        onPlayNext={() => addSelectedToQueue("next")}
        onAddToQueue={() => addSelectedToQueue("end")}
        onStar={() => starSelected(true)}
        onUnstar={() => starSelected(false)}
        onSelectAll={selectAll}
        getSelectedSongs={getSelectedSongs}
        selectedIds={selectedIds}
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
