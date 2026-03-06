"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { User } from "lucide-react";
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
  hasActiveFiltersAtom,
  libraryArtistColumnVisibilityAtom,
} from "@/lib/store/ui";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { useInvalidateFavorites } from "@/lib/store/starred";
import { getClient } from "@/lib/api/client";
import type { Artist, Song } from "@/lib/api/types";
import {
  ArtistCard,
  ArtistCardSkeleton,
  ArtistCardCompact,
} from "@/components/browse/artist-card";
import { MediaRowSkeleton } from "@/components/shared/media-row";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { ArtistListHeader } from "@/components/shared/song-list-header";
import { EmptyState } from "@/components/shared/empty-state";

const PAGE_SIZE = 50;

export default function ArtistsPage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const sortConfig = useAtomValue(librarySortAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const advancedFilters = useAtomValue(advancedFiltersAtom);
  const hasActiveFilters = useAtomValue(hasActiveFiltersAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const columnVisibility = useAtomValue(libraryArtistColumnVisibilityAtom);
  const invalidateFavorites = useInvalidateFavorites();

  // Virtualized scroll restoration
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration();

  // Fetch artists using sparse pagination for random-access scrolling
  const {
    items: rawArtists,
    totalCount: totalArtists,
    isLoading,
    isFetching: _isFetching,
    ensureRange,
  } = useSparsePagination<Artist>({
    queryKey: [
      "artists",
      "all",
      debouncedFilter,
      sortConfig.field,
      sortConfig.direction,
      advancedFilters,
      viewMode, // Include viewMode because inline image size depends on it
    ],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.search3({
        query: debouncedFilter || "*",
        artistCount: PAGE_SIZE,
        artistOffset: offset,
        albumCount: 0,
        songCount: 0,
        artistSort: sortConfig.field,
        artistSortDir: sortConfig.direction,
        starredOnly: advancedFilters.starredOnly,
        minRating: advancedFilters.minRating,
        maxRating: advancedFilters.maxRating,
        musicFolderId: advancedFilters.musicFolderId,
        artistFilter: advancedFilters.artistFilter,
        inlineImages: viewMode === "grid" ? "medium" : "small",
      });
      const artists = response.searchResult3.artist ?? [];
      const total = response.searchResult3.artistTotal ?? artists.length;
      return { items: artists, total };
    },
    enabled: isReady,
  });

  const displayArtists = rawArtists;
  const isLoadingData = isLoading;

  // Artist selection
  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedItems,
  } = useItemSelection(displayArtists);

  // Get songs from selected artists
  const getSelectedArtistsSongs = async (): Promise<Song[]> => {
    const client = getClient();
    if (!client) return [];

    const artists = getSelectedItems();
    const songsPromises = artists.map((artist) =>
      client.getArtist(artist.id).then((res) => res.artist.song ?? []),
    );
    const songsArrays = await Promise.all(songsPromises);
    return songsArrays.flat();
  };

  // Bulk action handlers
  const handlePlaySelected = async () => {
    const songs = await getSelectedArtistsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "library",
        sourceName: "Library",
        songIds: songs.map((s) => s.id),
      });
      clearSelection();
      toast.success(
        `Playing ${songs.length} songs from ${selectedCount} artists`,
      );
    }
  };

  const handleShuffleSelected = async () => {
    const songs = await getSelectedArtistsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "library",
        sourceName: "Library",
        songIds: songs.map((s) => s.id),
        shuffle: true,
      });
      clearSelection();
      toast.success(
        `Shuffling ${songs.length} songs from ${selectedCount} artists`,
      );
    }
  };

  const handleAddSelectedToQueue = async (position: "next" | "last") => {
    const songs = await getSelectedArtistsSongs();
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

    const artists = getSelectedItems();
    try {
      if (star) {
        await Promise.all(artists.map((a) => client.star({ artistId: a.id })));
        toast.success(`Added ${artists.length} artists to favorites`);
      } else {
        await Promise.all(
          artists.map((a) => client.unstar({ artistId: a.id })),
        );
        toast.success(`Removed ${artists.length} artists from favorites`);
      }
      invalidateFavorites("artist");
      clearSelection();
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  // Play artist handler - plays all songs by this artist
  const handlePlayArtist = (id: string) => {
    const artist = displayArtists.find((a) => a.id === id);
    if (!artist) return;
    startQueue({
      sourceType: "artist",
      sourceId: artist.id,
      sourceName: artist.name,
    });
  };

  if (authLoading) {
    return (
      <div className="p-4 lg:p-6">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <ArtistCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaRowSkeleton key={i} coverShape="circle" showIndex />
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
      {isLoadingData && displayArtists.length === 0 ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <ArtistCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaRowSkeleton key={i} coverShape="circle" showIndex />
            ))}
          </div>
        )
      ) : displayArtists.length > 0 || totalArtists > 0 ? (
        viewMode === "grid" ? (
          <VirtualizedGrid
            items={displayArtists}
            totalCount={totalArtists}
            renderItem={(artist) => (
              <ArtistCard
                artist={artist}
                onPlay={handlePlayArtist}
                isSelected={isSelected(artist.id)}
                isSelectionMode={hasSelection}
                onSelect={handleSelect}
              />
            )}
            renderSkeleton={() => <ArtistCardSkeleton />}
            getItemKey={(artist) => artist.id}
            ensureRange={ensureRange}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
          <>
            <ArtistListHeader
              columnVisibility={columnVisibility}
              showIndex={columnVisibility.showIndex}
            />
            <VirtualizedList
              items={displayArtists}
              totalCount={totalArtists}
              renderItem={(artist, index) => (
                <ArtistCardCompact
                  artist={artist}
                  index={columnVisibility.showIndex ? index : undefined}
                  onPlay={handlePlayArtist}
                  isSelected={isSelected(artist.id)}
                  isSelectionMode={hasSelection}
                  onSelect={handleSelect}
                  showAlbumCount={columnVisibility.albumCount}
                  showSongCount={columnVisibility.songCount}
                  showStarred={columnVisibility.starred}
                  showRating={columnVisibility.rating}
                />
              )}
              renderSkeleton={() => (
                <MediaRowSkeleton
                  coverShape="circle"
                  showIndex={columnVisibility.showIndex}
                />
              )}
              getItemKey={(artist) => artist.id}
              estimateItemHeight={56}
              ensureRange={ensureRange}
              initialOffset={getInitialOffset()}
              onScrollChange={saveOffset}
            />
          </>
        )
      ) : (
        <EmptyState
          icon={User}
          title={
            debouncedFilter || hasActiveFilters
              ? "No artists match your filters"
              : "No artists in your library"
          }
        />
      )}

      {/* Bulk actions bar */}
      <BulkActionsBar
        mediaType="artist"
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
