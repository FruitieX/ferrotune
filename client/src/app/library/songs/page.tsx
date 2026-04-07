"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { useSparsePagination } from "@/lib/hooks/use-sparse-pagination";
import {
  albumViewModeAtom,
  libraryFilterAtom,
  librarySortAtom,
  columnVisibilityAtom,
  advancedFiltersAtom,
} from "@/lib/store/ui";
import {
  startQueueAtom,
  serverQueueStateAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import { getCurrentQueuePositionMatch } from "@/lib/queue/current-position";
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
  const setSortConfig = useSetAtom(librarySortAtom);
  const columnVisibility = useAtomValue(columnVisibilityAtom);
  const advancedFilters = useAtomValue(advancedFiltersAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const startQueue = useSetAtom(startQueueAtom);
  const queueState = useAtomValue(serverQueueStateAtom);

  // Virtualized scroll restoration - pass viewMode to store separate positions per view
  const {
    getInitialOffset,
    saveOffset,
    getScrollToIndex,
    saveFirstVisibleIndex,
  } = useVirtualizedScrollRestoration("main-scroll-container", viewMode);

  // Fetch songs using sparse pagination for random-access scrolling
  // Server-side sorting is applied via songSort and songSortDir parameters
  // Advanced filters are passed to the API
  // Note: We request "medium" thumbnails for both views to prevent refetching when toggling view mode.
  const {
    items: displaySongs,
    totalCount: totalSongs,
    isLoading,
    isFetching: _isFetching,
    ensureRange,
  } = useSparsePagination<Song>({
    queryKey: [
      "songs",
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
        songCount: PAGE_SIZE,
        songOffset: offset,
        artistCount: 0,
        albumCount: 0,
        songSort: sortConfig.field,
        songSortDir: sortConfig.direction,
        ...advancedFilters,
        inlineImages: "medium",
      });
      const songs = response.searchResult3.song ?? [];
      const total = response.searchResult3.songTotal ?? songs.length;
      return { items: songs, total };
    },
    enabled: isReady,
  });

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

  const getIsCurrentQueuePosition = (index: number): boolean | undefined => {
    return getCurrentQueuePositionMatch({
      queueState,
      expectedSource: {
        type: queueSource.type,
        filters: queueSource.filters,
        sort: queueSource.sort,
      },
      displayIndex: index,
    });
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
        shuffle: false,
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
      ) : displaySongs.length > 0 || totalSongs > 0 ? (
        viewMode === "grid" ? (
          <VirtualizedGrid
            items={displaySongs}
            totalCount={totalSongs}
            renderItem={(song, index) => (
              <SongCard
                song={song}
                index={index}
                isCurrentQueuePosition={getIsCurrentQueuePosition(index)}
                inlineImagesRequested
                queueSource={queueSource}
                isSelected={isSelected(song.id)}
                isSelectionMode={hasSelection}
                onSelect={handleSelect}
              />
            )}
            renderSkeleton={() => <SongCardSkeleton />}
            getItemKey={(song) => song.id}
            ensureRange={ensureRange}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
            scrollToIndex={getScrollToIndex()}
            onFirstVisibleIndexChange={saveFirstVisibleIndex}
          />
        ) : (
          <>
            <SongListHeader
              columnVisibility={columnVisibility}
              showCover
              stickyTop="auto"
              sortConfig={sortConfig}
              onSortChange={setSortConfig}
            />
            <VirtualizedList
              items={displaySongs}
              totalCount={totalSongs}
              renderItem={(song, index) => (
                <SongRow
                  song={song}
                  index={columnVisibility.trackNumber ? index : undefined}
                  songIndex={index}
                  isCurrentQueuePosition={getIsCurrentQueuePosition(index)}
                  showCover
                  inlineImagesRequested
                  showArtist={columnVisibility.artist}
                  showAlbum={columnVisibility.album}
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
                  queueSource={queueSource}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={handleSelect}
                />
              )}
              renderSkeleton={() => (
                <SongRowSkeleton
                  showCover
                  showIndex={columnVisibility.trackNumber}
                />
              )}
              getItemKey={(song) => song.id}
              estimateItemHeight={56}
              ensureRange={ensureRange}
              initialOffset={getInitialOffset()}
              onScrollChange={saveOffset}
              scrollToIndex={getScrollToIndex()}
              onFirstVisibleIndexChange={saveFirstVisibleIndex}
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
