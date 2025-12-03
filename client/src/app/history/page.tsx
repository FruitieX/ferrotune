"use client";

import { useState, useMemo } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion } from "framer-motion";
import { History, Play, Shuffle, Trash2, Music } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { recentlyPlayedAtom, clearHistoryAtom } from "@/lib/store/history";
import { playlistViewModeAtom, playlistSortAtom, playlistColumnVisibilityAtom } from "@/lib/store/ui";
import { Button } from "@/components/ui/button";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { formatCount, formatTotalDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import { sortSongs } from "@/lib/utils/sort-songs";

export default function HistoryPage() {
  const { isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const recentlyPlayed = useAtomValue(recentlyPlayedAtom);
  const clearHistory = useSetAtom(clearHistoryAtom);
  
  // Filter and view settings
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 300);
  const [viewMode, setViewMode] = useAtom(playlistViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(playlistSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(playlistColumnVisibilityAtom);
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  // Extract songs from history entries
  const songs = recentlyPlayed.map((entry) => entry.song);
  
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
      playNow(selected);
      clearSelection();
    }
  };

  const handlePlayAll = () => {
    if (displaySongs.length > 0) {
      setIsShuffled(false);
      playNow(displaySongs);
    }
  };

  const handleShuffle = () => {
    if (displaySongs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...displaySongs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
    }
  };

  const handleClearHistory = () => {
    clearHistory();
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
      <div className="relative">
        <div 
          className="absolute inset-0 h-[300px]"
          style={{
            background: `linear-gradient(180deg, rgba(147,51,234,0.2) 0%, rgba(10,10,10,1) 100%)`
          }}
        />

        <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
          <div className="flex items-center gap-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-48 h-48 rounded-lg bg-linear-to-br from-purple-500 to-purple-800 flex items-center justify-center shadow-xl"
            >
              <History className="w-20 h-20 text-white" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                History
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold mt-2">Recently Played</h1>
              <p className="mt-4 text-muted-foreground">
                {formatCount(displaySongs.length, "song")} • {formatTotalDuration(totalDuration)}
              </p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Action buttons and toolbar */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
          <Button
            size="lg"
            className="rounded-full gap-2 px-8"
            onClick={handlePlayAll}
            disabled={displaySongs.length === 0}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleShuffle}
            disabled={displaySongs.length === 0}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </Button>
          {songs.length > 0 && (
            <Button
              variant="ghost"
              size="lg"
              className="rounded-full gap-2 text-muted-foreground hover:text-destructive"
              onClick={handleClearHistory}
            >
              <Trash2 className="w-5 h-5" />
              Clear
            </Button>
          )}
          
          <div className="flex-1" />
          
          {/* Toolbar with filter/sort/columns/view mode */}
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
        </div>
      </div>

      {/* Track list */}
      <div className={cn("px-4 lg:px-6 py-4", hasSelection && "select-none")}>
        {displaySongs.length > 0 ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {displaySongs.map((song) => (
                <SongCard
                  key={song.id}
                  song={song}
                  queueSongs={displaySongs}
                  isSelected={isSelected(song.id)}
                  isSelectionMode={hasSelection}
                  onSelect={(e) => handleSelect(song.id, e)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {displaySongs.map((song, index) => (
                <SongRow
                  key={song.id}
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
              ))}
            </div>
          )
        ) : songs.length > 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Music className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">No songs match your filter</p>
          </div>
        ) : (
          <EmptyState />
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
      <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
        <History className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="font-semibold mb-1">No listening history</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Start playing some music! Your recently played songs will appear here.
      </p>
    </div>
  );
}
