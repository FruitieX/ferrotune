"use client";

import { useSetAtom } from "jotai";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Play, Clock, Sparkles, TrendingUp, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import type { Album, Song } from "@/lib/api/types";

// Helper to fetch all songs for albums
async function fetchAlbumsSongs(albums: Album[]): Promise<Song[]> {
  const client = getClient();
  if (!client || !albums.length) return [];
  
  try {
    const songsPromises = albums.map(album => 
      client.getAlbum(album.id).then(res => res.album.song ?? [])
    );
    const songsArrays = await Promise.all(songsPromises);
    return songsArrays.flat();
  } catch (error) {
    console.error("Failed to fetch songs:", error);
    return [];
  }
}

// Section component for album rows
function AlbumSection({
  title,
  icon: Icon,
  albums,
  isLoading,
  onPlayAlbum,
  onPlayAll,
  onShuffleAll,
}: {
  title: string;
  icon: React.ElementType;
  albums?: Album[];
  isLoading: boolean;
  onPlayAlbum: (album: Album) => void;
  onPlayAll?: () => void;
  onShuffleAll?: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 px-4 lg:px-6">
        <Icon className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-bold">{title}</h2>
        {/* Play all and shuffle buttons */}
        {albums && albums.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onPlayAll}
                  disabled={isLoading}
                >
                  <Play className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Play all</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onShuffleAll}
                  disabled={isLoading}
                >
                  <Shuffle className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Shuffle all</TooltipContent>
            </Tooltip>
          </div>
        )}
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
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const isMounted = useIsMounted();

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
        setIsShuffled(false);
        playNow(response.album.song);
      }
    } catch (error) {
      console.error("Failed to play album:", error);
    }
  };

  // Play all albums in a section
  const handlePlayAllAlbums = async (albums: Album[] | undefined) => {
    if (!albums?.length) return;
    
    toast.loading("Loading songs...");
    const songs = await fetchAlbumsSongs(albums);
    toast.dismiss();
    
    if (songs.length > 0) {
      setIsShuffled(false);
      playNow(songs);
      toast.success(`Playing ${songs.length} songs`);
    } else {
      toast.error("No songs found");
    }
  };

  // Shuffle all albums in a section
  const handleShuffleAllAlbums = async (albums: Album[] | undefined) => {
    if (!albums?.length) return;
    
    toast.loading("Loading songs...");
    const songs = await fetchAlbumsSongs(albums);
    toast.dismiss();
    
    if (songs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      toast.success(`Shuffling ${songs.length} songs`);
    } else {
      toast.error("No songs found");
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
          onPlayAll={() => handlePlayAllAlbums(newestAlbums)}
          onShuffleAll={() => handleShuffleAllAlbums(newestAlbums)}
        />

        {/* Continue Listening (Recently Played) */}
        <AlbumSection
          title="Continue Listening"
          icon={Play}
          albums={recentAlbums}
          isLoading={loadingRecent}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() => handlePlayAllAlbums(recentAlbums)}
          onShuffleAll={() => handleShuffleAllAlbums(recentAlbums)}
        />

        {/* Most Played */}
        <AlbumSection
          title="Most Played"
          icon={TrendingUp}
          albums={frequentAlbums}
          isLoading={loadingFrequent}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() => handlePlayAllAlbums(frequentAlbums)}
          onShuffleAll={() => handleShuffleAllAlbums(frequentAlbums)}
        />

        {/* Discover */}
        <AlbumSection
          title="Discover Something New"
          icon={Sparkles}
          albums={randomAlbums}
          isLoading={loadingRandom}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() => handlePlayAllAlbums(randomAlbums)}
          onShuffleAll={() => handleShuffleAllAlbums(randomAlbums)}
        />
      </div>
    </div>
  );
}
