"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Heart, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import {
  applySearchTermsToQueueAtom,
  artistDetailViewModeAtom,
  artistDetailSortAtom,
  artistDetailColumnVisibilityAtom,
} from "@/lib/store/ui";
import { useStarredArtist } from "@/lib/store/starred";
import { getClient } from "@/lib/api/client";
import { queueTextFilter } from "@/lib/queue/source-filters";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
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
import { ArtistDropdownMenu } from "@/components/browse/artist-context-menu";
import { DetailHeader } from "@/components/shared/detail-header";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { ActionBar } from "@/components/shared/action-bar";
import {
  SongListToolbar,
  MobileFilterInput,
  AlbumDetailMobileMenu,
} from "@/components/shared/song-list-toolbar";
import { SongListHeader } from "@/components/shared/song-list-header";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { formatCount } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Album } from "@/lib/api/types";

function ArtistDetailContent() {
  const pageSize = 100;
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const startQueue = useSetAtom(startQueueAtom);
  const queryClient = useQueryClient();

  // Filter state
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 300);
  const applySearchTermsToQueue = useAtomValue(applySearchTermsToQueueAtom);

  // View settings
  const [viewMode, setViewMode] = useAtom(artistDetailViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(artistDetailSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(
    artistDetailColumnVisibilityAtom,
  );

  // Redirect to library if no ID
  useEffect(() => {
    if (!id && isMounted && !authLoading) {
      router.replace("/library");
    }
  }, [id, isMounted, authLoading, router]);

  const { data: artistData, isLoading: isArtistLoading } = useQuery({
    queryKey: ["artist", id],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getArtist(id!);
      return response.artist;
    },
    enabled: isReady && !!id,
  });

  const songsQuery = useInfiniteQuery({
    queryKey: [
      "artist-songs",
      id,
      sortConfig.field,
      sortConfig.direction,
      debouncedFilter,
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getArtistSongs(id!, {
        offset: pageParam,
        count: pageSize,
        sort: sortConfig.field === "custom" ? "name" : sortConfig.field,
        sortDir: sortConfig.direction,
        filter: debouncedFilter.trim() || null,
      });
    },
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.songs.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: isReady && !!id,
  });

  const albumsQuery = useInfiniteQuery({
    queryKey: ["artist-albums", id],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getArtistAlbums(id!, {
        offset: pageParam,
        count: pageSize,
      });
    },
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.albums.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: isReady && !!id,
  });

  // Use artist star hook - manages the starred state and handles API calls
  const { isStarred, toggleStar } = useStarredArtist(
    id ?? "",
    !!artistData?.starred,
  );

  // Handle starring with additional artist query invalidation
  const handleToggleStar = async () => {
    await toggleStar();
    // Also invalidate artist queries to update artist list views
    queryClient.invalidateQueries({ queryKey: ["artists"] });
    queryClient.invalidateQueries({ queryKey: ["artist", id] });
  };

  const displaySongs =
    songsQuery.data?.pages.flatMap((page) => page.songs) ?? [];
  const displayAlbums =
    albumsQuery.data?.pages.flatMap((page) => page.albums) ?? [];
  const totalSongs =
    songsQuery.data?.pages[0]?.total ?? artistData?.songCount ?? 0;
  const totalAlbums =
    albumsQuery.data?.pages[0]?.total ?? artistData?.albumCount ?? 0;

  // Queue source for artist songs - server materializes with same sort/filter
  const queueFilter = queueTextFilter(debouncedFilter, applySearchTermsToQueue);
  const artistQueueSource = {
    type: "artist" as QueueSourceType,
    id: id,
    name: artistData?.name ?? "Artist",
    filters: queueFilter,
    sort:
      sortConfig.field !== "custom"
        ? {
            field: sortConfig.field,
            direction: sortConfig.direction,
          }
        : undefined,
  };

  // Multi-selection support for songs
  const selection = useTrackSelection(displaySongs);

  const coverArtUrl = artistData?.coverArt
    ? getClient()?.getCoverArtUrl(artistData.coverArt, 400)
    : undefined;

  const fullSizeCoverUrl = artistData?.coverArt
    ? getClient()?.getCoverArtUrl(artistData.coverArt, "large")
    : undefined;

  const handlePlayAll = () => {
    if (id && displaySongs && displaySongs.length > 0) {
      startQueue({
        sourceType: "artist",
        sourceId: id,
        sourceName: artistData?.name,
        startIndex: 0,
        shuffle: false,
        filters: queueFilter,
        sort:
          sortConfig.field !== "custom"
            ? {
                field: sortConfig.field,
                direction: sortConfig.direction,
              }
            : undefined,
      });
    }
  };

  const handleShuffle = () => {
    if (id && displaySongs && displaySongs.length > 0) {
      startQueue({
        sourceType: "artist",
        sourceId: id,
        sourceName: artistData?.name,
        startIndex: 0,
        shuffle: true,
        filters: queueFilter,
        sort:
          sortConfig.field !== "custom"
            ? {
                field: sortConfig.field,
                direction: sortConfig.direction,
              }
            : undefined,
      });
    }
  };

  const handlePlaySelected = () => {
    const selectedSongs = selection.getSelectedSongs();
    if (selectedSongs.length > 0) {
      startQueue({
        sourceType: "other",
        sourceName: `${artistData?.name} (selection)`,
        songIds: selectedSongs.map((s) => s.id),
        shuffle: false,
      });
      selection.clearSelection();
    }
  };

  const handlePlayAlbum = async (album: Album) => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
      startIndex: 0,
      shuffle: false,
    });
  };

  // Always render the same loading state on server and during hydration
  // This prevents hydration mismatches
  if (!isMounted || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }

  if (!id) {
    return null;
  }

  return (
    <div className="min-h-dvh">
      {/* Header with blurred background */}
      <DetailHeader
        showBackButton
        coverUrl={coverArtUrl}
        fullSizeCoverUrl={fullSizeCoverUrl}
        coverAlt={artistData?.name || "Artist"}
        colorSeed={artistData?.name}
        coverType="artist"
        circular
        coverSize="md"
        useBlurredBackground
        label="Artist"
        title={artistData?.name || "Artist"}
        isLoading={isArtistLoading}
        subtitle={formatCount(artistData?.albumCount ?? 0, "album")}
      />

      {/* Action bar - only show toolbar for songs, not albums */}
      <ActionBar
        onPlayAll={handlePlayAll}
        onShuffle={handleShuffle}
        disablePlay={songsQuery.isLoading || totalSongs === 0}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          onClick={handleToggleStar}
          disabled={!artistData}
        >
          <Heart
            className={cn("w-5 h-5", isStarred && "fill-red-500 text-red-500")}
          />
        </Button>
        {artistData && (
          <ArtistDropdownMenu
            artist={artistData}
            onPlay={handlePlayAll}
            onShuffle={handleShuffle}
            trigger={
              <Button variant="ghost" size="icon" className="h-10 w-10">
                <MoreHorizontal className="w-5 h-5" />
              </Button>
            }
          />
        )}
      </ActionBar>

      {/* Albums section */}
      <div className="p-4 lg:p-6 mt-2">
        <h2 className="text-xl font-bold mb-6">Albums</h2>
        {albumsQuery.isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        ) : displayAlbums.length > 0 ? (
          <VirtualizedGrid
            items={displayAlbums}
            renderItem={(album) => (
              <AlbumCard album={album} onPlay={() => handlePlayAlbum(album)} />
            )}
            renderSkeleton={() => <AlbumCardSkeleton />}
            getItemKey={(album) => album.id}
            totalCount={totalAlbums}
            hasNextPage={albumsQuery.hasNextPage}
            isFetchingNextPage={albumsQuery.isFetchingNextPage}
            fetchNextPage={() => {
              void albumsQuery.fetchNextPage();
            }}
            autoScrollMargin
          />
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            No albums found
          </div>
        )}
      </div>

      {/* Songs section with toolbar */}
      <div className="p-4 lg:p-6">
        <div className="flex items-center gap-2 mb-6">
          <h2 className="text-xl font-bold">Songs</h2>
          {/* Mobile filter input */}
          <div className="flex-1 md:hidden">
            <MobileFilterInput
              filter={filter}
              onFilterChange={setFilter}
              placeholder="Filter songs..."
            />
          </div>
          {/* Mobile overflow menu */}
          <div className="md:hidden">
            <AlbumDetailMobileMenu
              sortConfig={sortConfig}
              onSortChange={setSortConfig}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
            />
          </div>
          {/* Desktop toolbar */}
          <div className="hidden md:block ml-auto">
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
            />
          </div>
        </div>
        {songsQuery.isLoading ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <SongCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <SongRowSkeleton key={i} showCover />
              ))}
            </div>
          )
        ) : displaySongs.length > 0 ? (
          <div className={cn("", selection.hasSelection && "select-none")}>
            {viewMode === "grid" ? (
              <VirtualizedGrid
                items={displaySongs}
                renderItem={(song, index) => (
                  <SongCard
                    song={song}
                    index={index}
                    queueSource={artistQueueSource}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={selection.handleSelect}
                  />
                )}
                renderSkeleton={() => <SongCardSkeleton />}
                getItemKey={(song) => song.id}
                totalCount={totalSongs}
                hasNextPage={songsQuery.hasNextPage}
                isFetchingNextPage={songsQuery.isFetchingNextPage}
                fetchNextPage={() => {
                  void songsQuery.fetchNextPage();
                }}
                autoScrollMargin
              />
            ) : (
              <>
                <SongListHeader
                  columnVisibility={columnVisibility}
                  showCover
                  sortConfig={sortConfig}
                  onSortChange={setSortConfig}
                />
                <VirtualizedList
                  items={displaySongs}
                  renderItem={(song, index) => (
                    <SongRow
                      song={song}
                      index={columnVisibility.trackNumber ? index : undefined}
                      showCover
                      showArtist={columnVisibility.artist}
                      showAlbum={columnVisibility.album}
                      showDuration={columnVisibility.duration}
                      showPlayCount={columnVisibility.playCount}
                      showPlayStarts={columnVisibility.playStarts}
                      showYear={columnVisibility.year}
                      showDateAdded={columnVisibility.dateAdded}
                      showLastPlayed={columnVisibility.lastPlayed}
                      showStarred={columnVisibility.starred}
                      showGenre={columnVisibility.genre}
                      showBitRate={columnVisibility.bitRate}
                      showFormat={columnVisibility.format}
                      showRating={columnVisibility.rating}
                      queueSource={artistQueueSource}
                      isSelected={selection.isSelected(song.id)}
                      isSelectionMode={selection.hasSelection}
                      onSelect={selection.handleSelect}
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
                  totalCount={totalSongs}
                  hasNextPage={songsQuery.hasNextPage}
                  isFetchingNextPage={songsQuery.isFetchingNextPage}
                  fetchNextPage={() => {
                    void songsQuery.fetchNextPage();
                  }}
                  autoScrollMargin
                />
              </>
            )}
          </div>
        ) : debouncedFilter.trim() ? (
          <EmptyFilterState message="No songs match your filter" />
        ) : (
          <EmptyState
            title="No songs found"
            description="This artist doesn't have any songs yet."
          />
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selection.selectedCount}
        onClear={selection.clearSelection}
        onPlayNow={handlePlaySelected}
        onPlayNext={() => selection.addSelectedToQueue("next")}
        onAddToQueue={() => selection.addSelectedToQueue("end")}
        onStar={() => selection.starSelected(true)}
        onUnstar={() => selection.starSelected(false)}
        onSelectAll={selection.selectAll}
        getSelectedSongs={selection.getSelectedSongs}
      />

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}

export default function ArtistDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-dvh">
          <Skeleton className="w-32 h-8" />
        </div>
      }
    >
      <ArtistDetailContent />
    </Suspense>
  );
}
