"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAtom, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Heart,
  MoreHorizontal,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { artistDetailViewModeAtom, artistDetailSortAtom, artistDetailColumnVisibilityAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { ArtistDropdownMenu, useArtistStar } from "@/components/browse/artist-context-menu";
import { CoverImage } from "@/components/shared/cover-image";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { ActionBar } from "@/components/shared/action-bar";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { formatCount } from "@/lib/utils/format";
import { sortSongs } from "@/lib/utils/sort-songs";
import { cn } from "@/lib/utils";
import type { Album } from "@/lib/api/types";

function ArtistDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  
  // Filter state
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 300);
  
  // View settings
  const [viewMode, setViewMode] = useAtom(artistDetailViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(artistDetailSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(artistDetailColumnVisibilityAtom);

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
  
  // Filter and sort songs
  const displaySongs = useMemo(() => {
    let filtered = allSongs;
    
    if (debouncedFilter.trim()) {
      const query = debouncedFilter.toLowerCase();
      filtered = allSongs.filter(song =>
        song.title?.toLowerCase().includes(query) ||
        song.album?.toLowerCase().includes(query)
      );
    }
    
    if (sortConfig.field !== "custom") {
      return sortSongs(filtered, sortConfig.field, sortConfig.direction);
    }
    
    return filtered;
  }, [allSongs, debouncedFilter, sortConfig]);

  // Multi-selection support for songs - use displaySongs for selection
  const selection = useTrackSelection(displaySongs);

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
    : undefined;

  const handlePlayAll = () => {
    if (displaySongs && displaySongs.length > 0) {
      setIsShuffled(false);
      playNow(displaySongs);
    }
  };

  const handleShuffle = () => {
    if (displaySongs && displaySongs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...displaySongs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
    }
  };

  const handlePlaySelected = () => {
    const selectedSongs = selection.getSelectedSongs();
    if (selectedSongs.length > 0) {
      playNow(selectedSongs);
      selection.clearSelection();
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
            className="w-48 h-48 md:w-56 md:h-56 mx-auto md:mx-0 shrink-0 drop-shadow-2xl"
          >
            {isLoading ? (
              <Skeleton className="w-full h-full rounded-full" />
            ) : (
              <CoverImage
                src={coverArtUrl}
                alt={artistData?.name || "Artist"}
                colorSeed={artistData?.name}
                type="artist"
                size="full"
                priority
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

      {/* Action bar - only show toolbar for songs, not albums */}
      <ActionBar
        onPlayAll={handlePlayAll}
        onShuffle={handleShuffle}
        disablePlay={isLoading || displaySongs.length === 0}
      >
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
      </ActionBar>

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

      {/* Songs section with toolbar */}
      <div className="p-4 lg:p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Songs</h2>
          <SongListToolbar
            filter={filter}
            onFilterChange={setFilter}
            filterPlaceholder="Filter songs..."
            sortConfig={sortConfig}
            onSortChange={setSortConfig}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        </div>
        {isLoading ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <SongCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <SongRowSkeleton key={i} showCover />
              ))}
            </div>
          )
        ) : displaySongs.length > 0 ? (
          <div className={cn("", selection.hasSelection && "select-none")}>
            {viewMode === "grid" ? (
              <VirtualizedGrid
                items={displaySongs}
                renderItem={(song) => (
                  <SongCard
                    song={song}
                    queueSongs={displaySongs}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={(e) => selection.handleSelect(song.id, e)}
                  />
                )}
                renderSkeleton={() => <SongCardSkeleton />}
                getItemKey={(song) => song.id}
              />
            ) : (
              <VirtualizedList
                items={displaySongs}
                renderItem={(song, index) => (
                  <SongRow 
                    song={song} 
                    index={index} 
                    showCover
                    showArtist={columnVisibility.artist}
                    showAlbum={columnVisibility.album}
                    showDuration={columnVisibility.duration}
                    showPlayCount={columnVisibility.playCount}
                    showYear={columnVisibility.year}
                    showDateAdded={columnVisibility.dateAdded}
                    queueSongs={displaySongs}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={(e) => selection.handleSelect(song.id, e)}
                  />
                )}
                renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
                getItemKey={(song) => song.id}
                estimateItemHeight={56}
              />
            )}
          </div>
        ) : allSongs.length > 0 ? (
          <EmptyFilterState message="No songs match your filter" />
        ) : (
          <EmptyState
            title="No songs found"
            description="This artist doesn't have any songs yet."
          />
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selection.selectedCount}
        onClear={selection.clearSelection}
        onPlayNow={handlePlaySelected}
        onPlayNext={() => selection.addSelectedToQueue("next")}
        onAddToQueue={() => selection.addSelectedToQueue("last")}
        onStar={() => selection.starSelected(true)}
        onUnstar={() => selection.starSelected(false)}
        onSelectAll={selection.selectAll}
        getSelectedSongs={selection.getSelectedSongs}
      />

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}

export default function ArtistDetailPage() {
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
