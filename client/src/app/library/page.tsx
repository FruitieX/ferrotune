"use client";

import { useAtom } from "jotai";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Disc, User, Music, Tag, Grid, List } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { libraryTabAtom, albumViewModeAtom, type LibraryTab } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton, AlbumCardCompact } from "@/components/browse/album-card";
import { ArtistCard, ArtistCardSkeleton, ArtistCardCompact } from "@/components/browse/artist-card";
import { SongRow, SongRowSkeleton } from "@/components/browse/song-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { playNowAtom } from "@/lib/store/queue";
import { useSetAtom } from "jotai";
import Link from "next/link";
import type { Album, Artist, Genre, Song } from "@/lib/api/types";

const PAGE_SIZE = 50;

const tabIcons: Record<LibraryTab, React.ElementType> = {
  albums: Disc,
  artists: User,
  songs: Music,
  genres: Tag,
  playlists: Music, // unused but needed for type
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
        total: response.albumList2.total,
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

  // Fetch all songs by getting them from all albums (since there's no "get all songs" endpoint)
  // We use the search endpoint with a wildcard which returns songs alphabetically
  const {
    data: songsData,
    isLoading: loadingSongs,
    fetchNextPage: fetchNextSongs,
    hasNextPage: hasNextSongsPage,
    isFetchingNextPage: isFetchingNextSongs,
  } = useInfiniteQuery({
    queryKey: ["songs", "all"],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      // Use search with an empty-ish query to get all songs, paginated
      // The search endpoint returns songs, and we request a large batch
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
    enabled: isReady && activeTab === "songs",
  });

  // Flatten songs from all pages
  const allSongs = songsData?.pages.flatMap((page) => page.songs) ?? [];
  const totalSongs = songsData?.pages[0]?.total ?? allSongs.length;

  // Flatten albums from all pages
  const allAlbums = albumsData?.pages.flatMap((page) => page.albums) ?? [];
  const totalAlbums = albumsData?.pages[0]?.total ?? allAlbums.length;

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
      <div>
        {/* Header skeleton */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
          <div className="flex items-center justify-between h-16 px-4 lg:px-6">
            <Skeleton className="h-8 w-24" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded" />
              <Skeleton className="h-8 w-8 rounded" />
            </div>
          </div>
        </header>
        {/* Tab skeleton */}
        <div className="border-b border-border">
          <div className="h-12 px-4 lg:px-6 flex items-center gap-4">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
        {/* Content skeleton */}
        <div className="p-4 lg:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
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
            {(["albums", "artists", "songs", "genres"] as LibraryTab[]).map((tab) => {
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
                    <div className="h-16 animate-pulse bg-muted rounded-md" />
                  )}
                  getItemKey={(album) => album.id}
                  estimateItemHeight={64}
                  hasNextPage={hasNextPage ?? false}
                  isFetchingNextPage={isFetchingNextPage}
                  fetchNextPage={fetchNextPage}
                />
              )
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
                    <div className="h-16 animate-pulse bg-muted rounded-md" />
                  )}
                  getItemKey={(artist) => artist.id}
                  estimateItemHeight={64}
                />
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
              <VirtualizedGrid
                items={genresData}
                renderItem={(genre) => <GenreCard genre={genre} />}
                renderSkeleton={() => <Skeleton className="h-24 rounded-lg" />}
                getItemKey={(genre) => genre.value}
                estimateItemHeight={96}
                columns={{ default: 2, sm: 3, md: 4, lg: 4, xl: 4 }}
              />
            ) : (
              <EmptyState message="No genres found" />
            )}
          </div>
        </TabsContent>

        {/* Songs Tab */}
        <TabsContent value="songs" className="mt-0">
          <div className="p-4 lg:p-6">
            {loadingSongs && allSongs.length === 0 ? (
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
                hasNextPage={hasNextSongsPage ?? false}
                isFetchingNextPage={isFetchingNextSongs}
                fetchNextPage={fetchNextSongs}
              />
            ) : (
              <EmptyState message="No songs in your library" />
            )}
          </div>
        </TabsContent>
      </Tabs>
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
      href={`/library/genres/details?name=${encodeURIComponent(genre.value)}`}
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
