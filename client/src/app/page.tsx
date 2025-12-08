"use client";

import { useSetAtom } from "jotai";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Play, Clock, Sparkles, TrendingUp, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import type { Album, Song } from "@/lib/api/types";

// Helper to fetch all songs for albums
async function fetchAlbumsSongs(albums: Album[]): Promise<Song[]> {
  const client = getClient();
  if (!client || !albums.length) return [];

  try {
    const songsPromises = albums.map((album) =>
      client.getAlbum(album.id).then((res) => res.album.song ?? []),
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
                <AlbumCard album={album} onPlay={() => onPlayAlbum(album)} />
              </motion.div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm py-8">
              No albums found
            </p>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
}

export default function HomePage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const startQueue = useSetAtom(startQueueAtom);
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
      const response = await client.getAlbumList2({
        type: "frequent",
        size: 10,
      });
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

  // Play album - uses server-side queue
  const handlePlayAlbum = async (album: Album) => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
      startIndex: 0,
      shuffle: false,
    });
  };

  // Play all albums in a section - fetch songs and start with explicit IDs
  const handlePlayAllAlbums = async (
    albums: Album[] | undefined,
    sectionName: string,
  ) => {
    if (!albums?.length) return;

    toast.loading("Loading songs...");
    const songs = await fetchAlbumsSongs(albums);
    toast.dismiss();

    if (songs.length > 0) {
      startQueue({
        sourceType: "other",
        sourceName: sectionName,
        startIndex: 0,
        shuffle: false,
        songIds: songs.map((s) => s.id),
      });
      toast.success(`Playing ${songs.length} songs`);
    } else {
      toast.error("No songs found");
    }
  };

  // Shuffle all albums in a section
  const handleShuffleAllAlbums = async (
    albums: Album[] | undefined,
    sectionName: string,
  ) => {
    if (!albums?.length) return;

    toast.loading("Loading songs...");
    const songs = await fetchAlbumsSongs(albums);
    toast.dismiss();

    if (songs.length > 0) {
      startQueue({
        sourceType: "other",
        sourceName: sectionName,
        startIndex: 0,
        shuffle: true,
        songIds: songs.map((s) => s.id),
      });
      toast.success(`Shuffling ${songs.length} songs`);
    } else {
      toast.error("No songs found");
    }
  };

  // Always render the same loading state on server and during hydration
  // This prevents hydration mismatches
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
          <div className="flex items-center justify-between h-16 px-4 lg:px-6">
            <h1 className="text-2xl font-bold">Home</h1>
          </div>
        </header>

        {/* Content skeleton */}
        <div className="py-6 space-y-8">
          {/* Four sections */}
          {Array.from({ length: 4 }).map((_, sectionIndex) => (
            <section key={sectionIndex} className="space-y-4">
              <div className="flex items-center gap-2 px-4 lg:px-6">
                <Skeleton className="w-5 h-5" />
                <Skeleton className="h-7 w-48" />
              </div>
              <div className="flex gap-4 px-4 lg:px-6 pb-4 overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="w-[180px] shrink-0">
                    <AlbumCardSkeleton />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
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
          onPlayAll={() => handlePlayAllAlbums(newestAlbums, "Recently Added")}
          onShuffleAll={() =>
            handleShuffleAllAlbums(newestAlbums, "Recently Added")
          }
        />

        {/* Continue Listening (Recently Played) */}
        <AlbumSection
          title="Continue Listening"
          icon={Play}
          albums={recentAlbums}
          isLoading={loadingRecent}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() =>
            handlePlayAllAlbums(recentAlbums, "Continue Listening")
          }
          onShuffleAll={() =>
            handleShuffleAllAlbums(recentAlbums, "Continue Listening")
          }
        />

        {/* Most Played */}
        <AlbumSection
          title="Most Played"
          icon={TrendingUp}
          albums={frequentAlbums}
          isLoading={loadingFrequent}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() => handlePlayAllAlbums(frequentAlbums, "Most Played")}
          onShuffleAll={() =>
            handleShuffleAllAlbums(frequentAlbums, "Most Played")
          }
        />

        {/* Discover */}
        <AlbumSection
          title="Discover Something New"
          icon={Sparkles}
          albums={randomAlbums}
          isLoading={loadingRandom}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() => handlePlayAllAlbums(randomAlbums, "Discover")}
          onShuffleAll={() => handleShuffleAllAlbums(randomAlbums, "Discover")}
        />
      </div>
    </div>
  );
}
