"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAtomValue, useSetAtom } from "jotai";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  Play,
  Clock,
  Radio,
  Sparkles,
  TrendingUp,
  Shuffle,
  Search,
  ListMusic,
  Heart,
  History,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { startQueueAtom } from "@/lib/store/server-queue";
import { accountKey, serverConnectionAtom } from "@/lib/store/auth";
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
import { PlaylistContextMenu } from "@/components/playlists/playlist-context-menu";
import { SmartPlaylistContextMenu } from "@/components/playlists/smart-playlist-context-menu";
import { VirtualizedHorizontalScroll } from "@/components/shared/virtualized-horizontal-scroll";
import { MobileProfileMenu } from "@/components/layout/mobile-profile-menu";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { formatDuration } from "@/lib/utils/format";
import {
  getPlaylistDetailsHref,
  getSongRadioHref,
} from "@/lib/utils/source-links";
import type { Album, Song } from "@/lib/api/types";
import type { ContinueListeningEntry } from "@/lib/api/generated/ContinueListeningEntry";
import type { HomePageResponse } from "@/lib/api/generated/HomePageResponse";

// Maximum items per home page section to avoid tiny scrollbars
const MAX_SECTION_ITEMS = 100;
const DISCOVER_QUERY_KEY = ["albums", "random", "home"] as const;
const FORGOTTEN_FAVORITES_QUERY_KEY = [
  "songs",
  "forgotten-favorites",
  "home",
] as const;

// Compute page size based on viewport width to avoid loading too many items on mobile
function getPageSize(viewportWidth: number, itemWidth: number, gap: number) {
  const itemsPerScreen = Math.ceil(viewportWidth / (itemWidth + gap));
  // Load ~2 screenfuls per page for smooth scrolling
  return Math.max(6, itemsPerScreen * 2);
}

function useStickyHomeSection<TPage>(
  queryKey: readonly unknown[],
  data: InfiniteData<TPage, unknown> | undefined,
  resetKey: string,
): InfiniteData<TPage, unknown> | undefined {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState<{
    resetKey: string;
    data: InfiniteData<TPage, unknown> | undefined;
  }>(() => ({
    resetKey,
    data:
      queryClient.getQueryData<InfiniteData<TPage, unknown>>(queryKey) ?? data,
  }));

  let derivedSnapshot = snapshot;

  if (snapshot.resetKey !== resetKey) {
    derivedSnapshot = {
      resetKey,
      data:
        queryClient.getQueryData<InfiniteData<TPage, unknown>>(queryKey) ??
        data,
    };
  } else if (data) {
    if (!snapshot.data) {
      derivedSnapshot = {
        resetKey,
        data,
      };
    } else if (data.pages.length > snapshot.data.pages.length) {
      derivedSnapshot = {
        resetKey,
        data: {
          pages: [
            ...snapshot.data.pages,
            ...data.pages.slice(snapshot.data.pages.length),
          ],
          pageParams: data.pageParams,
        },
      };
    }
  }

  useEffect(() => {
    if (derivedSnapshot === snapshot) {
      return;
    }

    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        setSnapshot(derivedSnapshot);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [derivedSnapshot, snapshot]);

  return derivedSnapshot.data ?? data;
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
  const href = getPlaylistDetailsHref(playlist.playlistType, playlist.id);

  const PlaylistIcon = isSmartPlaylist ? Sparkles : ListMusic;

  const contextMenu = isSmartPlaylist
    ? (children: React.ReactNode) => (
        <SmartPlaylistContextMenu
          smartPlaylist={{
            id: playlist.id,
            name: playlist.name,
            comment: null,
            isPublic: false,
            rules: { conditions: [], logic: "and" },
            sortField: null,
            sortDirection: null,
            maxSongs: null,
            folderId: null,
            songCount: playlist.songCount,
            createdAt: "",
            updatedAt: "",
          }}
        >
          {children}
        </SmartPlaylistContextMenu>
      )
    : (children: React.ReactNode) => (
        <PlaylistContextMenu
          playlist={{
            id: playlist.id,
            name: playlist.name,
            comment: null,
            owner: "",
            public: false,
            songCount: playlist.songCount,
            duration: playlist.duration,
            created: "",
            changed: "",
            coverArt: playlist.coverArt,
          }}
        >
          {children}
        </PlaylistContextMenu>
      );

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
      contextMenu={contextMenu}
    />
  );
}

function HomeSongRadioCard({
  source,
  onPlay,
}: {
  source: {
    id: string;
    name: string;
    coverArt: string | null;
  };
  onPlay: () => void;
}) {
  const coverArtUrl = source.coverArt
    ? getClient()?.getCoverArtUrl(source.coverArt, "medium")
    : undefined;

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={source.name}
      titleIcon={<Radio className="w-4 h-4 shrink-0 text-muted-foreground" />}
      subtitle="Song Radio"
      href={getSongRadioHref(source.id)}
      coverType="song"
      colorSeed={source.name}
      onPlay={onPlay}
    />
  );
}

