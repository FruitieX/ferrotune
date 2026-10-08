import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useItemSelection } from "@/lib/hooks/use-track-selection";
import {
  albumViewModeAtom,
  libraryFilterAtom,
  libraryGenreColumnVisibilityAtom,
} from "@/lib/store/ui";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import {
  GenreCard,
  GenreCardSkeleton,
  GenreRow,
  GenreRowSkeleton,
} from "@/components/browse/genre-card";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { EmptyState } from "@/components/shared/empty-state";
import type { Genre } from "@/lib/api/types";

export default function GenresPage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const [viewMode] = useAtom(albumViewModeAtom);
  const filter = useAtomValue(libraryFilterAtom);
  const genreColumnVisibility = useAtomValue(libraryGenreColumnVisibilityAtom);
  const debouncedFilter = useDebounce(filter, 300);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  // Virtualized scroll restoration - pass viewMode to store separate positions per view
  const {
    getInitialOffset,
    saveOffset,
    getScrollToIndex,
    saveFirstVisibleIndex,
  } = useVirtualizedScrollRestoration("main-scroll-container", viewMode);

  // Fetch genres, filtered by name on the server
  const { data: genresData, isLoading } = useQuery({
    queryKey: ["genres", debouncedFilter.trim()],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getGenres({
        filter: debouncedFilter.trim(),
      });
      return response.genres?.genre ?? [];
    },
    enabled: isReady,
    placeholderData: (previous) => previous,
  });
  const filteredGenres = genresData ?? [];

  // Genre selection - use value as id since genres don't have an id field
  const genresWithId = filteredGenres.map((g) => ({
    ...g,
    id: g.value,
  }));

  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedItems,
  } = useItemSelection(genresWithId);

  // Selected genres as collection sources, materialized by the server
  const getSelectedSources = () =>
    getSelectedItems().map((genre) => ({
      sourceType: "genre" as const,
      sourceId: genre.value,
    }));

  // Bulk action handlers
  const startSelected = (shuffle: boolean) => {
    const sources = getSelectedSources();
    if (sources.length === 0) return;
    startQueue({
      sourceType: "genre",
      sourceName: `${sources.length} genres`,
      sources,
      shuffle,
    });
    clearSelection();
    toast.success(
      `${shuffle ? "Shuffling" : "Playing"} ${sources.length} genres`,
    );
  };

  const handleAddSelectedToQueue = async (position: "next" | "last") => {
    const sources = getSelectedSources();
    if (sources.length === 0) return;
    const result = await addToQueue({
      sources,
      sourceName: `${sources.length} genres`,
      position: position === "last" ? "end" : position,
    });
    if (!result.success || result.addedCount === 0) {
      toast.error("Selected genres are empty");
      return;
    }
    clearSelection();
    toast.success(
      `Added ${result.addedCount} songs to ${position === "next" ? "play next" : "queue"}`,
    );
  };

  if (authLoading) {
    return (
      <div className="p-4 lg:p-6">
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "p-4 lg:p-6",
        hasSelection && "select-none-during-selection",
      )}
    >
      {isLoading ? (
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 gap-4"
              : "space-y-1"
          }
        >
          {Array.from({ length: 8 }).map((_, i) =>
            viewMode === "grid" ? (
              <GenreCardSkeleton key={i} />
            ) : (
              <GenreRowSkeleton key={i} />
            ),
          )}
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
            columns={{ default: 3, sm: 3, md: 4, lg: 4, xl: 4 }}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
            scrollToIndex={getScrollToIndex()}
            onFirstVisibleIndexChange={saveFirstVisibleIndex}
          />
        ) : (
          <VirtualizedList
            items={genresWithId}
            renderItem={(genre, index) => (
              <GenreRow
                genre={genre}
                index={genreColumnVisibility.showIndex ? index : undefined}
                isSelected={isSelected(genre.id)}
                isSelectionMode={hasSelection}
                onSelect={(e) => handleSelect(genre.id, e)}
              />
            )}
            renderSkeleton={() => (
              <GenreRowSkeleton showIndex={genreColumnVisibility.showIndex} />
            )}
            getItemKey={(genre) => genre.value}
            estimateItemHeight={56}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
            onFirstVisibleIndexChange={saveFirstVisibleIndex}
          />
        )
      ) : (
        <EmptyState
          icon={Tag}
          title={
            debouncedFilter ? "No genres match your filter" : "No genres found"
          }
        />
      )}

      {/* Bulk actions bar */}
      <BulkActionsBar
        mediaType="genre"
        selectedCount={selectedCount}
        onClear={clearSelection}
        onPlayNow={() => startSelected(false)}
        onShuffle={() => startSelected(true)}
        onPlayNext={() => handleAddSelectedToQueue("next")}
        onAddToQueue={() => handleAddSelectedToQueue("last")}
        onSelectAll={selectAll}
        getSelectedItems={getSelectedItems as () => Genre[]}
      />
    </div>
  );
}
