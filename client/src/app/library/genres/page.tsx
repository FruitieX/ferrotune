"use client";

import { useMemo } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useItemSelection } from "@/lib/hooks/use-track-selection";
import { albumViewModeAtom, libraryFilterAtom } from "@/lib/store/ui";
import { playNowAtom, addToQueueAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { GenreCard, GenreCardSkeleton, GenreRow, GenreRowSkeleton } from "@/components/browse/genre-card";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import type { Song, Genre } from "@/lib/api/types";

export default function GenresPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  
  // Virtualized scroll restoration
  const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration();

  // Fetch genres
  const { data: genresData, isLoading } = useQuery({
    queryKey: ["genres"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getGenres();
      return response.genres.genre;
    },
    enabled: isReady,
  });
  
  // Filter genres based on search filter (client-side - API doesn't support genre search)
  const filteredGenres = useMemo(() => {
    if (!debouncedFilter.trim() || !genresData) return genresData ?? [];
    const lowerFilter = debouncedFilter.toLowerCase();
    return genresData.filter((genre) =>
      genre.value.toLowerCase().includes(lowerFilter)
    );
  }, [genresData, debouncedFilter]);

  // Genre selection - use value as id since genres don't have an id field
  const genresWithId = useMemo(() => 
    filteredGenres.map(g => ({ ...g, id: g.value })),
    [filteredGenres]
  );

  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedItems,
  } = useItemSelection(genresWithId);

  // Get songs from selected genres
  const getSelectedGenresSongs = async (): Promise<Song[]> => {
    const client = getClient();
    if (!client) return [];
    
    const genres = getSelectedItems();
    const songsPromises = genres.map(genre => 
      client.getSongsByGenre(genre.value, { count: 500 }).then(res => res.songsByGenre.song ?? [])
    );
    const songsArrays = await Promise.all(songsPromises);
    return songsArrays.flat();
  };

  // Bulk action handlers
  const handlePlaySelected = async () => {
    const songs = await getSelectedGenresSongs();
    if (songs.length > 0) {
      playNow(songs);
      clearSelection();
      toast.success(`Playing ${songs.length} songs from ${selectedCount} genres`);
    }
  };

  const handleShuffleSelected = async () => {
    const songs = await getSelectedGenresSongs();
    if (songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      clearSelection();
      toast.success(`Shuffling ${songs.length} songs from ${selectedCount} genres`);
    }
  };

  const handleAddSelectedToQueue = async (position: "next" | "last") => {
    const songs = await getSelectedGenresSongs();
    if (songs.length > 0) {
      songs.forEach(song => addToQueue(song, position));
      clearSelection();
      toast.success(`Added ${songs.length} songs to ${position === "next" ? "play next" : "queue"}`);
    }
  };

  if (authLoading) {
    return (
      <div className="p-4 lg:p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("p-4 lg:p-6", hasSelection && "select-none-during-selection")}>
      {isLoading ? (
        <div className={viewMode === "grid"
          ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
          : "space-y-1"
        }>
          {Array.from({ length: 8 }).map((_, i) => (
            viewMode === "grid" ? (
              <GenreCardSkeleton key={i} />
            ) : (
              <GenreRowSkeleton key={i} />
            )
          ))}
        </div>
      ) : genresData && genresData.length > 0 ? (
        viewMode === "grid" ? (
          <VirtualizedGrid
            items={genresWithId}
            renderItem={(genre) => (
              <GenreCard 
                genre={genre}
                isSelected={isSelected(genre.id)}
                isSelectionMode={hasSelection}
                onSelect={(e) => handleSelect(genre.id, e)}
              />
            )}
            renderSkeleton={() => <GenreCardSkeleton />}
            getItemKey={(genre) => genre.value}
            estimateItemHeight={96}
            columns={{ default: 2, sm: 3, md: 4, lg: 4, xl: 4 }}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
          <VirtualizedList
            items={genresWithId}
            renderItem={(genre, index) => (
              <GenreRow 
                genre={genre}
                index={index}
                isSelected={isSelected(genre.id)}
                isSelectionMode={hasSelection}
                onSelect={(e) => handleSelect(genre.id, e)}
              />
            )}
            renderSkeleton={() => <GenreRowSkeleton />}
            getItemKey={(genre) => genre.value}
            estimateItemHeight={56}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        )
      ) : (
        <EmptyState message={debouncedFilter ? "No genres match your filter" : "No genres found"} />
      )}

      {/* Bulk actions bar */}
      <BulkActionsBar
        mediaType="genre"
        selectedCount={selectedCount}
        onClear={clearSelection}
        onPlayNow={handlePlaySelected}
        onShuffle={handleShuffleSelected}
        onPlayNext={() => handleAddSelectedToQueue("next")}
        onAddToQueue={() => handleAddSelectedToQueue("last")}
        onSelectAll={selectAll}
        getSelectedItems={getSelectedItems as () => Genre[]}
      />
    </div>
  );
}

// Empty state component
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
        <Tag className="w-10 h-10 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
