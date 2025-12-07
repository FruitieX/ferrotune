"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAtom, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Heart,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import { artistDetailViewModeAtom, artistDetailSortAtom, artistDetailColumnVisibilityAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { ArtistDropdownMenu, useArtistStar } from "@/components/browse/artist-context-menu";
import { DetailHeader } from "@/components/shared/detail-header";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { ActionBar } from "@/components/shared/action-bar";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { formatCount } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Album } from "@/lib/api/types";

function ArtistDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const startQueue = useSetAtom(startQueueAtom);
  
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

  // Fetch artist data with server-side sort/filter for songs
  const { data: artistData, isLoading } = useQuery({
    queryKey: ["artist", id, sortConfig.field, sortConfig.direction, debouncedFilter],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getArtist(id!, {
        sort: sortConfig.field !== "custom" ? sortConfig.field : undefined,
        sortDir: sortConfig.field !== "custom" ? sortConfig.direction : undefined,
        filter: debouncedFilter.trim() || undefined,
      });
      return response.artist;
    },
    enabled: isReady && !!id,
    // Keep previous data while fetching new sort/filter results
    placeholderData: (previousData) => previousData,
  });

  // Songs come directly from server response - already sorted and filtered
  const displaySongs = artistData?.song ?? [];
  
  // Track if we have any songs (before filtering) to show appropriate empty state
  const hasAnySongs = displaySongs.length > 0 || debouncedFilter.trim() !== "";

  // Queue source for artist songs - server materializes with same sort/filter
  const artistQueueSource = useMemo(() => ({
    type: "artist" as QueueSourceType,
    id: id,
    name: artistData?.name ?? "Artist",
    sort: sortConfig.field !== "custom" ? {
      field: sortConfig.field,
      direction: sortConfig.direction,
    } : undefined,
  }), [id, artistData?.name, sortConfig.field, sortConfig.direction]);

  // Multi-selection support for songs
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
    if (id && displaySongs && displaySongs.length > 0) {
      startQueue({
        sourceType: "artist",
        sourceId: id,
        sourceName: artistData?.name,
        startIndex: 0,
        shuffle: false,
      });
    }
  };

  const handleShuffle = () => {
    if (id && displaySongs && displaySongs.length > 0) {
      startQueue({
        sourceType: "artist",
        sourceId: id,
        sourceName: artistData?.name,
        startIndex: 0,
        shuffle: true,
      });
    }
  };

  const handlePlaySelected = () => {
    const selectedSongs = selection.getSelectedSongs();
    if (selectedSongs.length > 0) {
      startQueue({
        sourceType: "other",
        sourceName: `${artistData?.name} (selection)`,
        songIds: selectedSongs.map(s => s.id),
      });
      selection.clearSelection();
    }
  };

  const handlePlayAlbum = async (album: Album) => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
      startIndex: 0,
      shuffle: false,
    });
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
      <DetailHeader
        showBackButton
        coverUrl={coverArtUrl}
        coverAlt={artistData?.name || "Artist"}
        colorSeed={artistData?.name}
        coverType="artist"
        circular
        coverSize="md"
        useBlurredBackground
        label="Artist"
        title={artistData?.name || "Artist"}
        isLoading={isLoading}
        subtitle={formatCount(artistData?.albumCount ?? 0, "album")}
      />

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
                renderItem={(song, index) => (
                  <SongCard
                    song={song}
                    index={index}
                    queueSource={artistQueueSource}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={selection.handleSelect}
                  />
                )}
                renderSkeleton={() => <SongCardSkeleton />}
                getItemKey={(song) => song.id}
                autoScrollMargin
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
                    showLastPlayed={columnVisibility.lastPlayed}
                    queueSource={artistQueueSource}
                    isSelected={selection.isSelected(song.id)}
                    isSelectionMode={selection.hasSelection}
                    onSelect={selection.handleSelect}
                  />
                )}
                renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
                getItemKey={(song) => song.id}
                estimateItemHeight={56}
                autoScrollMargin
              />
            )}
          </div>
        ) : debouncedFilter.trim() ? (
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
        onAddToQueue={() => selection.addSelectedToQueue("end")}
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