export default function HomePage() {
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const connection = useAtomValue(serverConnectionAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const isMounted = useIsMounted();
  const [searchQuery, setSearchQuery] = useState("");
  const isSmallScreen = useIsSmallScreen();
  const currentAccountKey = connection
    ? accountKey(connection)
    : "__no_account__";
  // Store the random seed from the first Discover page for consistent pagination
  const discoverSeedRef = useRef<number | undefined>(undefined);
  // Store the random seed for Forgotten Favorites for consistent pagination
  const forgottenFavSeedRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    discoverSeedRef.current = undefined;
    forgottenFavSeedRef.current = undefined;
  }, [currentAccountKey]);

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

  // --- Batch fetch for initial home page load ---
  // All initial page fetches (page 0) go through one HTTP request to /ferrotune/home.
  // Subsequent pages (infinite scroll) use individual endpoints.
  const batchPromiseRef = useRef<Promise<HomePageResponse> | null>(null);
  const fetchBatch = (): Promise<HomePageResponse> => {
    if (!batchPromiseRef.current) {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      batchPromiseRef.current = client.getHomePage({
        size: pageSize,
        inlineImages: "medium",
      });
      // After the batch resolves, clear the ref so that future resets
      // (e.g., account switch) create a fresh request
      batchPromiseRef.current.finally(() => {
        setTimeout(() => {
          batchPromiseRef.current = null;
        }, 100);
      });
    }
    return batchPromiseRef.current;
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
      if (pageParam === 0) {
        const batch = await fetchBatch();
        return {
          albums: batch.recentlyAdded.album,
          total: batch.recentlyAdded.total,
          nextOffset: pageSize,
          pageSize,
        };
      }
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
    queryKey: DISCOVER_QUERY_KEY,
    queryFn: async ({ pageParam }) => {
      if (pageParam === 0) {
        const batch = await fetchBatch();
        if (
          discoverSeedRef.current === undefined &&
          batch.discover.seed != null
        ) {
          discoverSeedRef.current = batch.discover.seed;
        }
        return {
          albums: batch.discover.album,
          total: batch.discover.total,
          seed: batch.discover.seed,
          nextOffset: pageSize,
          pageSize,
        };
      }
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: "random",
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
        seed: discoverSeedRef.current,
      });
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
      if (pageParam === 0) {
        const batch = await fetchBatch();
        return {
          albums: batch.mostPlayedRecently.album,
          total: batch.mostPlayedRecently.total,
          nextOffset: pageSize,
          pageSize,
        };
      }
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
    queryKey: FORGOTTEN_FAVORITES_QUERY_KEY,
    queryFn: async ({ pageParam }) => {
      if (pageParam === 0) {
        const batch = await fetchBatch();
        if (forgottenFavSeedRef.current === undefined) {
          forgottenFavSeedRef.current = batch.forgottenFavorites.seed;
        }
        return {
          songs: batch.forgottenFavorites.song,
          total: batch.forgottenFavorites.total,
          seed: batch.forgottenFavorites.seed,
          nextOffset: pageSize,
          pageSize,
        };
      }
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getForgottenFavorites({
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
        seed: forgottenFavSeedRef.current,
      });
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

  // --- Continue Listening: unified endpoint with albums + playlists ---
  const {
    data: continueListeningData,
    isLoading: loadingContinueListening,
    hasNextPage: hasNextContinueListening,
    isFetchingNextPage: fetchingNextContinueListening,
    fetchNextPage: fetchNextContinueListening,
  } = useInfiniteQuery({
    queryKey: ["continue-listening", "home"],
    queryFn: async ({ pageParam }) => {
      if (pageParam === 0) {
        const batch = await fetchBatch();
        return {
          entries: batch.continueListening.entries,
          total: batch.continueListening.total,
          nextOffset: pageSize,
          pageSize,
        };
      }
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getContinueListening({
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
      });
      return {
        entries: response.entries,
        total: response.total,
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

  const stickyRandomData = useStickyHomeSection(
    DISCOVER_QUERY_KEY,
    randomData,
    currentAccountKey,
  );
  const stickyForgottenFavData = useStickyHomeSection(
    FORGOTTEN_FAVORITES_QUERY_KEY,
    forgottenFavData,
    currentAccountKey,
  );

  // Flatten infinite query pages and cap totals at MAX_SECTION_ITEMS
  const newestAlbums = newestData?.pages.flatMap((p) => p.albums) ?? [];
  const newestTotal =
    newestData?.pages[0]?.total != null
      ? Math.min(newestData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const randomAlbums = stickyRandomData?.pages.flatMap((p) => p.albums) ?? [];
  const randomTotal =
    stickyRandomData?.pages[0]?.total != null
      ? Math.min(stickyRandomData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const randomSeed =
    stickyRandomData?.pages[0]?.seed ?? discoverSeedRef.current;
  const frequentAlbums = frequentData?.pages.flatMap((p) => p.albums) ?? [];
  const frequentTotal =
    frequentData?.pages[0]?.total != null
      ? Math.min(frequentData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const forgottenFavSongs =
    stickyForgottenFavData?.pages.flatMap((p) => p.songs) ?? [];
  const forgottenFavTotal =
    stickyForgottenFavData?.pages[0]?.total != null
      ? Math.min(stickyForgottenFavData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const forgottenFavSeed =
    stickyForgottenFavData?.pages[0]?.seed ?? forgottenFavSeedRef.current;
  // Continue listening items come pre-merged and sorted from the server
  const continueListeningItems =
    continueListeningData?.pages.flatMap((p) => p.entries) ?? [];
  const continueListeningTotal =
    continueListeningData?.pages[0]?.total != null
      ? Math.min(continueListeningData.pages[0].total, MAX_SECTION_ITEMS)
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

  const handlePlaySongRadio = (id: string, name: string) => {
    startQueue({
      sourceType: "songRadio",
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
            <Skeleton className="w-9 h-9 rounded-md shrink-0 lg:hidden" />
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
                  <div key={i} className="w-45 shrink-0">
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
  const renderContinueListeningItem = (item: ContinueListeningEntry) => {
    if (
      (item.type === "playlist" || item.type === "smartPlaylist") &&
      item.playlist
    ) {
      return (
        <HomePlaylistCard
          playlist={item.playlist}
          onPlay={() =>
            handlePlayPlaylist(
              item.playlist!.id,
              item.playlist!.name,
              item.playlist!.playlistType as "playlist" | "smartPlaylist",
            )
          }
        />
      );
    }
    if (item.type === "songRadio" && item.source) {
      return (
        <HomeSongRadioCard
          source={item.source}
          onPlay={() => handlePlaySongRadio(item.source!.id, item.source!.name)}
        />
      );
    }
    if (item.album) {
      return (
        <AlbumCard
          album={item.album}
          onPlay={() => handlePlayAlbum(item.album!)}
        />
      );
    }
    return null;
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
      <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Mobile quick access - Favorites & Recently Played (hidden on desktop where sidebar is available) */}
        <div className="flex gap-2 px-3 sm:px-4 lg:hidden">
          <Link
            href="/favorites"
            className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
          >
            <Heart className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">Favorites</span>
          </Link>
          <Link
            href="/history"
            className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
          >
            <History className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">
              Recently Played
            </span>
          </Link>
        </div>

        {/* Continue Listening (Recently Played Albums + Playlists, sorted by last played) */}
        <section className="space-y-2 sm:space-y-4">
          <SectionHeader
            title="Continue Listening"
            icon={Play}
            hasItems={continueListeningItems.length > 0}
            isLoading={loadingContinueListening}
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
          <VirtualizedHorizontalScroll<ContinueListeningEntry>
            items={continueListeningItems}
            totalCount={continueListeningTotal}
            isLoading={loadingContinueListening}
            itemWidth={itemWidth}
            gap={itemGap}
            paddingX={paddingX}
            hasNextPage={hasNextContinueListening}
            isFetchingNextPage={fetchingNextContinueListening}
            fetchNextPage={fetchNextContinueListening}
            renderItem={(item) => renderContinueListeningItem(item)}
            renderSkeleton={() => <AlbumCardSkeleton />}
            getItemKey={(item) => {
              if (item.type === "playlist" || item.type === "smartPlaylist") {
                return `pl-${item.playlist?.id}`;
              }
              if (item.type === "songRadio") {
                return `sr-${item.source?.id}`;
              }
              return `al-${item.album?.id}`;
            }}
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
                  filters: {
                    seed: forgottenFavSeed,
                  },
                })
              }
              onShuffleAll={() =>
                startQueue({
                  sourceType: "forgottenFavorites",
                  sourceName: "Forgotten Favorites",
                  startIndex: 0,
                  shuffle: true,
                  filters: {
                    seed: forgottenFavSeed,
                  },
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
                    filters: {
                      seed: forgottenFavSeed,
                    },
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
              seed: randomSeed,
            })
          }
          onShuffleAll={() =>
            handleShuffleAllAlbums("random", "Discover", {
              seed: randomSeed,
            })
          }
          itemWidth={itemWidth}
          itemGap={itemGap}
          paddingX={paddingX}
        />
      </div>
    </div>
  );
}
