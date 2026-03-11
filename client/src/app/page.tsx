"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSetAtom } from "jotai";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  Play,
  Clock,
  Sparkles,
  TrendingUp,
  Shuffle,
  Search,
  ListMusic,
  Heart,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { startQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import { SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { MediaCard } from "@/components/shared/media-card";
import { VirtualizedHorizontalScroll } from "@/components/shared/virtualized-horizontal-scroll";
import { MobileProfileMenu } from "@/components/layout/mobile-profile-menu";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { formatDuration } from "@/lib/utils/format";
import type { Album, Song } from "@/lib/api/types";
import type { RecentPlaylistEntry } from "@/lib/api/generated/RecentPlaylistEntry";

// Maximum items per home page section to avoid tiny scrollbars
const MAX_SECTION_ITEMS = 100;

// Compute page size based on viewport width to avoid loading too many items on mobile
function getPageSize(viewportWidth: number, itemWidth: number, gap: number) {
  const itemsPerScreen = Math.ceil(viewportWidth / (itemWidth + gap));
  // Load ~2 screenfuls per page for smooth scrolling
  return Math.max(6, itemsPerScreen * 2);
}

// Section header component
function SectionHeader({
  title,
  icon: Icon,
  hasItems,
  isLoading,
  onPlayAll,
  onShuffleAll,
  viewAllHref,
}: {
  title: string;
  icon: React.ElementType;
  hasItems: boolean;
  isLoading: boolean;
  onPlayAll?: () => void;
  onShuffleAll?: () => void;
  viewAllHref?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 lg:px-6">
      <Icon className="w-5 h-5 text-primary" />
      <h2 className="text-lg sm:text-xl font-bold">{title}</h2>
      {hasItems && (
        <div className="flex items-center gap-1 ml-auto">
          {onPlayAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onPlayAll}
                  disabled={isLoading}
                >
                  <Play className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Play all</TooltipContent>
            </Tooltip>
          )}
          {onShuffleAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onShuffleAll}
                  disabled={isLoading}
                >
                  <Shuffle className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Shuffle all</TooltipContent>
            </Tooltip>
          )}
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors ml-1"
            >
              View all
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// Section component for album rows with virtualization and infinite scroll
function AlbumSection({
  title,
  icon,
  albums,
  totalCount,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onPlayAlbum,
  onPlayAll,
  onShuffleAll,
  itemWidth,
  itemGap,
  paddingX,
}: {
  title: string;
  icon: React.ElementType;
  albums: Album[];
  totalCount?: number;
  isLoading: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  onPlayAlbum: (album: Album) => void;
  onPlayAll?: () => void;
  onShuffleAll?: () => void;
  itemWidth: number;
  itemGap: number;
  paddingX: number;
}) {
  return (
    <section className="space-y-2 sm:space-y-4">
      <SectionHeader
        title={title}
        icon={icon}
        hasItems={albums.length > 0}
        isLoading={isLoading}
        onPlayAll={onPlayAll}
        onShuffleAll={onShuffleAll}
      />
      <VirtualizedHorizontalScroll<Album>
        items={albums}
        totalCount={totalCount}
        isLoading={isLoading}
        itemWidth={itemWidth}
        gap={itemGap}
        paddingX={paddingX}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        renderItem={(album) => (
          <AlbumCard album={album} onPlay={() => onPlayAlbum(album)} />
        )}
        renderSkeleton={() => <AlbumCardSkeleton />}
        getItemKey={(album) => album.id}
        emptyMessage="No albums found"
      />
    </section>
  );
}

// Playlist card for home page sections
function HomePlaylistCard({
  playlist,
  onPlay,
}: {
  playlist: {
    id: string;
    name: string;
    playlistType: string;
    songCount: number;
    duration: number;
    coverArt: string | null;
  };
  onPlay: () => void;
}) {
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, "medium")
    : undefined;

  const isSmartPlaylist = playlist.playlistType === "smartPlaylist";
  const href = isSmartPlaylist
    ? `/playlists/smart/details?id=${playlist.id}`
    : `/playlists/details?id=${playlist.id}`;

  const PlaylistIcon = isSmartPlaylist ? Sparkles : ListMusic;

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={playlist.name}
      titleIcon={
        <PlaylistIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
      }
      subtitleContent={
        <span className="flex items-center gap-1">
          {playlist.songCount} {playlist.songCount === 1 ? "song" : "songs"} •{" "}
          <Clock className="w-3 h-3" /> {formatDuration(playlist.duration)}
        </span>
      }
      href={href}
      coverType={isSmartPlaylist ? "smartPlaylist" : "playlist"}
      colorSeed={playlist.name}
      onPlay={onPlay}
    />
  );
}

