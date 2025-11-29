"use client";

import { useAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Disc, User, Music, Tag, ListMusic, Grid, List } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { libraryTabAtom, albumViewModeAtom, type LibraryTab } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { ArtistCard, ArtistCardSkeleton } from "@/components/browse/artist-card";
import { playNowAtom } from "@/lib/store/queue";
import { useSetAtom } from "jotai";
import type { Album, Artist, Genre } from "@/lib/api/types";

const tabIcons: Record<LibraryTab, React.ElementType> = {
  albums: Disc,
  artists: User,
  songs: Music,
  genres: Tag,
  playlists: ListMusic,
};

export default function LibraryPage() {
  const { isReady, isLoading } = useAuth({ redirectToLogin: true });
  const [activeTab, setActiveTab] = useAtom(libraryTabAtom);
  const [viewMode, setViewMode] = useAtom(albumViewModeAtom);
  const playNow = useSetAtom(playNowAtom);

  // Fetch artists
  const { data: artistsData, isLoading: loadingArtists } = useQuery({
    queryKey: ["artists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getArtists();
      return response.artists.index;
    },
    enabled: isReady && activeTab === "artists",
  });

  // Fetch albums
  const { data: albumsData, isLoading: loadingAlbums } = useQuery({
    queryKey: ["albums", "alphabetical"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({ 
        type: "alphabeticalByName", 
        size: 100 
      });
      return response.albumList2.album;
    },
    enabled: isReady && activeTab === "albums",
  });

  // Fetch genres
  const { data: genresData, isLoading: loadingGenres } = useQuery({
    queryKey: ["genres"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getGenres();
      return response.genres.genre;
    },
    enabled: isReady && activeTab === "genres",
  });

  // Flatten artists from indexes
  const allArtists = artistsData?.flatMap((index) => index.artist) ?? [];

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

  if (isLoading) {
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
          <h1 className="text-2xl font-bold">Library</h1>
          
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("grid")}
            >
              <Grid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <Tabs 
        value={activeTab} 
        onValueChange={(v) => setActiveTab(v as LibraryTab)}
        className="w-full"
      >
        <div className="sticky top-16 z-20 bg-background border-b border-border">
          <TabsList className="h-12 w-full justify-start rounded-none bg-transparent px-4 lg:px-6">
            {(["albums", "artists", "genres", "playlists"] as LibraryTab[]).map((tab) => {
              const Icon = tabIcons[tab];
              return (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="gap-2 data-[state=active]:bg-accent"
                >
                  <Icon className="w-4 h-4" />
                  <span className="capitalize">{tab}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {/* Albums Tab */}
        <TabsContent value="albums" className="mt-0">
          <div className="p-4 lg:p-6">
            {loadingAlbums ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <AlbumCardSkeleton key={i} />
                ))}
              </div>
            ) : albumsData && albumsData.length > 0 ? (
              <motion.div 
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.05 } },
                }}
              >
                {albumsData.map((album) => (
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
              <EmptyState message="No albums in your library" />
            )}
          </div>
        </TabsContent>

        {/* Artists Tab */}
        <TabsContent value="artists" className="mt-0">
          <div className="p-4 lg:p-6">
            {loadingArtists ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <ArtistCardSkeleton key={i} />
                ))}
              </div>
            ) : allArtists.length > 0 ? (
              <motion.div 
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.05 } },
                }}
              >
                {allArtists.map((artist) => (
                  <motion.div
                    key={artist.id}
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                  >
                    <ArtistCard artist={artist} onPlay={() => handlePlayArtist(artist)} />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <EmptyState message="No artists in your library" />
            )}
          </div>
        </TabsContent>

        {/* Genres Tab */}
        <TabsContent value="genres" className="mt-0">
          <div className="p-4 lg:p-6">
            {loadingGenres ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
            ) : genresData && genresData.length > 0 ? (
              <motion.div 
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.05 } },
                }}
              >
                {genresData.map((genre) => (
                  <GenreCard key={genre.value} genre={genre} />
                ))}
              </motion.div>
            ) : (
              <EmptyState message="No genres found" />
            )}
          </div>
        </TabsContent>

        {/* Playlists Tab */}
        <TabsContent value="playlists" className="mt-0">
          <div className="p-4 lg:p-6">
            <EmptyState message="Playlists coming soon" />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Genre card component
function GenreCard({ genre }: { genre: Genre }) {
  // Generate color from genre name
  const hash = genre.value.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const hue = Math.abs(hash % 360);

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, scale: 0.95 },
        visible: { opacity: 1, scale: 1 },
      }}
      whileHover={{ scale: 1.02 }}
      className="relative h-24 rounded-lg overflow-hidden cursor-pointer"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 70%, 35%) 0%, hsl(${(hue + 30) % 360}, 60%, 25%) 100%)`,
      }}
    >
      <div className="absolute inset-0 flex flex-col justify-end p-4">
        <h3 className="font-bold text-white truncate">{genre.value}</h3>
        <p className="text-xs text-white/80">
          {genre.albumCount} albums • {genre.songCount} songs
        </p>
      </div>
    </motion.div>
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
