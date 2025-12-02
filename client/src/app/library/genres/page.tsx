"use client";

import { useAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { albumViewModeAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { GenreCard, GenreCardSkeleton, GenreRow, GenreRowSkeleton } from "@/components/browse/genre-card";

export default function GenresPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const [viewMode] = useAtom(albumViewModeAtom);
  
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
    <div className="p-4 lg:p-6">
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
            items={genresData}
            renderItem={(genre) => <GenreCard genre={genre} />}
            renderSkeleton={() => <GenreCardSkeleton />}
            getItemKey={(genre) => genre.value}
            estimateItemHeight={96}
            columns={{ default: 2, sm: 3, md: 4, lg: 4, xl: 4 }}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        ) : (
          <VirtualizedList
            items={genresData}
            renderItem={(genre) => <GenreRow genre={genre} />}
            renderSkeleton={() => <GenreRowSkeleton />}
            getItemKey={(genre) => genre.value}
            estimateItemHeight={56}
            initialOffset={getInitialOffset()}
            onScrollChange={saveOffset}
          />
        )
      ) : (
        <EmptyState message="No genres found" />
      )}
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
