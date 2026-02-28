"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Calendar,
  Clock,
  Music2,
  Disc3,
  User2,
  Award,
  TrendingUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListPlus,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { useSetAtom } from "jotai";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { getClient } from "@/lib/api/client";
import { startQueueAtom } from "@/lib/store/server-queue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CoverImage } from "@/components/shared/cover-image";
import { formatListeningTime } from "@/lib/utils/format";
import type { TopArtist } from "@/lib/api/generated/TopArtist";
import type { TopAlbum } from "@/lib/api/generated/TopAlbum";
import type { TopTrack } from "@/lib/api/generated/TopTrack";
import type { AvailablePeriod } from "@/lib/api/generated/AvailablePeriod";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatPeriodLabel(period: AvailablePeriod): string {
  if (period.month) {
    return `${MONTH_NAMES[period.month - 1]} ${period.year}`;
  }
  return `${period.year} Year in Review`;
}

function TopArtistCard({
  artist,
  rank,
  onPlay,
}: {
  artist: TopArtist;
  rank: number;
  onPlay?: () => void;
}) {
  // Use inline data if available, otherwise fall back to getCoverArtUrl
  const coverArtUrl =
    artist.coverArt && !artist.coverArtData
      ? getClient()?.getCoverArtUrl(artist.coverArt, 80)
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(rank * 0.02, 0.3) }}
      className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
    >
      <div className="text-2xl font-bold text-muted-foreground w-8 text-center">
        {rank}
      </div>
      <div className="group/cover relative w-10 h-10 overflow-hidden shrink-0 rounded-full">
        <CoverImage
          src={coverArtUrl}
          inlineData={artist.coverArtData}
          alt={artist.artistName}
          colorSeed={artist.artistName}
          type="artist"
          size="sm"
          className="rounded-full"
        />
        {onPlay && (
          <button
            type="button"
            aria-label="Play"
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity cursor-pointer rounded-full"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPlay();
            }}
          >
            <Play className="w-4 h-4 ml-0.5 text-white" />
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <Link
          href={`/library/artists/details?id=${artist.artistId}`}
          prefetch={false}
          className="font-medium truncate block hover:underline"
        >
          {artist.artistName}
        </Link>
        <p className="text-sm text-muted-foreground">
          {artist.playCount} plays •{" "}
          {formatListeningTime(Number(artist.totalDurationSecs))}
        </p>
      </div>
      {rank <= 3 && (
        <Award
          className={`w-5 h-5 ${
            rank === 1
              ? "text-yellow-500"
              : rank === 2
                ? "text-gray-400"
                : "text-amber-600"
          }`}
        />
      )}
    </motion.div>
  );
}

function TopAlbumCard({
  album,
  rank,
  onPlay,
}: {
  album: TopAlbum;
  rank: number;
  onPlay?: () => void;
}) {
  // Use inline data if available, otherwise fall back to getCoverArtUrl
  const coverArtUrl =
    album.coverArt && !album.coverArtData
      ? getClient()?.getCoverArtUrl(album.coverArt, 80)
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(rank * 0.02, 0.3) }}
      className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
    >
      <div className="text-2xl font-bold text-muted-foreground w-8 text-center">
        {rank}
      </div>
      <div className="group/cover relative w-10 h-10 overflow-hidden shrink-0 rounded">
        <CoverImage
          src={coverArtUrl}
          inlineData={album.coverArtData}
          alt={album.albumName}
          colorSeed={album.albumName}
          type="album"
          size="sm"
        />
        {onPlay && (
          <button
            type="button"
            aria-label="Play"
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity cursor-pointer rounded"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPlay();
            }}
          >
            <Play className="w-4 h-4 ml-0.5 text-white" />
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <Link
          href={`/library/albums/details?id=${album.albumId}`}
          prefetch={false}
          className="font-medium truncate block hover:underline"
        >
          {album.albumName}
        </Link>
        {album.artistId ? (
          <Link
            href={`/library/artists/details?id=${album.artistId}`}
            prefetch={false}
            className="text-sm text-muted-foreground truncate block hover:underline hover:text-foreground"
          >
            {album.artistName}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground truncate">
            {album.artistName}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {album.playCount} plays •{" "}
          {formatListeningTime(Number(album.totalDurationSecs))}
        </p>
      </div>
      {rank <= 3 && (
        <Award
          className={`w-5 h-5 ${
            rank === 1
              ? "text-yellow-500"
              : rank === 2
                ? "text-gray-400"
                : "text-amber-600"
          }`}
        />
      )}
    </motion.div>
  );
}

