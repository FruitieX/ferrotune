"use client";

import { useState, useMemo } from "react";
import { useAtom, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { playNowAtom, isShuffledAtom, type QueueSourceInfo } from "@/lib/store/queue";
import { playlistViewModeAtom, playlistSortAtom, playlistColumnVisibilityAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { formatCount, formatTotalDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { sortSongs } from "@/lib/utils/sort-songs";
import type { Song } from "@/lib/api/types";

// Queue source for history playback
const HISTORY_QUEUE_SOURCE: QueueSourceInfo = { type: "history", name: "Recently Played" };

export default function HistoryPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  
  // Filter and view settings
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 300);
  const [viewMode, setViewMode] = useAtom(playlistViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(playlistSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(playlistColumnVisibilityAtom);
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  // Fetch play history from the server
  const { data: historyData, isLoading } = useQuery({
    queryKey: ["playHistory"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlayHistory({ size: 500 });
      return response.playHistory;
    },
    enabled: isReady,
  });

  // Extract songs from history entries (Song type already includes playedAt from the API)
  const songs: Song[] = historyData?.entry ?? [];
  
  // Filter and sort songs
  const displaySongs = useMemo(() => {
    let filtered = songs;
    
    // Apply filter
    if (debouncedFilter.trim()) {
      const query = debouncedFilter.toLowerCase();
      filtered = songs.filter(song =>
        song.title?.toLowerCase().includes(query) ||
        song.artist?.toLowerCase().includes(query) ||
        song.album?.toLowerCase().includes(query)
      );
    }
    
    // Apply sort
    return sortSongs(filtered, sortConfig.field, sortConfig.direction);
  }, [songs, debouncedFilter, sortConfig]);
  
  const totalDuration = displaySongs.reduce((acc, song) => acc + song.duration, 0);

  // Track selection
  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedSongs,
    addSelectedToQueue,
    starSelected,
  } = useTrackSelection(displaySongs);

  const handlePlaySelected = () => {
    const selected = getSelectedSongs();
    if (selected.length > 0) {
      playNow(selected, 0, HISTORY_QUEUE_SOURCE);
      clearSelection();
    }
  };

  const handlePlayAll = () => {
    if (displaySongs.length > 0) {
      setIsShuffled(false);
      playNow(displaySongs, 0, HISTORY_QUEUE_SOURCE);
    }
  };

  const handleShuffle = () => {
    if (displaySongs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...displaySongs].sort(() => Math.random() - 0.5);
      playNow(shuffled, 0, HISTORY_QUEUE_SOURCE);
    }
  };

  // Always render the same loading state on server and during hydration
  // This prevents hydration mismatches
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <DetailHeader
        icon={History}
        iconClassName="bg-linear-to-br from-purple-500 to-purple-800"
        gradientColor="rgba(147,51,234,0.2)"
        label="History"
        title="Recently Played"
        subtitle={`${formatCount(displaySongs.length, "song")} • ${formatTotalDuration(totalDuration)}`}
      />

      {/* Action buttons and toolbar */}
      <ActionBar
        onPlayAll={handlePlayAll}
        onShuffle={handleShuffle}
        disablePlay={isLoading || displaySongs.length === 0}
        toolbar={
          <SongListToolbar
            filter={filter}
            onFilterChange={setFilter}
            filterPlaceholder="Filter history..."
            sortConfig={sortConfig}
            onSortChange={setSortConfig}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        }
      />

      {/* Track list */}
      <div className={cn("px-4 lg:px-6 py-4", hasSelection && "select-none")}>
        {displaySongs.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={displaySongs}
              renderItem={(song) => (
                <SongCard
                  song={song}
                  queueSongs={displaySongs}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={(e) => handleSelect(song.id, e)}
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
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={(e) => handleSelect(song.id, e)}
                />
              )}
              renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
              getItemKey={(song) => song.id}
              estimateItemHeight={56}
            />
          )
        ) : songs.length > 0 ? (
          <EmptyFilterState message="No songs match your filter" />
        ) : (
          <EmptyState
            icon={History}
            title="No listening history"
            description="Start playing some music! Your recently played songs will appear here."
          />
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedCount}
        onClear={clearSelection}
        onPlayNow={handlePlaySelected}
        onPlayNext={() => addSelectedToQueue("next")}
        onAddToQueue={() => addSelectedToQueue("last")}
        onStar={() => starSelected(true)}
        onUnstar={() => starSelected(false)}
        onSelectAll={selectAll}
        getSelectedSongs={getSelectedSongs}
      />

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}
