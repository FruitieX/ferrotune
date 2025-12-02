"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Play,
  Shuffle,
  Heart,
  MoreHorizontal,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { SongRow, SongRowSkeleton } from "@/components/browse/song-row";
import { ArtistDropdownMenu, useArtistStar } from "@/components/browse/artist-context-menu";
import { CoverImage } from "@/components/shared/cover-image";
import { formatCount } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Album } from "@/lib/api/types";

function ArtistDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const isMounted = useIsMounted();

  // Redirect to library if no ID
  useEffect(() => {
    if (!id && isMounted && !authLoading) {
      router.replace("/library");
    }
  }, [id, isMounted, authLoading, router]);

  // Fetch artist data (includes songs from server)
  const { data: artistData, isLoading } = useQuery({
    queryKey: ["artist", id],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getArtist(id!);
      return response.artist;
    },
    enabled: isReady && !!id,
  });

  // Songs come directly from server response - includes songs on compilations
  const allSongs = artistData?.song ?? [];

  // Use the artist star hook
  const { isStarred, handleStar, setIsStarred } = useArtistStar(
    !!artistData?.starred,
    id ?? "",
    artistData?.name ?? ""
  );

  // Sync starred state when artist data changes
  useEffect(() => {
    if (artistData) {
      setIsStarred(!!artistData.starred);
    }
  }, [artistData, setIsStarred]);

  const coverArtUrl = artistData?.coverArt
    ? getClient()?.getCoverArtUrl(artistData.coverArt, 400)
    : null;

  const handlePlayAll = () => {
    if (allSongs && allSongs.length > 0) {
      setIsShuffled(false);
      playNow(allSongs);
    }
  };

  const handleShuffle = () => {
    if (allSongs && allSongs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...allSongs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
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

  // Always render the same loading state on server and during hydration
  // This prevents hydration mismatches
  if (!isMounted || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="w-32 h-8" />
      </div>
    );
  }

  if (!id) {
    return null;
  }

  return (
    <div className="min-h-screen">
      {/* Header with blurred background */}
      <div className="relative">
        {/* Background image with blur */}
        {coverArtUrl && (
          <div 
            className="absolute inset-0 h-[400px] overflow-hidden"
            style={{
              backgroundImage: `url(${coverArtUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {/* Blur and gradient overlay */}
            <div className="absolute inset-0 backdrop-blur-3xl bg-background/60" />
            <div 
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, transparent 0%, hsl(var(--background)) 100%)`
              }}
            />
          </div>
        )}
        {/* Fallback gradient when no image */}
        {!coverArtUrl && (
          <div 
            className="absolute inset-0 h-[400px]"
            style={{
              background: `linear-gradient(180deg, rgba(30,215,96,0.2) 0%, hsl(var(--background)) 100%)`
            }}
          />
        )}

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

        {/* Artist header */}
        <div className="relative z-10 flex flex-col md:flex-row gap-6 px-4 lg:px-6 pb-6">
          {/* Artist image */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative w-48 h-48 md:w-56 md:h-56 mx-auto md:mx-0 shrink-0 drop-shadow-2xl"
          >
            {isLoading ? (
              <Skeleton className="w-full h-full rounded-full" />
            ) : (
              <CoverImage
                src={coverArtUrl}
                alt={artistData?.name || "Artist"}
                colorSeed={artistData?.name || "Artist"}
                type="artist"
                size="full"
              />
            )}
          </motion.div>

          {/* Artist info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col justify-end text-center md:text-left"
          >
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Artist
            </span>
            {isLoading ? (
              <>
                <Skeleton className="h-12 w-64 mt-2" />
                <Skeleton className="h-5 w-32 mt-2" />
              </>
            ) : (
              <>
                <h1 className="text-3xl md:text-4xl lg:text-6xl font-bold mt-2 text-foreground">
                  {artistData?.name}
                </h1>
                <p className="mt-4 text-muted-foreground">
                  {formatCount(artistData?.albumCount ?? 0, "album")}
                </p>
              </>
            )}
          </motion.div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
          <Button
            size="lg"
            className="rounded-full gap-2 px-8"
            onClick={handlePlayAll}
            disabled={isLoading || !artistData?.album?.length}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play All
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleShuffle}
            disabled={isLoading || !artistData?.album?.length}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-10 w-10"
            onClick={handleStar}
            disabled={!artistData}
          >
            <Heart className={cn("w-5 h-5", isStarred && "fill-red-500 text-red-500")} />
          </Button>
          {artistData && (
            <ArtistDropdownMenu 
              artist={artistData}
              onPlay={handlePlayAll}
              onShuffle={handleShuffle}
              trigger={
                <Button variant="ghost" size="icon" className="h-10 w-10">
                  <MoreHorizontal className="w-5 h-5" />
                </Button>
              }
            />
          )}
        </div>
      </div>

      {/* Albums section */}
      <div className="p-4 lg:p-6 mt-2">
        <h2 className="text-xl font-bold mb-6">Albums</h2>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        ) : artistData?.album && artistData.album.length > 0 ? (
          <motion.div 
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.05 } },
            }}
          >
            {artistData.album.map((album) => (
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
          <div className="py-20 text-center text-muted-foreground">
            No albums found
          </div>
        )}
      </div>

      {/* Songs section */}
      <div className="p-4 lg:p-6">
        <h2 className="text-xl font-bold mb-6">Songs</h2>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <SongRowSkeleton key={i} />
            ))}
          </div>
        ) : allSongs.length > 0 ? (
          <motion.div 
            className="space-y-1"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.02 } },
            }}
          >
            {allSongs.map((song, index) => (
              <motion.div
                key={song.id}
                variants={{
                  hidden: { opacity: 0, x: -10 },
                  visible: { opacity: 1, x: 0 },
                }}
              >
                <SongRow 
                  song={song} 
                  index={index + 1} 
                  showAlbum={true}
                  showArtist={false}
                  showCover={true}
                  queueSongs={allSongs}
                />
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            No songs found
          </div>
        )}
      </div>

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}

export default function ArtistPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="w-32 h-8" />
      </div>
    }>
      <ArtistDetailContent />
    </Suspense>
  );
}
