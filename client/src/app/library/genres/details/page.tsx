"use client";

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAtom, useSetAtom } from "jotai";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { genreDetailViewModeAtom, genreDetailSortAtom, genreDetailColumnVisibilityAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { ActionBar } from "@/components/shared/action-bar";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { formatCount } from "@/lib/utils/format";
import { sortSongs } from "@/lib/utils/sort-songs";
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
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
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

  // Fetch songs by genre with infinite scroll
  const {
    data: songsData,
    isLoading: loadingSongs,
    fetchNextPage: fetchNextSongsPage,
    hasNextPage: hasNextSongsPage,
    isFetchingNextPage: isFetchingNextSongsPage,
  } = useInfiniteQuery({
    queryKey: ["songs", "byGenre", genreName],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getSongsByGenre(genreName!, { count: PAGE_SIZE, offset: pageParam });
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

  // Flatten songs from all pages
  const allSongs = songsData?.pages.flatMap((page) => page.songs) ?? [];
  
  // Filter and sort songs
  const displaySongs = useMemo(() => {
    let filtered = allSongs;
    
    if (debouncedFilter.trim()) {
      const query = debouncedFilter.toLowerCase();
      filtered = allSongs.filter(song =>
        song.title?.toLowerCase().includes(query) ||
        song.artist?.toLowerCase().includes(query) ||
        song.album?.toLowerCase().includes(query)
      );
    }
    
    if (sortConfig.field !== "custom") {
      return sortSongs(filtered, sortConfig.field, sortConfig.direction);
    }
    
    return filtered;
  }, [allSongs, debouncedFilter, sortConfig]);
  
  // Multi-selection support for songs
  const selection = useTrackSelection(displaySongs);

  // Get songs from genre for play
  const handlePlayAll = async () => {
    // If we have filtered/sorted songs, play those
    if (displaySongs.length > 0) {
      setIsShuffled(false);
      playNow(displaySongs);
      return;
    }
    
    // Otherwise fetch all songs for the genre
    const client = getClient();
    if (!client || !genreName) return;

    try {
      const response = await client.getSongsByGenre(genreName, { count: 500 });
      if (response.songsByGenre.song && response.songsByGenre.song.length > 0) {
        setIsShuffled(false);
        playNow(response.songsByGenre.song);
      }
    } catch (error) {
      console.error("Failed to play genre:", error);
    }
  };

  const handleShuffle = async () => {
    // If we have filtered/sorted songs, shuffle those
    if (displaySongs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...displaySongs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      return;
    }
    
    // Otherwise fetch all songs for the genre
    const client = getClient();
    if (!client || !genreName) return;

    try {
      const response = await client.getSongsByGenre(genreName, { count: 500 });
      if (response.songsByGenre.song && response.songsByGenre.song.length > 0) {
        setIsShuffled(true);
        const shuffled = [...response.songsByGenre.song].sort(() => Math.random() - 0.5);
        playNow(shuffled);
      }
    } catch (error) {
      console.error("Failed to shuffle genre:", error);
    }
  };

  const handlePlaySelected = () => {
    const selectedSongs = selection.getSelectedSongs();
    if (selectedSongs.length > 0) {
      playNow(selectedSongs);
      selection.clearSelection();
    }
  };

  const handlePlayAlbum = async (album: Album) => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getAlbum(album.id);
      if (response.album.song && response.album.song.length > 0) {
        playNow(response.album.song);
      }
    } catch (error) {
      console.error("Failed to play album:", error);
    }
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
      <div className="relative overflow-hidden">
        {/* Background gradient based on genre color */}
        <div 
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, hsl(${hue}, 70%, 25%) 0%, rgba(10,10,10,1) 100%)`
          }}
        />

        {/* Back button */}
        <div className="relative z-10 p-4 lg:p-6">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-background/50 hover:bg-background/80"
            onClick={() => router.back()}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </div>

        {/* Genre header */}
        <div className="relative z-10 px-4 lg:px-6 pb-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col"
          >
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Genre
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mt-2 text-foreground">
              {genreName}
            </h1>
            {loadingGenreInfo ? (
              <Skeleton className="h-5 w-48 mt-4" />
            ) : genreInfo ? (
              <p className="mt-4 text-muted-foreground">
                {formatCount(genreInfo.albumCount, "album")} • {formatCount(genreInfo.songCount, "song")}
              </p>
            ) : null}
          </motion.div>
        </div>
      </div>

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
        {loadingSongs && allSongs.length === 0 ? (
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
                renderItem={(song) => (
                  <SongCard
                    song={song}
                    queueSongs={displaySongs}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={(e) => selection.handleSelect(song.id, e)}
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
                    queueSongs={displaySongs}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={(e) => selection.handleSelect(song.id, e)}
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
        ) : allSongs.length > 0 ? (
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
        onAddToQueue={() => selection.addSelectedToQueue("last")}
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
