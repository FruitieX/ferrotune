"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSetAtom } from "jotai";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Play,
  Shuffle,
  ArrowLeft,
  Grid,
  List,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton, AlbumCardCompact } from "@/components/browse/album-card";
import { formatCount } from "@/lib/utils/format";
import type { Album } from "@/lib/api/types";

const PAGE_SIZE = 50;

function GenreDetailContent() {
  const searchParams = useSearchParams();
  const encodedName = searchParams.get("name");
  const genreName = encodedName ? decodeURIComponent(encodedName) : null;
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Redirect to library if no name
  useEffect(() => {
    if (!genreName && !authLoading) {
      router.replace("/library");
    }
  }, [genreName, authLoading, router]);

  // Generate color from genre name for the header gradient
  const hash = (genreName ?? "").split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const hue = Math.abs(hash % 360);

  // Fetch genre info from genres list
  const { data: genreInfo, isLoading: loadingGenreInfo } = useQuery({
    queryKey: ["genres"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getGenres();
      return response.genres.genre;
    },
    enabled: isReady,
    select: (genres) => genres.find((g) => g.value === genreName),
  });

  // Fetch albums by genre with infinite scroll
  const {
    data: albumsData,
    isLoading: loadingAlbums,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["albums", "byGenre", genreName],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: "byGenre",
        genre: genreName!,
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
    enabled: isReady && !!genreName,
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

  // Get random songs from genre for shuffle play
  const handlePlayAll = async () => {
    const client = getClient();
    if (!client || !genreName) return;

    try {
      const response = await client.getRandomSongs({ size: 100, genre: genreName });
      if (response.randomSongs.song?.length > 0) {
        setIsShuffled(false);
        playNow(response.randomSongs.song);
      }
    } catch (error) {
      console.error("Failed to play genre:", error);
    }
  };

  const handleShuffle = async () => {
    const client = getClient();
    if (!client || !genreName) return;

    try {
      const response = await client.getRandomSongs({ size: 100, genre: genreName });
      if (response.randomSongs.song?.length > 0) {
        setIsShuffled(true);
        const shuffled = [...response.randomSongs.song].sort(() => Math.random() - 0.5);
        playNow(shuffled);
      }
    } catch (error) {
      console.error("Failed to shuffle genre:", error);
    }
  };

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

  if (!genreName) {
    return null;
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header with gradient background */}
      <div className="relative">
        {/* Background gradient based on genre color */}
        <div 
          className="absolute inset-0 h-[350px]"
          style={{
            background: `linear-gradient(180deg, hsl(${hue}, 70%, 25%) 0%, rgba(10,10,10,1) 100%)`
          }}
        />

        {/* Back button */}
        <div className="relative z-10 p-4 lg:p-6">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-background/50 hover:bg-background/80"
            onClick={() => router.back()}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </div>

        {/* Genre header */}
        <div className="relative z-10 px-4 lg:px-6 pb-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col"
          >
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Genre
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mt-2 text-foreground">
              {genreName}
            </h1>
            {loadingGenreInfo ? (
              <Skeleton className="h-5 w-48 mt-4" />
            ) : genreInfo ? (
              <p className="mt-4 text-muted-foreground">
                {formatCount(genreInfo.albumCount, "album")} • {formatCount(genreInfo.songCount, "song")}
              </p>
            ) : null}
          </motion.div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between px-4 lg:px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              size="lg"
              className="rounded-full gap-2 px-8"
              onClick={handlePlayAll}
              disabled={loadingAlbums && allAlbums.length === 0}
            >
              <Play className="w-5 h-5 ml-0.5" />
              Play
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="rounded-full gap-2"
              onClick={handleShuffle}
              disabled={loadingAlbums && allAlbums.length === 0}
            >
              <Shuffle className="w-5 h-5" />
              Shuffle
            </Button>
          </div>
          
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
      </div>

      {/* Albums section */}
      <div className="p-4 lg:p-6 mt-2">
        <h2 className="text-xl font-bold mb-6">Albums</h2>
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
          <div className="py-20 text-center text-muted-foreground">
            No albums found in this genre
          </div>
        )}
      </div>

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}

export default function GenrePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="w-32 h-8" />
      </div>
    }>
      <GenreDetailContent />
    </Suspense>
  );
}
