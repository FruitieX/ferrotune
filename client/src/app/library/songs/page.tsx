"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { getClient } from "@/lib/api/client";
import { SongRow, SongRowSkeleton } from "@/components/browse/song-row";
import { VirtualizedList } from "@/components/shared/virtualized-grid";

const PAGE_SIZE = 50;

export default function SongsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

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

  if (authLoading) {
    return (
      <div className="p-4 lg:p-6">
        <div className="divide-y divide-border/50">
          {Array.from({ length: 10 }).map((_, i) => (
            <SongRowSkeleton key={i} showCover />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      {isLoading && allSongs.length === 0 ? (
        <div className="divide-y divide-border/50">
          {Array.from({ length: 10 }).map((_, i) => (
            <SongRowSkeleton key={i} showCover />
          ))}
        </div>
      ) : allSongs.length > 0 ? (
        <VirtualizedList
          items={allSongs}
          totalCount={totalSongs}
          renderItem={(song, index) => (
            <SongRow
              song={song}
              index={index}
              showCover
              queueSongs={allSongs}
            />
          )}
          renderSkeleton={() => <SongRowSkeleton showCover />}
          getItemKey={(song) => song.id}
          estimateItemHeight={56}
          hasNextPage={hasNextPage ?? false}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
        />
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