function TopTrackCard({
  track,
  rank,
  onPlay,
}: {
  track: TopTrack;
  rank: number;
  onPlay?: () => void;
}) {
  // Use inline data if available, otherwise fall back to getCoverArtUrl
  const coverArtUrl =
    track.coverArt && !track.coverArtData
      ? getClient()?.getCoverArtUrl(track.coverArt, 80)
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(rank * 0.02, 0.3) }}
      className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
    >
      <div className="text-2xl font-bold text-muted-foreground w-8 text-center">
        {rank}
      </div>
      <div className="group/cover relative w-10 h-10 overflow-hidden shrink-0 rounded">
        <CoverImage
          src={coverArtUrl}
          inlineData={track.coverArtData}
          alt={track.trackTitle}
          colorSeed={track.trackTitle}
          type="song"
          size="sm"
        />
        {onPlay && (
          <button
            type="button"
            aria-label="Play"
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity cursor-pointer rounded"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPlay();
            }}
          >
            <Play className="w-4 h-4 ml-0.5 text-white" />
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{track.trackTitle}</p>
        <div className="text-sm text-muted-foreground truncate flex items-center gap-1">
          {track.artistId ? (
            <Link
              href={`/library/artists/details?id=${track.artistId}`}
              prefetch={false}
              className="hover:underline hover:text-foreground shrink-0"
            >
              {track.artistName}
            </Link>
          ) : (
            <span className="shrink-0">{track.artistName}</span>
          )}
          <span className="shrink-0">•</span>
          {track.albumId ? (
            <Link
              href={`/library/albums/details?id=${track.albumId}`}
              prefetch={false}
              className="hover:underline hover:text-foreground truncate"
            >
              {track.albumName}
            </Link>
          ) : (
            <span className="truncate">{track.albumName}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {track.playCount} plays •{" "}
          {formatListeningTime(Number(track.totalDurationSecs))}
        </p>
      </div>
      {rank <= 3 && (
        <Award
          className={`w-5 h-5 ${
            rank === 1
              ? "text-yellow-500"
              : rank === 2
                ? "text-gray-400"
                : "text-amber-600"
          }`}
        />
      )}
    </motion.div>
  );
}