export default function HomePage() {
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const startQueue = useSetAtom(startQueueAtom);
  const isMounted = useIsMounted();
  const [searchQuery, setSearchQuery] = useState("");
  const isSmallScreen = useIsSmallScreen();
  // Store the random seed from the first Discover page for consistent pagination
  const discoverSeedRef = useRef<number | undefined>(undefined);
  // Store the random seed for Forgotten Favorites for consistent pagination
  const forgottenFavSeedRef = useRef<number | undefined>(undefined);

  // Responsive item dimensions
  const itemWidth = isSmallScreen ? 130 : 180;
  const itemGap = isSmallScreen ? 8 : 16;
  const paddingX = isSmallScreen ? 12 : 24;

  // Dynamic page size based on viewport width
  const pageSize =
    typeof window !== "undefined"
      ? getPageSize(window.innerWidth, itemWidth, itemGap)
      : 15;

  // Navigate to search when user starts typing
  const handleSearchFocus = () => {
    router.push("/search");
  };

  // --- Infinite queries for album sections ---

  const {
    data: newestData,
    isLoading: loadingNewest,
    hasNextPage: hasNextNewest,
    isFetchingNextPage: fetchingNextNewest,
    fetchNextPage: fetchNextNewest,
  } = useInfiniteQuery({
    queryKey: ["albums", "newest", "home"],
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: "newest",
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
      });
      return {
        albums: response.albumList2.album ?? [],
        total: response.albumList2.total,
        nextOffset: pageParam + pageSize,
        pageSize,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.nextOffset >= MAX_SECTION_ITEMS) return undefined;
      const cap =
        lastPage.total != null
          ? Math.min(lastPage.total, MAX_SECTION_ITEMS)
          : MAX_SECTION_ITEMS;
      if (lastPage.total == null) {
        return lastPage.albums.length >= lastPage.pageSize
          ? lastPage.nextOffset
          : undefined;
      }
      return lastPage.nextOffset < cap ? lastPage.nextOffset : undefined;
    },
    enabled: isReady,
  });

  const {
    data: randomData,
    isLoading: loadingRandom,
    hasNextPage: hasNextRandom,
    isFetchingNextPage: fetchingNextRandom,
    fetchNextPage: fetchNextRandom,
  } = useInfiniteQuery({
    queryKey: ["albums", "random", "home"],
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: "random",
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
        seed: discoverSeedRef.current,
      });
      // Store the seed from the first page for consistent pagination
      if (pageParam === 0 && response.albumList2.seed != null) {
        discoverSeedRef.current = response.albumList2.seed;
      }
      return {
        albums: response.albumList2.album ?? [],
        total: response.albumList2.total,
        seed: response.albumList2.seed,
        nextOffset: pageParam + pageSize,
        pageSize,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.nextOffset >= MAX_SECTION_ITEMS) return undefined;
      const cap =
        lastPage.total != null
          ? Math.min(lastPage.total, MAX_SECTION_ITEMS)
          : MAX_SECTION_ITEMS;
      if (lastPage.total == null) {
        return lastPage.albums.length >= lastPage.pageSize
          ? lastPage.nextOffset
          : undefined;
      }
      return lastPage.nextOffset < cap ? lastPage.nextOffset : undefined;
    },
    enabled: isReady,
  });

  const {
    data: frequentData,
    isLoading: loadingFrequent,
    hasNextPage: hasNextFrequent,
    isFetchingNextPage: fetchingNextFrequent,
    fetchNextPage: fetchNextFrequent,
  } = useInfiniteQuery({
    queryKey: ["albums", "frequent-recent", "home"],
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const response = await client.getAlbumList2({
        type: "frequent",
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
        since: since.toISOString(),
      });
      return {
        albums: response.albumList2.album ?? [],
        total: response.albumList2.total,
        nextOffset: pageParam + pageSize,
        pageSize,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.nextOffset >= MAX_SECTION_ITEMS) return undefined;
      const cap =
        lastPage.total != null
          ? Math.min(lastPage.total, MAX_SECTION_ITEMS)
          : MAX_SECTION_ITEMS;
      if (lastPage.total == null) {
        return lastPage.albums.length >= lastPage.pageSize
          ? lastPage.nextOffset
          : undefined;
      }
      return lastPage.nextOffset < cap ? lastPage.nextOffset : undefined;
    },
    enabled: isReady,
  });

  // --- Forgotten Favorites: songs played a lot long ago but not recently ---
  const {
    data: forgottenFavData,
    isLoading: loadingForgottenFav,
    hasNextPage: hasNextForgottenFav,
    isFetchingNextPage: fetchingNextForgottenFav,
    fetchNextPage: fetchNextForgottenFav,
  } = useInfiniteQuery({
    queryKey: ["songs", "forgotten-favorites", "home"],
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getForgottenFavorites({
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
        seed: forgottenFavSeedRef.current,
      });
      // Store the seed from the first page for consistent pagination
      if (pageParam === 0) {
        forgottenFavSeedRef.current = response.seed;
      }
      return {
        songs: response.song ?? [],
        total: response.total,
        seed: response.seed,
        nextOffset: pageParam + pageSize,
        pageSize,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.nextOffset >= MAX_SECTION_ITEMS) return undefined;
      const cap = Math.min(lastPage.total, MAX_SECTION_ITEMS);
      return lastPage.nextOffset < cap ? lastPage.nextOffset : undefined;
    },
    enabled: isReady,
  });

  // --- Continue Listening: merge recent albums + playlists ---
  // Recent albums use infinite query for pagination
  const {
    data: recentData,
    isLoading: loadingRecent,
    hasNextPage: hasNextRecent,
    isFetchingNextPage: fetchingNextRecent,
    fetchNextPage: fetchNextRecent,
  } = useInfiniteQuery({
    queryKey: ["albums", "recent", "home"],
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: "recent",
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
      });
      return {
        albums: response.albumList2.album ?? [],
        total: response.albumList2.total,
        nextOffset: pageParam + pageSize,
        pageSize,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.nextOffset >= MAX_SECTION_ITEMS) return undefined;
      const cap =
        lastPage.total != null
          ? Math.min(lastPage.total, MAX_SECTION_ITEMS)
          : MAX_SECTION_ITEMS;
      if (lastPage.total == null) {
        return lastPage.albums.length >= lastPage.pageSize
          ? lastPage.nextOffset
          : undefined;
      }
      return lastPage.nextOffset < cap ? lastPage.nextOffset : undefined;
    },
    enabled: isReady,
  });

  // Playlists don't support pagination - fetch all at once
  const { data: recentPlaylists, isLoading: loadingRecentPlaylists } = useQuery(
    {
      queryKey: ["playlists", "recently-played"],
      queryFn: async () => {
        const client = getClient();
        if (!client) throw new Error("Not connected");
        const response = await client.getRecentlyPlayedPlaylists();
        return response.playlists;
      },
      enabled: isReady,
    },
  );

  // Flatten infinite query pages and cap totals at MAX_SECTION_ITEMS
  const newestAlbums = newestData?.pages.flatMap((p) => p.albums) ?? [];
  const newestTotal =
    newestData?.pages[0]?.total != null
      ? Math.min(newestData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const randomAlbums = randomData?.pages.flatMap((p) => p.albums) ?? [];
  const randomTotal =
    randomData?.pages[0]?.total != null
      ? Math.min(randomData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const frequentAlbums = frequentData?.pages.flatMap((p) => p.albums) ?? [];
  const frequentTotal =
    frequentData?.pages[0]?.total != null
      ? Math.min(frequentData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const forgottenFavSongs =
    forgottenFavData?.pages.flatMap((p) => p.songs) ?? [];
  const forgottenFavTotal =
    forgottenFavData?.pages[0]?.total != null
      ? Math.min(forgottenFavData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const recentAlbums = recentData?.pages.flatMap((p) => p.albums) ?? [];
  const recentAlbumTotal = recentData?.pages[0]?.total;

  // Merge recently played albums and playlists, sorted by last played time
  type ContinueListeningItem =
    | { type: "album"; album: Album; lastPlayed: string }
    | {
        type: "playlist";
        playlist: RecentPlaylistEntry;
        lastPlayed: string;
      };

  const continueListeningItems: ContinueListeningItem[] = [];
  if (recentAlbums.length > 0) {
    for (const album of recentAlbums) {
      if (album.played) {
        continueListeningItems.push({
          type: "album",
          album,
          lastPlayed: album.played,
        });
      }
    }
  }
  if (recentPlaylists) {
    for (const pl of recentPlaylists) {
      continueListeningItems.push({
        type: "playlist",
        playlist: pl,
        lastPlayed: pl.lastPlayedAt,
      });
    }
  }
  continueListeningItems.sort(
    (a, b) =>
      new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime(),
  );

  // Compute total for Continue Listening: album total + playlist count, capped
  const playlistCount = recentPlaylists?.length ?? 0;
  const continueListeningTotal =
    recentAlbumTotal != null
      ? Math.min(recentAlbumTotal + playlistCount, MAX_SECTION_ITEMS)
      : undefined;

  // Play album - uses server-side queue (always disables shuffle)
  const handlePlayAlbum = async (album: Album) => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
      startIndex: 0,
      shuffle: false,
    });
  };

  // Play playlist (always disables shuffle)
  const handlePlayPlaylist = (
    id: string,
    name: string,
    type: "playlist" | "smartPlaylist",
  ) => {
    startQueue({
      sourceType: type,
      sourceId: id,
      sourceName: name,
      startIndex: 0,
      shuffle: false,
    });
  };

  // Play all albums in a section via server-side queue materialization
  const handlePlayAllAlbums = (
    listType: string,
    sectionName: string,
    filters?: Record<string, unknown>,
  ) => {
    startQueue({
      sourceType: "albumList",
      sourceId: listType,
      sourceName: sectionName,
      startIndex: 0,
      shuffle: false,
      filters,
    });
  };

  // Shuffle all albums in a section via server-side queue materialization
  const handleShuffleAllAlbums = (
    listType: string,
    sectionName: string,
    filters?: Record<string, unknown>,
  ) => {
    startQueue({
      sourceType: "albumList",
      sourceId: listType,
      sourceName: sectionName,
      startIndex: 0,
      shuffle: true,
      filters,
    });
  };

  // Always render the same loading state on server and during hydration
  // This prevents hydration mismatches
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-dvh">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
          <div className="flex items-center gap-4 h-16 px-4 lg:px-6">
            <h1 className="text-2xl font-bold">Home</h1>
            <div className="flex-1 flex justify-center">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Skeleton className="h-10 w-full rounded-full" />
              </div>
            </div>
          </div>
        </header>

        {/* Content skeleton */}
        <div className="py-6 space-y-8">
          {/* Four sections */}
          {Array.from({ length: 4 }).map((_, sectionIndex) => (
            <section key={sectionIndex} className="space-y-4">
              <div className="flex items-center gap-2 px-4 lg:px-6">
                <Skeleton className="w-5 h-5" />
                <Skeleton className="h-7 w-48" />
              </div>
              <div className="flex gap-4 px-4 lg:px-6 pb-4 overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="w-[180px] shrink-0">
                    <AlbumCardSkeleton />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  // Render function for continue listening items
  const renderContinueListeningItem = (item: ContinueListeningItem) => {
    if (item.type === "playlist") {
      return (
        <HomePlaylistCard
          playlist={item.playlist}
          onPlay={() =>
            handlePlayPlaylist(
              item.playlist.id,
              item.playlist.name,
              item.playlist.playlistType as "playlist" | "smartPlaylist",
            )
          }
        />
      );
    }
    return (
      <AlbumCard
        album={item.album}
        onPlay={() => handlePlayAlbum(item.album)}
      />
    );
  };

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 h-16 px-4 lg:px-6">
          <MobileProfileMenu />
          <h1 className="text-2xl font-bold">Home</h1>
          <div className="flex-1 flex justify-center">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={handleSearchFocus}
                className="pl-9 h-10 bg-secondary border-0 rounded-full cursor-pointer"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="py-4 sm:py-6 space-y-6 sm:space-y-8">
        {/* Continue Listening (Recently Played Albums + Playlists, sorted by last played) */}
        <section className="space-y-2 sm:space-y-4">
          <SectionHeader
            title="Continue Listening"
            icon={Play}
            hasItems={continueListeningItems.length > 0}
            isLoading={loadingRecent || loadingRecentPlaylists}
            onPlayAll={() =>
              startQueue({
                sourceType: "continueListening",
                sourceName: "Continue Listening",
                startIndex: 0,
                shuffle: false,
              })
            }
            onShuffleAll={() =>
              startQueue({
                sourceType: "continueListening",
                sourceName: "Continue Listening",
                startIndex: 0,
                shuffle: true,
              })
            }
          />
          <VirtualizedHorizontalScroll<ContinueListeningItem>
            items={continueListeningItems}
            totalCount={continueListeningTotal}
            isLoading={loadingRecent || loadingRecentPlaylists}
            itemWidth={itemWidth}
            gap={itemGap}
            paddingX={paddingX}
            hasNextPage={hasNextRecent}
            isFetchingNextPage={fetchingNextRecent}
            fetchNextPage={fetchNextRecent}
            renderItem={(item) => renderContinueListeningItem(item)}
            renderSkeleton={() => <AlbumCardSkeleton />}
            getItemKey={(item) =>
              item.type === "playlist"
                ? `pl-${item.playlist.id}`
                : item.album.id
            }
            emptyMessage="No recently played items"
          />
        </section>

        {/* Most Played Recently */}
        <AlbumSection
          title="Most Played Recently"
          icon={TrendingUp}
          albums={frequentAlbums}
          totalCount={frequentTotal}
          isLoading={loadingFrequent}
          hasNextPage={hasNextFrequent}
          isFetchingNextPage={fetchingNextFrequent}
          fetchNextPage={fetchNextFrequent}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() => {
            const since = new Date();
            since.setDate(since.getDate() - 30);
            handlePlayAllAlbums("frequent", "Most Played Recently", {
              since: since.toISOString(),
            });
          }}
          onShuffleAll={() => {
            const since = new Date();
            since.setDate(since.getDate() - 30);
            handleShuffleAllAlbums("frequent", "Most Played Recently", {
              since: since.toISOString(),
            });
          }}
          itemWidth={itemWidth}
          itemGap={itemGap}
          paddingX={paddingX}
        />

        {/* Forgotten Favorites */}
        {(forgottenFavSongs.length > 0 || loadingForgottenFav) && (
          <section className="space-y-2 sm:space-y-4">
            <SectionHeader
              title="Forgotten Favorites"
              icon={Heart}
              hasItems={forgottenFavSongs.length > 0}
              isLoading={loadingForgottenFav}
              onPlayAll={() =>
                startQueue({
                  sourceType: "forgottenFavorites",
                  sourceName: "Forgotten Favorites",
                  startIndex: 0,
                  shuffle: false,
                  filters: { seed: forgottenFavSeedRef.current },
                })
              }
              onShuffleAll={() =>
                startQueue({
                  sourceType: "forgottenFavorites",
                  sourceName: "Forgotten Favorites",
                  startIndex: 0,
                  shuffle: true,
                  filters: { seed: forgottenFavSeedRef.current },
                })
              }
            />
            <VirtualizedHorizontalScroll<Song>
              items={forgottenFavSongs}
              totalCount={forgottenFavTotal}
              isLoading={loadingForgottenFav}
              itemWidth={itemWidth}
              gap={itemGap}
              paddingX={paddingX}
              hasNextPage={hasNextForgottenFav}
              isFetchingNextPage={fetchingNextForgottenFav}
              fetchNextPage={fetchNextForgottenFav}
              renderItem={(song, index) => (
                <SongCard
                  song={song}
                  index={index}
                  queueSource={{
                    type: "forgottenFavorites",
                    name: "Forgotten Favorites",
                    filters: { seed: forgottenFavSeedRef.current },
                  }}
                  inlineImagesRequested
                />
              )}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(song) => song.id}
              emptyMessage="No forgotten favorites"
            />
          </section>
        )}

        {/* Discover */}
        <AlbumSection
          title="Discover Something New"
          icon={Sparkles}
          albums={randomAlbums}
          totalCount={randomTotal}
          isLoading={loadingRandom}
          hasNextPage={hasNextRandom}
          isFetchingNextPage={fetchingNextRandom}
          fetchNextPage={fetchNextRandom}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() =>
            handlePlayAllAlbums("random", "Discover", {
              seed: discoverSeedRef.current,
            })
          }
          onShuffleAll={() =>
            handleShuffleAllAlbums("random", "Discover", {
              seed: discoverSeedRef.current,
            })
          }
          itemWidth={itemWidth}
          itemGap={itemGap}
          paddingX={paddingX}
        />

        {/* Recently Added */}
        <AlbumSection
          title="Recently Added"
          icon={Clock}
          albums={newestAlbums}
          totalCount={newestTotal}
          isLoading={loadingNewest}
          hasNextPage={hasNextNewest}
          isFetchingNextPage={fetchingNextNewest}
          fetchNextPage={fetchNextNewest}
          onPlayAlbum={handlePlayAlbum}
          onPlayAll={() => handlePlayAllAlbums("newest", "Recently Added")}
          onShuffleAll={() =>
            handleShuffleAllAlbums("newest", "Recently Added")
          }
          itemWidth={itemWidth}
          itemGap={itemGap}
          paddingX={paddingX}
        />
      </div>
    </div>
  );
}
