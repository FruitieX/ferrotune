"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { VirtualizedGrid } from "@/components/shared/virtualized-grid";
import type { Genre } from "@/lib/api/types";

export default function GenresPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : genresData && genresData.length > 0 ? (
        <VirtualizedGrid
          items={genresData}
          renderItem={(genre) => <GenreCard genre={genre} />}
          renderSkeleton={() => <Skeleton className="h-24 rounded-lg" />}
          getItemKey={(genre) => genre.value}
          estimateItemHeight={96}
          columns={{ default: 2, sm: 3, md: 4, lg: 4, xl: 4 }}
        />
      ) : (
        <EmptyState message="No genres found" />
      )}
    </div>
  );
}

// Genre card component - no scale animation to avoid kerning issues
function GenreCard({ genre }: { genre: Genre }) {
  // Generate color from genre name
  const hash = genre.value.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const hue = Math.abs(hash % 360);

  return (
    <Link
      href={`/library/genres/details?name=${encodeURIComponent(genre.value)}`}
      className="relative h-24 rounded-lg overflow-hidden cursor-pointer block hover:ring-2 hover:ring-primary/50 transition-shadow"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 70%, 35%) 0%, hsl(${(hue + 30) % 360}, 60%, 25%) 100%)`,
      }}
    >
      <div className="absolute inset-0 flex flex-col justify-end p-4">
        <h3 className="font-bold text-white truncate">{genre.value}</h3>
        <p className="text-xs text-white/80">
          {genre.albumCount} albums • {genre.songCount} songs
        </p>
      </div>
    </Link>
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
