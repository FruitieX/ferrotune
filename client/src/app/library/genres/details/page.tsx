"use client";

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAtom, useSetAtom } from "jotai";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Tag } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import { genreDetailViewModeAtom, genreDetailSortAtom, genreDetailColumnVisibilityAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { formatCount } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Album } from "@/lib/api/types";

const PAGE_SIZE = 50;

function GenreDetailContent() {
  const searchParams = useSearchParams();
  const encodedName = searchParams.get("name");
  const genreName = encodedName ? decodeURIComponent(encodedName) : null;
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const startQueue = useSetAtom(startQueueAtom);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  // Filter state
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 300);
  
  // View settings
  const [viewMode, setViewMode] = useAtom(genreDetailViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(genreDetailSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(genreDetailColumnVisibilityAtom);

  // Redirect to library if no name
  useEffect(() => {
    if (!genreName && isMounted && !authLoading) {
      router.replace("/library");
    }
  }, [genreName, isMounted, authLoading, router]);

  // Generate color from genre name for the header gradient
  const hash = (genreName ?? "").split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const hue = Math.abs(hash % 360);

  // Fetch genre info from genres list
  const { data: genreInfo, isLoading: loadingGenreInfo } = useQuery({
    queryKey: ["genres"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getGenres();
      return response.genres?.genre ?? [];
    },
    enabled: isReady,
    select: (genres) => genres.find((g) => g.value === genreName),
  });

  // Fetch albums by genre with infinite scroll
  const {
    data: albumsData,
    isLoading: loadingAlbums,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["albums", "byGenre", genreName],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: "byGenre",
        genre: genreName!,
        size: PAGE_SIZE,
        offset: pageParam,
      });
      return {
        albums: response.albumList2.album ?? [],
        nextOffset: response.albumList2.album?.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isReady && !!genreName,
  });

  // Fetch songs by genre with infinite scroll - server-side sort/filter
  const {
    data: songsData,
    isLoading: loadingSongs,
    fetchNextPage: fetchNextSongsPage,
    hasNextPage: hasNextSongsPage,
    isFetchingNextPage: isFetchingNextSongsPage,
  } = useInfiniteQuery({
    queryKey: ["songs", "byGenre", genreName, sortConfig.field, sortConfig.direction, debouncedFilter],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getSongsByGenre(genreName!, {
        count: PAGE_SIZE,
        offset: pageParam,
        sort: sortConfig.field !== "custom" ? sortConfig.field : undefined,
        sortDir: sortConfig.field !== "custom" ? sortConfig.direction : undefined,
        filter: debouncedFilter.trim() || undefined,
      });
      return {
        songs: response.songsByGenre.song ?? [],
        nextOffset: (response.songsByGenre.song?.length ?? 0) === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isReady && !!genreName,
  });

  // Intersection observer for infinite scroll (albums)
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "200px",
      threshold: 0,
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [handleObserver]);

  // Flatten albums from all pages
  const allAlbums = albumsData?.pages.flatMap((page) => page.albums) ?? [];

  // Flatten songs from all pages - already sorted and filtered by server
  const displaySongs = songsData?.pages.flatMap((page) => page.songs) ?? [];
  
  // Queue source for genre songs - server materializes with same sort
  const genreQueueSource = useMemo(() => ({
    type: "genre" as QueueSourceType,
    id: genreName,
    name: genreName ?? "Genre",
    sort: sortConfig.field !== "custom" ? {
      field: sortConfig.field,
      direction: sortConfig.direction,
    } : undefined,
  }), [genreName, sortConfig.field, sortConfig.direction]);
  
  // Multi-selection support for songs
  const selection = useTrackSelection(displaySongs);

  // Get songs from genre for play
  const handlePlayAll = () => {
    if (!genreName) return;
    startQueue({
      sourceType: "genre",
      sourceId: genreName,
      sourceName: genreName,
      startIndex: 0,
      shuffle: false,
      sort: sortConfig.field !== "custom" ? {
        field: sortConfig.field,
        direction: sortConfig.direction,
      } : undefined,
    });
  };

  const handleShuffle = () => {
    if (!genreName) return;
    startQueue({
      sourceType: "genre",
      sourceId: genreName,
      sourceName: genreName,
      startIndex: 0,
      shuffle: true,
      sort: sortConfig.field !== "custom" ? {
        field: sortConfig.field,
        direction: sortConfig.direction,
      } : undefined,
    });
  };

  const handlePlaySelected = () => {
    const selectedSongs = selection.getSelectedSongs();
    if (selectedSongs.length > 0) {
      startQueue({
        sourceType: "other",
        sourceName: `${genreName} (selection)`,
        songIds: selectedSongs.map(s => s.id),
      });
      selection.clearSelection();
    }
  };

  const handlePlayAlbum = (album: Album) => {
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
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }

  if (!genreName) {
    return null;
  }

  return (
    <div className="min-h-screen">
      {/* Header with gradient background */}
      <DetailHeader
        showBackButton
        icon={Tag}
        iconClassName={`bg-linear-to-br from-[hsl(${hue},70%,40%)] to-[hsl(${hue},70%,25%)]`}
        gradientColor={`hsl(${hue}, 70%, 25%)`}
        label="Genre"
        title={genreName}
        isLoading={loadingGenreInfo}
        subtitle={
          genreInfo && (
            <>
              <span>{formatCount(genreInfo.albumCount, "album")}</span>
              <span>•</span>
              <span>{formatCount(genreInfo.songCount, "song")}</span>
            </>
          )
        }
      />

      {/* Action bar */}
      <ActionBar
        onPlayAll={handlePlayAll}
        onShuffle={handleShuffle}
        disablePlay={loadingSongs && displaySongs.length === 0}
      />

      {/* Albums section */}
      <div className="p-4 lg:p-6 mt-2">
        <h2 className="text-xl font-bold mb-6">Albums</h2>
        {loadingAlbums && allAlbums.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        ) : allAlbums.length > 0 ? (
          <motion.div 
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.05 } },
            }}
          >
            {allAlbums.map((album) => (
              <motion.div
                key={album.id}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 },
                }}
              >
                <AlbumCard album={album} onPlay={() => handlePlayAlbum(album)} />
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="py-10 text-center text-muted-foreground">
            No albums found in this genre
          </div>
        )}
        {/* Infinite scroll trigger for albums */}
        <div ref={loadMoreRef} className="h-10" />
        {isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <Skeleton className="w-8 h-8 rounded-full" />
          </div>
        )}
      </div>

      {/* Songs section with toolbar */}
      <div className="p-4 lg:p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Songs</h2>
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
        {loadingSongs && displaySongs.length === 0 ? (
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
                    queueSource={genreQueueSource}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={selection.handleSelect}
                  />
                )}
                renderSkeleton={() => <SongCardSkeleton />}
                getItemKey={(song) => song.id}
              />
            ) : (
              <VirtualizedList
                items={displaySongs}
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
                    queueSource={genreQueueSource}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={selection.handleSelect}
                  />
                )}
                renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
                getItemKey={(song) => song.id}
                estimateItemHeight={56}
                hasNextPage={hasNextSongsPage}
                isFetchingNextPage={isFetchingNextSongsPage}
                fetchNextPage={fetchNextSongsPage}
              />
            )}
          </div>
        ) : debouncedFilter.trim() ? (
          <EmptyFilterState message="No songs match your filter" />
        ) : (
          <EmptyState
            title="No songs found"
            description="There are no songs in this genre yet."
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

export default function GenreDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="w-32 h-8" />
      </div>
    }>
      <GenreDetailContent />
    </Suspense>
  );
}
