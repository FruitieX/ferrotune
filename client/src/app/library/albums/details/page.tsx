"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Play,
  Shuffle,
  Heart,
  MoreHorizontal,
  Clock,
  ArrowLeft,
  FolderPlus,
  ListEnd,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { playNowAtom, addToQueueAtom } from "@/lib/store/queue";
import { isShuffledAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SongRow, SongRowSkeleton } from "@/components/browse/song-row";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { CoverImage } from "@/components/shared/cover-image";
import { formatTotalDuration, formatCount } from "@/lib/utils/format";

function AlbumDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  // Redirect to library if no ID
  useEffect(() => {
    if (!id && isMounted && !authLoading) {
      router.replace("/library");
    }
  }, [id, isMounted, authLoading, router]);

  // Fetch album data
  const { data: albumData, isLoading } = useQuery({
    queryKey: ["album", id],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbum(id!);
      return response.album;
    },
    enabled: isReady && !!id,
  });

  const coverArtUrl = albumData?.coverArt
    ? getClient()?.getCoverArtUrl(albumData.coverArt, 400)
    : undefined;

  const totalDuration = albumData?.song?.reduce((acc, song) => acc + song.duration, 0) ?? 0;

  const handlePlayAll = () => {
    if (albumData?.song && albumData.song.length > 0) {
      setIsShuffled(false);
      playNow(albumData.song);
    }
  };

  const handleShuffle = () => {
    if (albumData?.song && albumData.song.length > 0) {
      setIsShuffled(true);
      const shuffled = [...albumData.song].sort(() => Math.random() - 0.5);
      playNow(shuffled);
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
      {/* Header with gradient background */}
      <div className="relative">
        {/* Background gradient based on cover art */}
        <div 
          className="absolute inset-0 h-[400px] bg-linear-to-b from-primary/20 to-background"
          style={{
            background: albumData 
              ? `linear-gradient(180deg, rgba(30,215,96,0.15) 0%, rgba(10,10,10,1) 100%)`
              : undefined
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

        {/* Album header */}
        <div className="relative z-10 flex flex-col md:flex-row gap-6 px-4 lg:px-6 pb-6">
          {/* Cover art */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-48 h-48 md:w-56 md:h-56 album-glow mx-auto md:mx-0 shrink-0"
          >
            {isLoading ? (
              <Skeleton className="w-full h-full rounded-lg" />
            ) : (
              <CoverImage
                src={coverArtUrl}
                alt={albumData?.name || "Album"}
                colorSeed={albumData?.name}
                type="album"
                size="full"
                priority
                className="rounded-lg"
              />
            )}
          </motion.div>

          {/* Album info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col justify-end text-center md:text-left"
          >
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Album
            </span>
            {isLoading ? (
              <>
                <Skeleton className="h-10 w-64 mt-2" />
                <Skeleton className="h-5 w-32 mt-2" />
              </>
            ) : (
              <>
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mt-2 text-foreground">
                  {albumData?.name}
                </h1>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-4 text-sm text-muted-foreground">
                  <Link
                    href={`/library/artists/details?id=${albumData?.artistId}`}
                    className="font-semibold text-foreground hover:underline"
                  >
                    {albumData?.artist}
                  </Link>
                  {albumData?.year && (
                    <>
                      <span>•</span>
                      <span>{albumData.year}</span>
                    </>
                  )}
                  {albumData?.genre && (
                    <>
                      <span>•</span>
                      <span>{albumData.genre}</span>
                    </>
                  )}
                  <span>•</span>
                  <span>{formatCount(albumData?.songCount ?? 0, "song")}</span>
                  <span>•</span>
                  <span>{formatTotalDuration(totalDuration)}</span>
                </div>
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
            disabled={isLoading || !albumData?.song?.length}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleShuffle}
            disabled={isLoading || !albumData?.song?.length}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10">
            <Heart className="w-5 h-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10">
                <MoreHorizontal className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={() => {
                  if (albumData?.song) {
                    albumData.song.forEach(song => addToQueue(song, "last"));
                    toast.success(`Added ${albumData.song.length} songs to queue`);
                  }
                }}
                disabled={!albumData?.song?.length}
              >
                <ListEnd className="w-4 h-4 mr-2" />
                Add all to Queue
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setAddToPlaylistOpen(true)}
                disabled={!albumData?.song?.length}
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                Add all to Playlist
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Song list header */}
      <div className="grid gap-4 px-4 py-2 border-b border-border text-sm text-muted-foreground"
        style={{ gridTemplateColumns: "2rem 1fr auto auto" }}
      >
        <span className="text-center">#</span>
        <span>Title</span>
        <span className="hidden sm:block">
          <Heart className="w-4 h-4" />
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-4 h-4" />
        </span>
      </div>

      {/* Song list */}
      <div className="divide-y divide-border/50">
        {isLoading ? (
          Array.from({ length: 10 }).map((_, i) => (
            <SongRowSkeleton key={i} />
          ))
        ) : albumData?.song && albumData.song.length > 0 ? (
          albumData.song.map((song, index) => (
            <SongRow
              key={song.id}
              song={song}
              index={index}
              showAlbum={false}
              queueSongs={albumData.song}
            />
          ))
        ) : (
          <div className="py-20 text-center text-muted-foreground">
            No songs in this album
          </div>
        )}
      </div>

      {/* Spacer for player bar */}
      <div className="h-24" />

      {/* Add to Playlist Dialog */}
      {albumData?.song && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songs={albumData.song}
        />
      )}
    </div>
  );
}

export default function AlbumDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="w-32 h-8" />
      </div>
    }>
      <AlbumDetailContent />
    </Suspense>
  );
}
