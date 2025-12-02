"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { Search as SearchIcon, X, Loader2, ListMusic, Clock } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { playNowAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { ArtistCard, ArtistCardSkeleton } from "@/components/browse/artist-card";
import { SongRow } from "@/components/browse/song-row";
import { CoverImage } from "@/components/shared/cover-image";
import { formatDuration, formatCount } from "@/lib/utils/format";
import type { Album, Artist, Playlist } from "@/lib/api/types";

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isReady } = useAuth({ redirectToLogin: true });
  const playNow = useSetAtom(playNowAtom);
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [activeTab, setActiveTab] = useState<"all" | "artists" | "albums" | "songs" | "playlists">("all");
  const debouncedQuery = useDebounce(query, 300);

  // Update URL when query changes
  useEffect(() => {
    if (debouncedQuery) {
      router.replace(`/search?q=${encodeURIComponent(debouncedQuery)}`, { scroll: false });
    } else {
      router.replace("/search", { scroll: false });
    }
  }, [debouncedQuery, router]);

  // Search query for songs, albums, artists
  const { data: searchResults, isLoading, isFetching } = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.search3({
        query: debouncedQuery,
        artistCount: 20,
        albumCount: 20,
        songCount: 50,
      });
      return response.searchResult3;
    },
    enabled: isReady && debouncedQuery.length >= 2,
    staleTime: 60000,
  });

  // Fetch and filter playlists client-side (API doesn't have playlist search)
  const { data: playlists } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
    enabled: isReady,
    staleTime: 60000,
  });

  // Filter playlists based on search query
  const filteredPlaylists = playlists?.filter((playlist) =>
    debouncedQuery.length >= 2 &&
    playlist.name.toLowerCase().includes(debouncedQuery.toLowerCase())
  ) ?? [];

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

  const handlePlayArtist = async (artist: Artist) => {
    const client = getClient();
    if (!client) return;

    try {
      const artistData = await client.getArtist(artist.id);
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

  const hasResults = 
    (searchResults?.artist?.length ?? 0) > 0 ||
    (searchResults?.album?.length ?? 0) > 0 ||
    (searchResults?.song?.length ?? 0) > 0 ||
    filteredPlaylists.length > 0;

  return (
    <div className="min-h-screen">
      {/* Header with search input */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="px-4 lg:px-6 py-4">
          <div className="relative max-w-xl">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search for artists, albums, or songs..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 pr-10 h-12 text-lg bg-secondary border-0 rounded-full"
              autoFocus
            />
            {isFetching && (
              <Loader2 className="absolute right-12 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
            {query && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                onClick={() => setQuery("")}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="p-4 lg:p-6">
        {!debouncedQuery ? (
          <EmptySearch />
        ) : debouncedQuery.length < 2 ? (
          <div className="py-20 text-center text-muted-foreground">
            Type at least 2 characters to search
          </div>
        ) : isLoading ? (
          <SearchSkeleton />
        ) : !hasResults ? (
          <NoResults query={debouncedQuery} />
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="mb-6">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="artists" disabled={!searchResults?.artist?.length}>
                Artists ({searchResults?.artist?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="albums" disabled={!searchResults?.album?.length}>
                Albums ({searchResults?.album?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="songs" disabled={!searchResults?.song?.length}>
                Songs ({searchResults?.song?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="playlists" disabled={!filteredPlaylists.length}>
                Playlists ({filteredPlaylists.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-8">
              {/* Artists */}
              {searchResults?.artist && searchResults.artist.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold mb-4">Artists</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {searchResults.artist.slice(0, 6).map((artist) => (
                      <ArtistCard
                        key={artist.id}
                        artist={artist}
                        onPlay={() => handlePlayArtist(artist)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Albums */}
              {searchResults?.album && searchResults.album.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold mb-4">Albums</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {searchResults.album.slice(0, 6).map((album) => (
                      <AlbumCard
                        key={album.id}
                        album={album}
                        onPlay={() => handlePlayAlbum(album)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Songs */}
              {searchResults?.song && searchResults.song.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold mb-4">Songs</h2>
                  <div className="divide-y divide-border/50">
                    {searchResults.song.slice(0, 10).map((song, index) => (
                      <SongRow
                        key={song.id}
                        song={song}
                        index={index}
                        showCover
                        queueSongs={searchResults.song}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Playlists */}
              {filteredPlaylists.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold mb-4">Playlists</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {filteredPlaylists.slice(0, 6).map((playlist) => (
                      <PlaylistSearchCard key={playlist.id} playlist={playlist} />
                    ))}
                  </div>
                </section>
              )}
            </TabsContent>

            <TabsContent value="artists">
              {searchResults?.artist && searchResults.artist.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {searchResults.artist.map((artist) => (
                    <ArtistCard
                      key={artist.id}
                      artist={artist}
                      onPlay={() => handlePlayArtist(artist)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="albums">
              {searchResults?.album && searchResults.album.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {searchResults.album.map((album) => (
                    <AlbumCard
                      key={album.id}
                      album={album}
                      onPlay={() => handlePlayAlbum(album)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="songs">
              {searchResults?.song && searchResults.song.length > 0 && (
                <div className="divide-y divide-border/50">
                  {searchResults.song.map((song, index) => (
                    <SongRow
                      key={song.id}
                      song={song}
                      index={index}
                      showCover
                      queueSongs={searchResults.song}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="playlists">
              {filteredPlaylists.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {filteredPlaylists.map((playlist) => (
                    <PlaylistSearchCard key={playlist.id} playlist={playlist} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function EmptySearch() {
  return (
    <div className="py-20 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring" }}
        className="w-24 h-24 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center"
      >
        <SearchIcon className="w-10 h-10 text-muted-foreground" />
      </motion.div>
      <h2 className="text-xl font-semibold mb-2">Search your library</h2>
      <p className="text-muted-foreground">
        Find artists, albums, and songs
      </p>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="py-20 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring" }}
        className="w-24 h-24 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center"
      >
        <X className="w-10 h-10 text-muted-foreground" />
      </motion.div>
      <h2 className="text-xl font-semibold mb-2">No results found</h2>
      <p className="text-muted-foreground">
        No results found for &quot;{query}&quot;
      </p>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-8">
      <section>
        <Skeleton className="h-7 w-24 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ArtistCardSkeleton key={i} />
          ))}
        </div>
      </section>
      <section>
        <Skeleton className="h-7 w-24 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <AlbumCardSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

// Playlist card for search results
function PlaylistSearchCard({ playlist }: { playlist: Playlist }) {
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 300)
    : undefined;

  return (
    <Link
      href={`/playlists/details?id=${playlist.id}`}
      className="group block p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors"
    >
      <div className="relative mb-4">
        <CoverImage
          src={coverArtUrl}
          alt={playlist.name || "Playlist cover"}
          size="full"
          type="playlist"
          className="rounded-md shadow-lg"
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-xl">
            <ListMusic className="w-6 h-6 text-primary-foreground" />
          </div>
        </div>
      </div>
      <h3 className="font-semibold truncate">{playlist.name}</h3>
      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
        <span>{formatCount(playlist.songCount, "song")}</span>
        <span>•</span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDuration(playlist.duration)}
        </span>
      </div>
    </Link>
  );
}
