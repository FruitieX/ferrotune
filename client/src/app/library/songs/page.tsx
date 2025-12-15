"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import {
  albumViewModeAtom,
  libraryFilterAtom,
  librarySortAtom,
  columnVisibilityAtom,
  advancedFiltersAtom,
} from "@/lib/store/ui";
import { startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import {
  SongRow,
  SongRowSkeleton,
  SongCard,
  SongCardSkeleton,
} from "@/components/browse/song-row";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { SongListHeader } from "@/components/shared/song-list-header";
import { EmptyState } from "@/components/shared/empty-state";

const PAGE_SIZE = 50;

export default function SongsPage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const sortConfig = useAtomValue(librarySortAtom);
  const columnVisibility = useAtomValue(columnVisibilityAtom);
  const advancedFilters = useAtomValue(advancedFiltersAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const startQueue = useSetAtom(startQueueAtom);

  // Virtualized scroll restoration - pass viewMode to store separate positions per view
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration(
    "main-scroll-container",
    viewMode,
  );

  // Fetch all songs using search with wildcard (when no filter)
  // Server-side sorting is applied via songSort and songSortDir parameters
  // Advanced filters are passed to the API
  // Note: We request "medium" thumbnails for both views to prevent refetching when toggling view mode.
  // The list view will downscale the larger thumbnails.
  const {
    data: songsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "songs",
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
      // Use search with filter or wildcard to get all songs, paginated
      // Pass sort parameters to server for server-side sorting
      const response = await client.search3({
        query: debouncedFilter || "*", // Use filter or wildcard to match all
        songCount: PAGE_SIZE,
        songOffset: pageParam,
        artistCount: 0,
        albumCount: 0,
        songSort: sortConfig.field,
        songSortDir: sortConfig.direction,
        // Pass advanced filters
        ...advancedFilters,
        // Request medium thumbnails for both views (prevents refetch on view toggle)
        inlineImages: "medium",
      });
      const songs = response.searchResult3.song ?? [];
      const total = response.searchResult3.songTotal;
      return {
        songs,
        total,
        nextOffset:
          songs.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isReady,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Flatten songs from all pages
  const displaySongs = songsData?.pages.flatMap((page) => page.songs) ?? [];
  const totalSongs = songsData?.pages[0]?.total ?? displaySongs.length;
  const isLoadingData = isLoading;

  // Build queue source with filters and sort for server-side materialization
  const queueSource = {
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
  };

  // Build search params for "select all" functionality
  const searchParamsForSelection = {
    query: debouncedFilter || "*",
    songSort: sortConfig.field,
    songSortDir: sortConfig.direction,
    ...advancedFilters,
  };

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
    totalCount: totalSongs,
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
    <div
      className={cn(
        "p-4 lg:p-6",
        hasSelection && "select-none-during-selection",
      )}
    >
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
            totalCount={totalSongs}
            renderItem={(song, index) => (
              <SongCard
                song={song}
                index={index}
                queueSource={queueSource}
                isSelected={isSelected(song.id)}
                isSelectionMode={hasSelection}
                onSelect={handleSelect}
              />
            )}
            renderSkeleton={() => <SongCardSkeleton />}
            getItemKey={(song) => song.id}
            hasNextPage={hasNextPage ?? false}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
          <>
            <SongListHeader
              columnVisibility={columnVisibility}
              showIndex
              showCover
              stickyTop="120px"
            />
            <VirtualizedList
              items={displaySongs}
              totalCount={totalSongs}
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
                  showLastPlayed={columnVisibility.lastPlayed}
                  queueSource={queueSource}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={handleSelect}
                />
              )}
              renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
              getItemKey={(song) => song.id}
              estimateItemHeight={56}
              hasNextPage={hasNextPage ?? false}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
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
              ? "No songs match your filter"
              : "No songs in your library"
          }
        />
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
