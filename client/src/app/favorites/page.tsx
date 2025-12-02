"use client";

import { useState, useMemo } from "react";
import { useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Heart, Play, Shuffle, Search, X } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { ArtistCard, ArtistCardSkeleton } from "@/components/browse/artist-card";
import { TrackList } from "@/components/browse/track-list";
import { formatCount, formatTotalDuration } from "@/lib/utils/format";
import type { Album } from "@/lib/api/types";

type TabValue = "songs" | "albums" | "artists";

export default function FavoritesPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const [activeTab, setActiveTab] = useState<TabValue>("songs");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  // Fetch starred items
  const { data: starredData, isLoading } = useQuery({
    queryKey: ["starred"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getStarred2();
      return response.starred2;
    },
    enabled: isReady,
  });

  const songs = starredData?.song ?? [];
  const albums = starredData?.album ?? [];
  const artists = starredData?.artist ?? [];

  // Filter items based on search query
  const filteredSongs = useMemo(() => {
    if (!debouncedSearch.trim()) return songs;
    const query = debouncedSearch.toLowerCase();
    return songs.filter(song => 
      song.title.toLowerCase().includes(query) ||
      song.artist?.toLowerCase().includes(query) ||
      song.album?.toLowerCase().includes(query)
    );
  }, [songs, debouncedSearch]);

  const filteredAlbums = useMemo(() => {
    if (!debouncedSearch.trim()) return albums;
    const query = debouncedSearch.toLowerCase();
    return albums.filter(album => 
      album.name.toLowerCase().includes(query) ||
      album.artist?.toLowerCase().includes(query)
    );
  }, [albums, debouncedSearch]);

  const filteredArtists = useMemo(() => {
    if (!debouncedSearch.trim()) return artists;
    const query = debouncedSearch.toLowerCase();
    return artists.filter(artist => 
      artist.name.toLowerCase().includes(query)
    );
  }, [artists, debouncedSearch]);

  const totalDuration = filteredSongs.reduce((acc, song) => acc + song.duration, 0);

  // Get the description based on active tab
  const getSubtitle = () => {
    switch (activeTab) {
      case "songs":
        return `${formatCount(filteredSongs.length, "song")} • ${formatTotalDuration(totalDuration)}`;
      case "albums":
        return formatCount(filteredAlbums.length, "album");
      case "artists":
        return formatCount(filteredArtists.length, "artist");
    }
  };

  const handlePlayAll = () => {
    if (filteredSongs.length > 0) {
      setIsShuffled(false);
      playNow(filteredSongs);
    }
  };

  const handleShuffle = () => {
    if (filteredSongs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...filteredSongs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
    }
  };

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

  // Always render the same loading state on server and during hydration
  // This prevents hydration mismatches
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen">
        {/* Header skeleton */}
        <div className="relative">
          <div className="absolute inset-0 h-[300px] bg-gradient-to-b from-red-500/20 to-background" />
          <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
            <div className="flex items-center gap-6">
              <Skeleton className="w-48 h-48 rounded-lg" />
              <div>
                <Skeleton className="h-4 w-16 mb-2" />
                <Skeleton className="h-12 w-48 mb-4" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
        </div>
        {/* Action buttons skeleton */}
        <div className="px-4 lg:px-6 py-4 border-b border-border">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-28 rounded-full" />
            <Skeleton className="h-12 w-28 rounded-full" />
          </div>
        </div>
        {/* Track list skeleton */}
        <div className="px-4 lg:px-6 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="w-8 h-4" />
              <Skeleton className="w-10 h-10 rounded" />
              <div className="flex-1">
                <Skeleton className="h-4 w-40 mb-1" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="relative">
        <div 
          className="absolute inset-0 h-[300px]"
          style={{
            background: `linear-gradient(180deg, rgba(239,68,68,0.2) 0%, rgba(10,10,10,1) 100%)`
          }}
        />

        <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
          <div className="flex items-center gap-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-48 h-48 rounded-lg bg-linear-to-br from-red-500 to-red-800 flex items-center justify-center shadow-xl"
            >
              <Heart className="w-20 h-20 text-white fill-white" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <h1 className="text-4xl lg:text-5xl font-bold mt-2">Favorites</h1>
              <p className="mt-4 text-muted-foreground">
                {getSubtitle()}
              </p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
          <Button
            size="lg"
            className="rounded-full gap-2 px-8"
            onClick={handlePlayAll}
            disabled={isLoading || filteredSongs.length === 0}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleShuffle}
            disabled={isLoading || filteredSongs.length === 0}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </Button>
          
          {/* Search input */}
          <div className="flex-1 max-w-xs ml-auto relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search favorites..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="w-full">
        <div className="px-4 lg:px-6 pt-4">
          <TabsList>
            <TabsTrigger value="songs">
              Songs ({filteredSongs.length})
            </TabsTrigger>
            <TabsTrigger value="albums">
              Albums ({filteredAlbums.length})
            </TabsTrigger>
            <TabsTrigger value="artists">
              Artists ({filteredArtists.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="songs" className="mt-0">
          <TrackList
            songs={filteredSongs}
            isLoading={isLoading}
            showCover
            showHeader
            emptyMessage={debouncedSearch ? "No songs match your search" : "No liked songs yet"}
          />
        </TabsContent>

        <TabsContent value="albums" className="mt-0">
          <div className="p-4 lg:p-6">
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <AlbumCardSkeleton key={i} />
                ))}
              </div>
            ) : filteredAlbums.length > 0 ? (
              <motion.div 
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.05 } },
                }}
              >
                {filteredAlbums.map((album) => (
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
              <EmptyState message={debouncedSearch ? "No albums match your search" : "No liked albums yet"} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="artists" className="mt-0">
          <div className="p-4 lg:p-6">
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <ArtistCardSkeleton key={i} />
                ))}
              </div>
            ) : filteredArtists.length > 0 ? (
              <motion.div 
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.05 } },
                }}
              >
                {filteredArtists.map((artist) => (
                  <motion.div
                    key={artist.id}
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                  >
                    <ArtistCard artist={artist} />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <EmptyState message={debouncedSearch ? "No artists match your search" : "No liked artists yet"} />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
        <Heart className="w-10 h-10 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground">{message}</p>
      <p className="text-sm text-muted-foreground mt-2">
        Start liking songs to build your collection
      </p>
    </div>
  );
}
