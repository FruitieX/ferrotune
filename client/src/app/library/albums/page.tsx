"use client";

import { useAtom, useSetAtom } from "jotai";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { albumViewModeAtom } from "@/lib/store/ui";
import { playNowAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { AlbumCard, AlbumCardSkeleton, AlbumCardCompact } from "@/components/browse/album-card";
import { MediaRowSkeleton } from "@/components/shared/media-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import type { Album } from "@/lib/api/types";

const PAGE_SIZE = 50;

export default function AlbumsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [viewMode] = useAtom(albumViewModeAtom);
  const playNow = useSetAtom(playNowAtom);
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  // Fetch albums with infinite scroll
  const {
    data: albumsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["albums", "alphabetical"],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: "alphabeticalByName",
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
    enabled: isReady,
  });

  // Flatten albums from all pages
  const allAlbums = albumsData?.pages.flatMap((page) => page.albums) ?? [];
  const totalAlbums = albumsData?.pages[0]?.total ?? allAlbums.length;

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
              <MediaRowSkeleton key={i} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      {isLoading && allAlbums.length === 0 ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaRowSkeleton key={i} />
            ))}
          </div>
        )
      ) : allAlbums.length > 0 ? (
        viewMode === "grid" ? (
          <VirtualizedGrid
            items={allAlbums}
            totalCount={totalAlbums}
            renderItem={(album) => (
              <AlbumCard album={album} onPlay={() => handlePlayAlbum(album)} />
            )}
            renderSkeleton={() => <AlbumCardSkeleton />}
            getItemKey={(album) => album.id}
            hasNextPage={hasNextPage ?? false}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
        ) : (
          <VirtualizedList
            items={allAlbums}
            totalCount={totalAlbums}
            renderItem={(album) => (
              <AlbumCardCompact album={album} onPlay={() => handlePlayAlbum(album)} />
            )}
            renderSkeleton={() => (
              <MediaRowSkeleton />
            )}
            getItemKey={(album) => album.id}
            estimateItemHeight={56}
            hasNextPage={hasNextPage ?? false}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
        )
      ) : (
        <EmptyState message="No albums in your library" />
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
