"use client";

import { useAtom, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { albumViewModeAtom } from "@/lib/store/ui";
import { playNowAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { ArtistCard, ArtistCardSkeleton, ArtistCardCompact } from "@/components/browse/artist-card";
import { MediaRowSkeleton } from "@/components/shared/media-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import type { Artist } from "@/lib/api/types";

export default function ArtistsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [viewMode] = useAtom(albumViewModeAtom);
  const playNow = useSetAtom(playNowAtom);
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  // Fetch artists
  const { data: artistsData, isLoading } = useQuery({
    queryKey: ["artists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getArtists();
      return response.artists.index;
    },
    enabled: isReady,
  });

  // Flatten artists from indexes, filter out artists with 0 albums
  const allArtists = artistsData?.flatMap((index) => index.artist).filter((a) => a.albumCount > 0) ?? [];

  // Play artist handler
  const handlePlayArtist = async (artist: Artist) => {
    const client = getClient();
    if (!client) return;

    try {
      const artistData = await client.getArtist(artist.id);
      // Get first album's songs
      if (artistData.artist.album?.length > 0) {
        const firstAlbum = await client.getAlbum(artistData.artist.album[0].id);
        if (firstAlbum.album.song?.length > 0) {
          playNow(firstAlbum.album.song);
        }
      }
    } catch (error) {
      console.error("Failed to play artist:", error);
    }
  };

  if (authLoading) {
    return (
      <div className="p-4 lg:p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <ArtistCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      {isLoading ? (
        <div className={viewMode === "grid"
          ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          : "space-y-1"
        }>
          {Array.from({ length: 12 }).map((_, i) => (
            <ArtistCardSkeleton key={i} />
          ))}
        </div>
      ) : allArtists.length > 0 ? (
        viewMode === "grid" ? (
          <VirtualizedGrid
            items={allArtists}
            renderItem={(artist) => (
              <ArtistCard artist={artist} onPlay={() => handlePlayArtist(artist)} />
            )}
            renderSkeleton={() => <ArtistCardSkeleton />}
            getItemKey={(artist) => artist.id}
          />
        ) : (
          <VirtualizedList
            items={allArtists}
            renderItem={(artist) => (
              <ArtistCardCompact artist={artist} onPlay={() => handlePlayArtist(artist)} />
            )}
            renderSkeleton={() => (
              <MediaRowSkeleton coverShape="circle" />
            )}
            getItemKey={(artist) => artist.id}
            estimateItemHeight={56}
          />
        )
      ) : (
        <EmptyState message="No artists in your library" />
      )}
    </div>
  );
}

// Empty state component
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
        <User className="w-10 h-10 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
