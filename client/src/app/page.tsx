"use client";

import { useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Play, Clock, Sparkles, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { playNowAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import type { Album } from "@/lib/api/types";

// Section component for album rows
function AlbumSection({
  title,
  icon: Icon,
  albums,
  isLoading,
  onPlayAlbum,
}: {
  title: string;
  icon: React.ElementType;
  albums?: Album[];
  isLoading: boolean;
  onPlayAlbum: (album: Album) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 px-4 lg:px-6">
        <Icon className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      
      <ScrollArea className="w-full">
        <div className="flex gap-4 px-4 lg:px-6 pb-4">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-[180px] shrink-0">
                <AlbumCardSkeleton />
              </div>
            ))
          ) : albums && albums.length > 0 ? (
            albums.map((album) => (
              <motion.div 
                key={album.id} 
                className="w-[180px] shrink-0"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <AlbumCard
                  album={album}
                  onPlay={() => onPlayAlbum(album)}
                />
              </motion.div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm py-8">No albums found</p>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
}

export default function HomePage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const playNow = useSetAtom(playNowAtom);

  // Fetch recently added albums
  const { data: newestAlbums, isLoading: loadingNewest } = useQuery({
    queryKey: ["albums", "newest"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({ type: "newest", size: 10 });
      return response.albumList2.album;
    },
    enabled: isReady,
  });

  // Fetch random albums
  const { data: randomAlbums, isLoading: loadingRandom } = useQuery({
    queryKey: ["albums", "random"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({ type: "random", size: 10 });
      return response.albumList2.album;
    },
    enabled: isReady,
  });

  // Fetch most played albums
  const { data: frequentAlbums, isLoading: loadingFrequent } = useQuery({
    queryKey: ["albums", "frequent"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({ type: "frequent", size: 10 });
      return response.albumList2.album;
    },
    enabled: isReady,
  });

  // Fetch recently played albums
  const { data: recentAlbums, isLoading: loadingRecent } = useQuery({
    queryKey: ["albums", "recent"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({ type: "recent", size: 10 });
      return response.albumList2.album;
    },
    enabled: isReady,
  });

  // Play album
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

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between h-16 px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Home</h1>
        </div>
      </header>

      {/* Content */}
      <div className="py-6 space-y-8">
        {/* Recently Added */}
        <AlbumSection
          title="Recently Added"
          icon={Clock}
          albums={newestAlbums}
          isLoading={loadingNewest}
          onPlayAlbum={handlePlayAlbum}
        />

        {/* Continue Listening (Recently Played) */}
        <AlbumSection
          title="Continue Listening"
          icon={Play}
          albums={recentAlbums}
          isLoading={loadingRecent}
          onPlayAlbum={handlePlayAlbum}
        />

        {/* Most Played */}
        <AlbumSection
          title="Most Played"
          icon={TrendingUp}
          albums={frequentAlbums}
          isLoading={loadingFrequent}
          onPlayAlbum={handlePlayAlbum}
        />

        {/* Discover */}
        <AlbumSection
          title="Discover Something New"
          icon={Sparkles}
          albums={randomAlbums}
          isLoading={loadingRandom}
          onPlayAlbum={handlePlayAlbum}
        />
      </div>
    </div>
  );
}
