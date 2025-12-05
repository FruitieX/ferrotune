"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAtom, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Heart,
  MoreHorizontal,
  ArrowLeft,
  FolderPlus,
  ListEnd,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { startQueueAtom, addToQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import { albumDetailViewModeAtom, albumDetailSortAtom, albumDetailColumnVisibilityAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { CoverImage } from "@/components/shared/cover-image";
import { ActionBar } from "@/components/shared/action-bar";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { formatTotalDuration, formatCount } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

function AlbumDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  
  // Filter state
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 300);
  
  // View settings
  const [viewMode, setViewMode] = useAtom(albumDetailViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(albumDetailSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(albumDetailColumnVisibilityAtom);

  // Redirect to library if no ID
  useEffect(() => {
    if (!id && isMounted && !authLoading) {
      router.replace("/library");
    }
  }, [id, isMounted, authLoading, router]);

  // Fetch album data with server-side sort/filter for songs
  const { data: albumData, isLoading } = useQuery({
    queryKey: ["album", id, sortConfig.field, sortConfig.direction, debouncedFilter],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbum(id!, {
        sort: sortConfig.field !== "custom" ? sortConfig.field : undefined,
        sortDir: sortConfig.field !== "custom" ? sortConfig.direction : undefined,
        filter: debouncedFilter.trim() || undefined,
      });
      return response.album;
    },
    enabled: isReady && !!id,
    // Keep previous data while fetching new sort/filter results
    placeholderData: (previousData) => previousData,
  });

  // Songs come directly from server response - already sorted and filtered
  const displaySongs = albumData?.song ?? [];
  
  // Multi-selection support
  const selection = useTrackSelection(displaySongs);

  // Queue source for album songs - server materializes with same sort
  const albumQueueSource = useMemo(() => ({
    type: "album" as QueueSourceType,
    id: id,
    name: albumData?.name ?? "Album",
    sort: sortConfig.field !== "custom" ? {
      field: sortConfig.field,
      direction: sortConfig.direction,
    } : undefined,
  }), [id, albumData?.name, sortConfig.field, sortConfig.direction]);

  const coverArtUrl = albumData?.coverArt
    ? getClient()?.getCoverArtUrl(albumData.coverArt, 400)
    : undefined;

  const totalDuration = displaySongs.reduce((acc, song) => acc + song.duration, 0);

  const handlePlayAll = () => {
    if (id && displaySongs.length > 0) {
      startQueue({
        sourceType: "album",
        sourceId: id,
        sourceName: albumData?.name,
        startIndex: 0,
        shuffle: false,
        sort: sortConfig.field !== "custom" ? {
          field: sortConfig.field,
          direction: sortConfig.direction,
        } : undefined,
      });
    }
  };

  const handleShuffle = () => {
    if (id && displaySongs.length > 0) {
      startQueue({
        sourceType: "album",
        sourceId: id,
        sourceName: albumData?.name,
        startIndex: 0,
        shuffle: true,
        sort: sortConfig.field !== "custom" ? {
          field: sortConfig.field,
          direction: sortConfig.direction,
        } : undefined,
      });
    }
  };

  const handlePlaySelected = () => {
    const selectedSongs = selection.getSelectedSongs();
    if (selectedSongs.length > 0) {
      startQueue({
        sourceType: "other",
        sourceName: `${albumData?.name} (selection)`,
        songIds: selectedSongs.map(s => s.id),
      });
      selection.clearSelection();
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

      {/* Action bar with toolbar */}
      <ActionBar
        onPlayAll={handlePlayAll}
        onShuffle={handleShuffle}
        disablePlay={isLoading || displaySongs.length === 0}
        toolbar={
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
        }
      >
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
                if (displaySongs.length > 0) {
                  addToQueue({ songIds: displaySongs.map(s => s.id), position: "end" });
                  toast.success(`Added ${displaySongs.length} songs to queue`);
                }
              }}
              disabled={displaySongs.length === 0}
            >
              <ListEnd className="w-4 h-4 mr-2" />
              Add all to Queue
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => setAddToPlaylistOpen(true)}
              disabled={displaySongs.length === 0}
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              Add all to Playlist
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ActionBar>

      {/* Song list */}
      <div className={cn("px-4 lg:px-6 py-4", selection.hasSelection && "select-none")}>
        {isLoading ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <SongCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <SongRowSkeleton key={i} showCover showIndex />
              ))}
            </div>
          )
        ) : displaySongs.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={displaySongs}
              renderItem={(song) => (
                <SongCard
                  song={song}
                  queueSongs={displaySongs}
                  queueSource={albumQueueSource}
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
                  queueSource={albumQueueSource}
                  isSelected={selection.isSelected(song.id)}
                  isSelectionMode={selection.hasSelection}
                  onSelect={(e) => selection.handleSelect(song.id, e)}
                />
              )}
              renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
              getItemKey={(song) => song.id}
              estimateItemHeight={56}
            />
          )
        ) : debouncedFilter.trim() ? (
          <EmptyFilterState message="No songs match your filter" />
        ) : (
          <EmptyState
            title="No songs in this album"
            description="This album appears to be empty."
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

      {/* Add to Playlist Dialog */}
      {displaySongs.length > 0 && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songs={displaySongs}
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
