"use client";

import { useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { albumViewModeAtom, libraryFilterAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";

const PAGE_SIZE = 50;

export default function SongsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  
  // Virtualized scroll restoration
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration();

  // Fetch all songs using search with wildcard
  const {
    data: songsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["songs", "all"],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      // Use search with an empty-ish query to get all songs, paginated
      const response = await client.search3({
        query: "*", // Wildcard to match all
        songCount: PAGE_SIZE,
        songOffset: pageParam,
        artistCount: 0,
        albumCount: 0,
      });
      const songs = response.searchResult3.song ?? [];
      const total = response.searchResult3.songTotal;
      // Sort alphabetically by title
      songs.sort((a, b) => a.title.localeCompare(b.title));
      return {
        songs,
        total,
        nextOffset: songs.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isReady,
  });

  // Flatten songs from all pages
  const allSongs = songsData?.pages.flatMap((page) => page.songs) ?? [];
  const totalSongs = songsData?.pages[0]?.total ?? allSongs.length;
  
  // Filter songs based on search filter
  const filteredSongs = useMemo(() => {
    if (!filter.trim()) return allSongs;
    const lowerFilter = filter.toLowerCase();
    return allSongs.filter((song) =>
      song.title?.toLowerCase().includes(lowerFilter) ||
      song.artist?.toLowerCase().includes(lowerFilter) ||
      song.album?.toLowerCase().includes(lowerFilter)
    );
  }, [allSongs, filter]);
  
  const displayCount = filter ? filteredSongs.length : totalSongs;

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
              <SongRowSkeleton key={i} showCover showIndex={false} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      {isLoading && allSongs.length === 0 ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <SongCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <SongRowSkeleton key={i} showCover showIndex={false} />
            ))}
          </div>
        )
      ) : allSongs.length > 0 ? (
        viewMode === "grid" ? (
          <VirtualizedGrid
            items={filteredSongs}
            totalCount={displayCount}
            renderItem={(song) => (
              <SongCard song={song} queueSongs={filteredSongs} />
            )}
            renderSkeleton={() => <SongCardSkeleton />}
            getItemKey={(song) => song.id}
            hasNextPage={!filter && (hasNextPage ?? false)}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
          <VirtualizedList
            items={filteredSongs}
            totalCount={displayCount}
            renderItem={(song, index) => (
              <SongRow
                song={song}
                index={index}
                showCover
                queueSongs={filteredSongs}
              />
            )}
            renderSkeleton={() => <SongRowSkeleton showCover showIndex={false} />}
            getItemKey={(song) => song.id}
            estimateItemHeight={56}
            hasNextPage={!filter && (hasNextPage ?? false)}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        )
      ) : (
        <EmptyState message="No songs in your library" />
      )}
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
