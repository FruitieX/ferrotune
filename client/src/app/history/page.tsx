"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { motion } from "framer-motion";
import { History, Play, Shuffle, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { useTrackSelection } from "@/lib/hooks/use-track-selection";
import { playNowAtom, isShuffledAtom } from "@/lib/store/queue";
import { recentlyPlayedAtom, clearHistoryAtom } from "@/lib/store/history";
import { Button } from "@/components/ui/button";
import { TrackList } from "@/components/browse/track-list";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { formatCount, formatTotalDuration } from "@/lib/utils/format";

export default function HistoryPage() {
  const { isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const playNow = useSetAtom(playNowAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const recentlyPlayed = useAtomValue(recentlyPlayedAtom);
  const clearHistory = useSetAtom(clearHistoryAtom);
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  // Extract songs from history entries
  const songs = recentlyPlayed.map((entry) => entry.song);
  const totalDuration = songs.reduce((acc, song) => acc + song.duration, 0);

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
  } = useTrackSelection(songs);

  const handlePlaySelected = () => {
    const selected = getSelectedSongs();
    if (selected.length > 0) {
      playNow(selected);
      clearSelection();
    }
  };

  const handlePlayAll = () => {
    if (songs.length > 0) {
      setIsShuffled(false);
      playNow(songs);
    }
  };

  const handleShuffle = () => {
    if (songs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
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
                {formatCount(songs.length, "song")} • {formatTotalDuration(totalDuration)}
              </p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
          <Button
            size="lg"
            className="rounded-full gap-2 px-8"
            onClick={handlePlayAll}
            disabled={songs.length === 0}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleShuffle}
            disabled={songs.length === 0}
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
        </div>
      </div>

      {/* Track list */}
      {songs.length > 0 ? (
        <TrackList
          songs={songs}
          isLoading={false}
          showCover
          showHeader
          emptyMessage="No history yet"
          isSelected={isSelected}
          isSelectionMode={hasSelection}
          onSelect={handleSelect}
        />
      ) : (
        <EmptyState />
      )}

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
