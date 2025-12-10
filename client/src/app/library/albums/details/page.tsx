"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAtom, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Heart, MoreHorizontal, FolderPlus, ListEnd } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import {
  startQueueAtom,
  addToQueueAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import {
  albumDetailViewModeAtom,
  albumDetailSortAtom,
  albumDetailColumnVisibilityAtom,
} from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SongRow,
  SongRowSkeleton,
  SongCard,
  SongCardSkeleton,
} from "@/components/browse/song-row";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { formatTotalDuration, formatCount } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

function AlbumDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
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
  const [columnVisibility, setColumnVisibility] = useAtom(
    albumDetailColumnVisibilityAtom,
  );

  // Redirect to library if no ID
  useEffect(() => {
    if (!id && isMounted && !authLoading) {
      router.replace("/library");
    }
  }, [id, isMounted, authLoading, router]);

  // Fetch album data with server-side sort/filter for songs
  const { data: albumData, isLoading } = useQuery({
    queryKey: [
      "album",
      id,
      sortConfig.field,
      sortConfig.direction,
      debouncedFilter,
    ],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbum(id!, {
        sort: sortConfig.field !== "custom" ? sortConfig.field : undefined,
        sortDir:
          sortConfig.field !== "custom" ? sortConfig.direction : undefined,
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

  // Queue source for album songs - server materializes with same sort/filter
  const albumQueueSource = {
    type: "album" as QueueSourceType,
    id: id,
    name: albumData?.name ?? "Album",
    filters: debouncedFilter.trim()
      ? { filter: debouncedFilter.trim() }
      : undefined,
    sort:
      sortConfig.field !== "custom"
        ? {
            field: sortConfig.field,
            direction: sortConfig.direction,
          }
        : undefined,
  };

  const coverArtUrl = albumData?.coverArt
    ? getClient()?.getCoverArtUrl(albumData.coverArt, 400)
    : undefined;

  const totalDuration = displaySongs.reduce(
    (acc, song) => acc + song.duration,
    0,
  );

  const handlePlayAll = () => {
    if (id && displaySongs.length > 0) {
      startQueue({
        sourceType: "album",
        sourceId: id,
        sourceName: albumData?.name,
        startIndex: 0,
        shuffle: false,
        filters: debouncedFilter.trim()
          ? { filter: debouncedFilter.trim() }
          : undefined,
        sort:
          sortConfig.field !== "custom"
            ? {
                field: sortConfig.field,
                direction: sortConfig.direction,
              }
            : undefined,
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
        filters: debouncedFilter.trim()
          ? { filter: debouncedFilter.trim() }
          : undefined,
        sort:
          sortConfig.field !== "custom"
            ? {
                field: sortConfig.field,
                direction: sortConfig.direction,
              }
            : undefined,
      });
    }
  };

  const handlePlaySelected = () => {
    const selectedSongs = selection.getSelectedSongs();
    if (selectedSongs.length > 0) {
      startQueue({
        sourceType: "other",
        sourceName: `${albumData?.name} (selection)`,
        songIds: selectedSongs.map((s) => s.id),
      });
      selection.clearSelection();
    }
  };

  const handleShuffleSelected = () => {
    const selectedSongs = selection.getSelectedSongs();
    if (selectedSongs.length > 0) {
      startQueue({
        sourceType: "other",
        sourceName: `${albumData?.name} (selection)`,
        songIds: selectedSongs.map((s) => s.id),
        shuffle: true,
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
      <DetailHeader
        showBackButton
        coverUrl={coverArtUrl}
        coverAlt={albumData?.name || "Album"}
        colorSeed={albumData?.name}
        coverType="album"
        coverSize="md"
        useBlurredBackground
        label="Album"
        title={albumData?.name || "Album"}
        isLoading={isLoading}
        subtitle={
          albumData && (
            <>
              <Link
                href={`/library/artists/details?id=${albumData.artistId}`}
                className="font-semibold text-foreground hover:underline"
              >
                {albumData.artist}
              </Link>
              {albumData.year && (
                <>
                  <span>•</span>
                  <span>{albumData.year}</span>
                </>
              )}
              {albumData.genre && (
                <>
                  <span>•</span>
                  <span>{albumData.genre}</span>
                </>
              )}
              <span>•</span>
              <span>{formatCount(albumData.songCount ?? 0, "song")}</span>
              <span>•</span>
              <span>{formatTotalDuration(totalDuration)}</span>
            </>
          )
        }
      />

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
                  addToQueue({
                    songIds: displaySongs.map((s) => s.id),
                    position: "end",
                  });
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
      <div
        className={cn(
          "px-4 lg:px-6 py-4",
          selection.hasSelection && "select-none",
        )}
      >
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
              renderItem={(song, index) => (
                <SongCard
                  song={song}
                  index={index}
                  queueSource={albumQueueSource}
                  isSelected={selection.isSelected(song.id)}
                  isSelectionMode={selection.hasSelection}
                  onSelect={selection.handleSelect}
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
                  showLastPlayed={columnVisibility.lastPlayed}
                  queueSource={albumQueueSource}
                  isSelected={selection.isSelected(song.id)}
                  isSelectionMode={selection.hasSelection}
                  onSelect={selection.handleSelect}
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
        onShuffle={handleShuffleSelected}
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
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <Skeleton className="w-32 h-8" />
        </div>
      }
    >
      <AlbumDetailContent />
    </Suspense>
  );
}