function TopListSkeleton({ rank }: { rank: number }) {
  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30">
      <div className="text-2xl font-bold text-muted-foreground w-8 text-center">
        {rank}
      </div>
      <Skeleton className="w-10 h-10 rounded" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const startQueue = useSetAtom(startQueueAtom);

  // Selected period - null means "current year"
  const [selectedPeriod, setSelectedPeriod] = useState<{
    year: number;
    month?: number;
  } | null>(null);

  // Fetch period review data
  const { data: reviewData, isLoading: reviewLoading } = useQuery({
    queryKey: ["periodReview", selectedPeriod?.year, selectedPeriod?.month],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPeriodReview(
        selectedPeriod?.year,
        selectedPeriod?.month,
        "small",
      );
    },
    enabled: isReady,
    staleTime: 60000, // Cache for 1 minute
  });

  const queryClient = useQueryClient();

  // Helper to handle creating a playlist from top tracks
  const handleCreatePlaylist = async () => {
    if (!reviewData?.review.topTracks.length) return;

    try {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const period = selectedPeriod?.month
        ? `${MONTH_NAMES[selectedPeriod.month - 1]} ${selectedPeriod.year}`
        : `${reviewData.review.year}`;
      const name = `Top Tracks - ${period}`;

      // Create playlist with top track IDs
      const trackIds = reviewData.review.topTracks.map((t) => t.trackId);
      await client.createPlaylist({ name, songId: trackIds });

      // Invalidate playlists query so the new playlist shows up
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });

      toast.success(`Created playlist "${name}"`);
    } catch (error) {
      toast.error("Failed to create playlist");
      console.error(error);
    }
  };

  // Playback handlers
  const handlePlayArtist = (artistId: string, artistName: string) => {
    startQueue({
      sourceType: "artist",
      sourceId: artistId,
      sourceName: artistName,
      startIndex: 0,
    });
    toast.success(`Playing "${artistName}"`);
  };

  const handlePlayAlbum = (albumId: string, albumName: string) => {
    startQueue({
      sourceType: "album",
      sourceId: albumId,
      sourceName: albumName,
      startIndex: 0,
    });
    toast.success(`Playing "${albumName}"`);
  };

  const handlePlayTrack = (trackId: string, trackTitle: string) => {
    if (!reviewData?.review.topTracks.length) return;

    const trackIds = reviewData.review.topTracks.map((t) => t.trackId);
    const startIndex = trackIds.indexOf(trackId);

    const period = selectedPeriod?.month
      ? `${MONTH_NAMES[selectedPeriod.month - 1]} ${selectedPeriod.year}`
      : `${reviewData.review.year}`;

    startQueue({
      sourceType: "history",
      sourceName: `Top Tracks - ${period}`,
      songIds: trackIds,
      startIndex: startIndex >= 0 ? startIndex : 0,
      startSongId: trackId,
    });
    toast.success(`Playing "${trackTitle}"`);
  };

  // Always render the same loading state on server and during hydration
  if (!isMounted || authLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[150px] w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const review = reviewData?.review;
  const availablePeriods = reviewData?.availablePeriods ?? [];
  const yearPeriods = availablePeriods.filter((p) => !p.month);
  const monthPeriods = availablePeriods.filter((p) => p.month);

  // Sort years and months separately (newest first), then combine
  // This matches the dropdown order: all years first, then all months
  const sortedYears = [...yearPeriods].sort((a, b) => b.year - a.year);
  const sortedMonths = [...monthPeriods].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return (b.month ?? 0) - (a.month ?? 0);
  });
  const allPeriodsSorted = [...sortedYears, ...sortedMonths];

  // Find current period index
  const currentPeriodIndex = allPeriodsSorted.findIndex((p) => {
    if (review?.month) {
      return p.year === review.year && p.month === review.month;
    }
    return p.year === review?.year && !p.month;
  });

  const handlePreviousPeriod = () => {
    if (currentPeriodIndex < allPeriodsSorted.length - 1) {
      const prev = allPeriodsSorted[currentPeriodIndex + 1];
      setSelectedPeriod({ year: prev.year, month: prev.month ?? undefined });
    }
  };

  const handleNextPeriod = () => {
    if (currentPeriodIndex > 0) {
      const next = allPeriodsSorted[currentPeriodIndex - 1];
      setSelectedPeriod({ year: next.year, month: next.month ?? undefined });
    }
  };

  const hasPreviousPeriod = currentPeriodIndex < allPeriodsSorted.length - 1;
  const hasNextPeriod = currentPeriodIndex > 0;

  const currentPeriodLabel = review
    ? review.month
      ? `${MONTH_NAMES[review.month - 1]} ${review.year}`
      : `${review.year} Year in Review`
    : "Loading...";

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <div className="px-4 lg:px-6 pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center gap-4"
        >
          <div className="flex items-center gap-3 flex-1">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Your Review</h1>
              <p className="text-sm text-muted-foreground">
                See your listening highlights
              </p>
            </div>
          </div>

          {/* Period selector with navigation */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePreviousPeriod}
              disabled={!hasPreviousPeriod}
              className="h-9 w-9"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[220px] justify-between">
                  <Calendar className="w-4 h-4 mr-2" />
                  {currentPeriodLabel}
                  <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-[220px] max-h-[400px] overflow-y-auto"
              >
                {yearPeriods.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      Year in Review
                    </div>
                    {yearPeriods.map((period) => (
                      <DropdownMenuItem
                        key={`year-${period.year}`}
                        onClick={() => setSelectedPeriod({ year: period.year })}
                        className={
                          selectedPeriod?.year === period.year &&
                          !selectedPeriod?.month
                            ? "bg-muted"
                            : ""
                        }
                      >
                        {period.year}
                      </DropdownMenuItem>
                    ))}
                    {monthPeriods.length > 0 && <DropdownMenuSeparator />}
                  </>
                )}
                {monthPeriods.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      Month in Review
                    </div>
                    {monthPeriods.map((period) => (
                      <DropdownMenuItem
                        key={`month-${period.year}-${period.month}`}
                        onClick={() =>
                          setSelectedPeriod({
                            year: period.year,
                            month: period.month!,
                          })
                        }
                        className={
                          selectedPeriod?.year === period.year &&
                          selectedPeriod?.month === period.month
                            ? "bg-muted"
                            : ""
                        }
                      >
                        {formatPeriodLabel(period)}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {availablePeriods.length === 0 && (
                  <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                    No listening data yet
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNextPeriod}
              disabled={!hasNextPeriod}
              className="h-9 w-9"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </motion.div>
      </div>

      <div className="px-4 lg:px-6 pb-24 space-y-6">
        {/* Stats Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="overflow-hidden bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5 text-primary" />
                Overview
              </CardTitle>
              <CardDescription>
                {review?.month
                  ? `Your highlights for ${MONTH_NAMES[review.month - 1]} ${review.year}`
                  : review
                    ? `Your highlights for ${review.year}`
                    : "Loading your listening stats..."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reviewLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-3 rounded-lg bg-background/50">
                      <Skeleton className="h-4 w-16 mb-2" />
                      <Skeleton className="h-7 w-20" />
                    </div>
                  ))}
                </div>
              ) : review ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="p-3 rounded-lg bg-background/50">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Clock className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Time Listened
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {formatListeningTime(Number(review.totalListeningSecs))}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/50">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Total Plays
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {Number(review.totalPlayCount).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/50">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Music2 className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Unique Tracks
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {Number(review.uniqueTracks).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/50">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Disc3 className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Unique Albums
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {Number(review.uniqueAlbums).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/50">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <User2 className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Unique Artists
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {Number(review.uniqueArtists).toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No listening data yet. Start playing some music!
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Top Lists */}
        <div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Your Top Picks</CardTitle>
                <CardDescription>
                  Most played artists, albums, and tracks
                </CardDescription>
              </div>
              {review && review.topTracks.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCreatePlaylist}
                  className="gap-2"
                >
                  <ListPlus className="w-4 h-4" />
                  Create Playlist
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="tracks" className="w-full">
                <TabsList className="w-full grid grid-cols-3 mb-4">
                  <TabsTrigger value="tracks" className="gap-2">
                    <Music2 className="w-4 h-4 hidden sm:block" />
                    Tracks
                  </TabsTrigger>
                  <TabsTrigger value="artists" className="gap-2">
                    <User2 className="w-4 h-4 hidden sm:block" />
                    Artists
                  </TabsTrigger>
                  <TabsTrigger value="albums" className="gap-2">
                    <Disc3 className="w-4 h-4 hidden sm:block" />
                    Albums
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="tracks" className="mt-0">
                  <div className="space-y-2">
                    {reviewLoading ? (
                      Array.from({ length: 10 }).map((_, i) => (
                        <TopListSkeleton key={i} rank={i + 1} />
                      ))
                    ) : review && review.topTracks.length > 0 ? (
                      review.topTracks.map((track, i) => (
                        <TopTrackCard
                          key={track.trackId}
                          track={track}
                          rank={i + 1}
                          onPlay={() =>
                            handlePlayTrack(track.trackId, track.trackTitle)
                          }
                        />
                      ))
                    ) : (
                      <p className="text-muted-foreground text-sm py-4 text-center">
                        No track data for this period
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="artists" className="mt-0">
                  <div className="space-y-2">
                    {reviewLoading ? (
                      Array.from({ length: 10 }).map((_, i) => (
                        <TopListSkeleton key={i} rank={i + 1} />
                      ))
                    ) : review && review.topArtists.length > 0 ? (
                      review.topArtists.map((artist, i) => (
                        <TopArtistCard
                          key={artist.artistId}
                          artist={artist}
                          rank={i + 1}
                          onPlay={() =>
                            handlePlayArtist(artist.artistId, artist.artistName)
                          }
                        />
                      ))
                    ) : (
                      <p className="text-muted-foreground text-sm py-4 text-center">
                        No artist data for this period
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="albums" className="mt-0">
                  <div className="space-y-2">
                    {reviewLoading ? (
                      Array.from({ length: 10 }).map((_, i) => (
                        <TopListSkeleton key={i} rank={i + 1} />
                      ))
                    ) : review && review.topAlbums.length > 0 ? (
                      review.topAlbums.map((album, i) => (
                        <TopAlbumCard
                          key={album.albumId}
                          album={album}
                          rank={i + 1}
                          onPlay={() =>
                            handlePlayAlbum(album.albumId, album.albumName)
                          }
                        />
                      ))
                    ) : (
                      <p className="text-muted-foreground text-sm py-4 text-center">
                        No album data for this period
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
