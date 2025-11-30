"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAtom } from "jotai";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Disc, User, Music, Tag, ListMusic, Grid, List } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { libraryTabAtom, albumViewModeAtom, type LibraryTab } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton, AlbumCardCompact } from "@/components/browse/album-card";
import { ArtistCard, ArtistCardSkeleton, ArtistCardCompact } from "@/components/browse/artist-card";
import { playNowAtom } from "@/lib/store/queue";
import { useSetAtom } from "jotai";
import Link from "next/link";
import type { Album, Artist, Genre } from "@/lib/api/types";

const PAGE_SIZE = 50;

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
  const loadMoreRef = useRef<HTMLDivElement>(null);

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

  // Fetch albums with infinite scroll
  const {
    data: albumsData,
    isLoading: loadingAlbums,
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
        nextOffset: response.albumList2.album?.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
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

  // Intersection observer for infinite scroll
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

  // Flatten artists from indexes, filter out artists with 0 albums
  const allArtists = artistsData?.flatMap((index) => index.artist).filter((a) => a.albumCount > 0) ?? [];

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
            {loadingAlbums && allAlbums.length === 0 ? (
              <div className={viewMode === "grid" 
                ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                : "space-y-1"
              }>
                {Array.from({ length: 12 }).map((_, i) => (
                  <AlbumCardSkeleton key={i} />
                ))}
              </div>
            ) : allAlbums.length > 0 ? (
              <>
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {allAlbums.map((album) => (
                      <AlbumCard key={album.id} album={album} onPlay={() => handlePlayAlbum(album)} />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {allAlbums.map((album) => (
                      <AlbumCardCompact key={album.id} album={album} onPlay={() => handlePlayAlbum(album)} />
                    ))}
                  </div>
                )}
                {/* Infinite scroll trigger */}
                <div ref={loadMoreRef} className="h-10" />
                {isFetchingNextPage && (
                  <div className="flex justify-center py-4">
                    <Skeleton className="w-8 h-8 rounded-full" />
                  </div>
                )}
              </>
            ) : (
              <EmptyState message="No albums in your library" />
            )}
          </div>
        </TabsContent>

        {/* Artists Tab */}
        <TabsContent value="artists" className="mt-0">
          <div className="p-4 lg:p-6">
            {loadingArtists ? (
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
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {allArtists.map((artist) => (
                    <ArtistCard key={artist.id} artist={artist} onPlay={() => handlePlayArtist(artist)} />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {allArtists.map((artist) => (
                    <ArtistCardCompact key={artist.id} artist={artist} onPlay={() => handlePlayArtist(artist)} />
                  ))}
                </div>
              )
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {genresData.map((genre) => (
                  <GenreCard key={genre.value} genre={genre} />
                ))}
              </div>
            ) : (
              <EmptyState message="No genres found" />
            )}
          </div>
        </TabsContent>

        {/* Playlists Tab */}
        <TabsContent value="playlists" className="mt-0">
          <PlaylistsTab />
        </TabsContent>
      </Tabs>

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}

// Genre card component - no scale animation to avoid kerning issues
function GenreCard({ genre }: { genre: Genre }) {
  // Generate color from genre name
  const hash = genre.value.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const hue = Math.abs(hash % 360);

  return (
    <Link
      href={`/search?genre=${encodeURIComponent(genre.value)}`}
      className="relative h-24 rounded-lg overflow-hidden cursor-pointer block hover:ring-2 hover:ring-primary/50 transition-shadow"
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
    </Link>
  );
}

// Playlists tab component
function PlaylistsTab() {
  const { isReady } = useAuth();

  const { data: playlists, isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
    enabled: isReady,
  });

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  if (!playlists || playlists.length === 0) {
    return (
      <div className="p-4 lg:p-6">
        <EmptyState message="No playlists yet. Create one from the song menu!" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {playlists.map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} />
        ))}
      </div>
    </div>
  );
}

// Playlist card component
function PlaylistCard({ playlist }: { playlist: { id: string; name: string; songCount: number; coverArt?: string } }) {
  const coverArtUrl = playlist.coverArt ? getClient()?.getCoverArtUrl(playlist.coverArt, 300) : null;

  return (
    <Link
      href={`/playlists/${playlist.id}`}
      className="group relative p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer block"
    >
      <div className="relative aspect-square rounded-md overflow-hidden bg-muted mb-4">
        {coverArtUrl ? (
          <img
            src={coverArtUrl}
            alt={playlist.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20">
            <ListMusic className="w-12 h-12 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
          {playlist.name}
        </h3>
        <p className="text-sm text-muted-foreground truncate">
          {playlist.songCount} songs
        </p>
      </div>
    </Link>
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
