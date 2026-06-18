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
  AudioLines,
  Play,
  Clock,
  Radio,
  Sparkles,
  TrendingUp,
  Shuffle,
  Search,
  ListPlus,
  ListEnd,
  ListMusic,
  Heart,
  History,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import {
  addToQueueAtom,
  serverQueueStateAtom,
  startQueueAtom,
} from "@/lib/store/server-queue";
import {
  accountKey,
  accountLabel,
  connectionStatusAtom,
  savedAccountsAtom,
  serverConnectionAtom,
} from "@/lib/store/auth";
import { FerrotuneClient, getClient, initializeClient } from "@/lib/api/client";
import { homeSectionsAtom, homeTilesAtom } from "@/lib/store/ui";
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
import { ResponsiveContextMenu } from "@/components/shared/responsive-context-menu";
import {
  renderMenuItem,
  type MenuComponents,
} from "@/components/shared/media-menu-items";
import { PlaylistContextMenu } from "@/components/playlists/playlist-context-menu";
import { SmartPlaylistContextMenu } from "@/components/playlists/smart-playlist-context-menu";
import { VirtualizedHorizontalScroll } from "@/components/shared/virtualized-horizontal-scroll";
import { MobileProfileMenu } from "@/components/layout/mobile-profile-menu";
import { useIsSmallScreen } from "@/lib/hooks/use-media-query";
import { formatDuration } from "@/lib/utils/format";
import {
  getPlaylistDetailsHref,
  getQueueSourceHref,
} from "@/lib/utils/source-links";
import {
  getEnabledHomeSections,
  getForgottenFavoritesFilters,
  getHomeSectionHref,
  getHomeSectionOption,
  getHomeSectionPresentation,
  getMostPlayedRecentlyDays,
  getMostPlayedRecentlyFilters,
  getTopAlbumsDays,
  getTopAlbumsFilters,
  normalizeHomeSections,
  type HomeSectionConfig,
  type HomeSectionKind,
} from "@/lib/utils/home-sections";
import { getContinueListeningSourceDetails } from "@/lib/utils/continue-listening";
import {
  getHomeTilePresentation,
  normalizeHomeTiles,
  type HomeTileConfig,
  type HomeTilePresentation,
} from "@/lib/utils/home-tiles";
import { cn } from "@/lib/utils";
import {
  hapticConfirm,
  hapticDouble,
  hapticTap,
  hapticToggle,
} from "@/lib/utils/haptic";
import type { Album, Song } from "@/lib/api/types";
import type { ContinueListeningEntry } from "@/lib/api/generated/ContinueListeningEntry";
import type { HomePageResponse } from "@/lib/api/generated/HomePageResponse";

// Maximum items per home page section to avoid tiny scrollbars
const MAX_SECTION_ITEMS = 100;

// Compute page size based on viewport width to avoid loading too many items on mobile
function getPageSize(viewportWidth: number, itemWidth: number, gap: number) {
  const itemsPerScreen = Math.ceil(viewportWidth / (itemWidth + gap));
  // Load ~2 screenfuls per page for smooth scrolling
  return Math.max(6, itemsPerScreen * 2);
}

type ContinueListeningSourceItem = NonNullable<
  ContinueListeningEntry["source"]
>;

function getContinueListeningSourceIcon(
  sourceType: string,
  sourceId?: string | null,
): LucideIcon | null {
  switch (sourceType) {
    case "albumList":
      switch (sourceId) {
        case "random":
          return Sparkles;
        case "newest":
        case "recent":
          return Clock;
        case "starred":
          return Heart;
        case "frequent":
        case "highest":
          return TrendingUp;
        default:
          return ListMusic;
      }
    case "favorites":
      return Heart;
    case "history":
      return History;
    case "songRadio":
      return Radio;
    case "forgottenFavorites":
      return History;
    case "mostPlayedRecently":
      return TrendingUp;
    case "similarTracks":
      return AudioLines;
    default:
      return null;
  }
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
  const titleContent = viewAllHref ? (
    <Link
      href={viewAllHref}
      onClick={() => hapticTap()}
      className="hover:text-primary transition-colors"
    >
      {title}
    </Link>
  ) : (
    title
  );

  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 lg:px-6">
      <Icon className="w-5 h-5 text-primary" />
      <h2 className="text-lg sm:text-xl font-bold">{titleContent}</h2>
      {hasItems && (
        <div className="flex items-center gap-1 ml-auto">
          {onPlayAll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    hapticConfirm();
                    onPlayAll();
                  }}
                  disabled={isLoading}
                  aria-label={`Play ${title}`}
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
                  onClick={() => {
                    hapticDouble();
                    onShuffleAll();
                  }}
                  disabled={isLoading}
                  aria-label={`Shuffle ${title}`}
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
              onClick={() => hapticTap()}
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

function HomeQuickTile({
  tile,
  onQueueAction,
  onAccountAction,
}: {
  tile: HomeTilePresentation;
  onQueueAction: (
    action: Extract<HomeTilePresentation["action"], { type: "queue" }>,
  ) => void;
  onAccountAction: (
    action: Extract<HomeTilePresentation["action"], { type: "account" }>,
  ) => void;
}) {
  const Icon = tile.icon;
  const content = (
    <>
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50",
          tile.iconClassName,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-semibold">
          {tile.label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {tile.subtitle}
        </span>
      </span>
    </>
  );
  const className = cn(
    "flex min-h-14 items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5",
    "text-left touch-feedback touch-feedback-subtle hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    tile.isIncomplete && "opacity-60",
  );

  if (tile.action.type === "link" && !tile.isIncomplete) {
    return (
      <Link href={tile.action.href} className={className} prefetch={false}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={tile.isIncomplete}
      onClick={() => {
        // Distinguish the "kind" of action with a small haptic vocabulary:
        //   - shuffle queue → playful double-tap (exciting)
        //   - queue (open/play) → decisive confirm
        //   - account switch → asymmetric toggle
        //   - link → light tap (already handled by the <Link> branch above)
        if (tile.action.type === "queue") {
          if (tile.action.shuffle) hapticDouble();
          else hapticConfirm();
          onQueueAction(tile.action);
        } else if (tile.action.type === "account") {
          hapticToggle();
          onAccountAction(tile.action);
        }
      }}
    >
      {content}
    </button>
  );
}

function HomeQuickTiles({
  tiles,
  homeSections,
  onQueueAction,
  onAccountAction,
}: {
  tiles: HomeTileConfig[];
  homeSections: HomeSectionConfig[];
  onQueueAction: (
    action: Extract<HomeTilePresentation["action"], { type: "queue" }>,
  ) => void;
  onAccountAction: (
    action: Extract<HomeTilePresentation["action"], { type: "account" }>,
  ) => void;
}) {
  const presentations = normalizeHomeTiles(tiles).map((tile) =>
    getHomeTilePresentation(tile, { homeSections }),
  );

  if (presentations.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-2 px-3 sm:px-4 md:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] lg:px-6">
      {presentations.map((tile) => (
        <HomeQuickTile
          key={tile.id}
          tile={tile}
          onQueueAction={onQueueAction}
          onAccountAction={onAccountAction}
        />
      ))}
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
  viewAllHref,
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
  viewAllHref?: string;
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
        viewAllHref={viewAllHref}
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

function HomePlaylistSongsSection({
  section,
  isReady,
  currentAccountKey,
  itemWidth,
  itemGap,
  paddingX,
  pageSize,
}: {
  section: HomeSectionConfig;
  isReady: boolean;
  currentAccountKey: string;
  itemWidth: number;
  itemGap: number;
  paddingX: number;
  pageSize: number;
}) {
  const startQueue = useSetAtom(startQueueAtom);
  const presentation = getHomeSectionPresentation(section);
  const playlistId = section.playlistId ?? "";
  const playlistType = section.playlistType ?? "playlist";
  const isConfigured = Boolean(section.playlistId && section.playlistType);

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: [
        "home-playlist-songs",
        currentAccountKey,
        section.id,
        playlistType,
        playlistId,
        pageSize,
      ],
      queryFn: async ({ pageParam }) => {
        const client = getClient();
        if (!client || !playlistId) throw new Error("Not connected");

        if (playlistType === "smartPlaylist") {
          const response = await client.getSmartPlaylistSongs(playlistId, {
            offset: pageParam,
            count: pageSize,
            inlineImages: "medium",
          });
          return {
            songs: response.songs,
            total: response.totalCount,
            nextOffset: pageParam + pageSize,
            pageSize,
          };
        }

        const response = await client.getPlaylistSongs(playlistId, {
          offset: pageParam,
          count: pageSize,
          entryType: "song",
          inlineImages: "medium",
        });
        return {
          songs: response.entries
            .map((entry) => entry.song)
            .filter((song): song is Song => song !== null),
          total: response.filteredCount,
          nextOffset: pageParam + pageSize,
          pageSize,
        };
      },
      initialPageParam: 0,
      getNextPageParam: (lastPage) => {
        if (lastPage.nextOffset >= MAX_SECTION_ITEMS) return undefined;
        if (lastPage.songs.length < lastPage.pageSize) return undefined;
        const cap = Math.min(lastPage.total, MAX_SECTION_ITEMS);
        return lastPage.nextOffset < cap ? lastPage.nextOffset : undefined;
      },
      enabled: isReady && isConfigured,
    });

  if (!presentation.isConfigured) {
    return null;
  }

  const songs = data?.pages.flatMap((page) => page.songs) ?? [];
  const totalCount = data?.pages[0]
    ? Math.min(data.pages[0].total, MAX_SECTION_ITEMS)
    : undefined;

  const startPlaylist = (shuffle: boolean) => {
    startQueue({
      sourceType: playlistType,
      sourceId: playlistId,
      sourceName: presentation.label,
      startIndex: 0,
      shuffle,
    });
  };

  return (
    <section className="space-y-2 sm:space-y-4">
      <SectionHeader
        title={presentation.label}
        icon={presentation.icon}
        hasItems={songs.length > 0}
        isLoading={isLoading}
        onPlayAll={() => startPlaylist(false)}
        onShuffleAll={() => startPlaylist(true)}
        viewAllHref={presentation.href}
      />
      <VirtualizedHorizontalScroll<Song>
        items={songs}
        totalCount={totalCount}
        isLoading={isLoading}
        itemWidth={itemWidth}
        gap={itemGap}
        paddingX={paddingX}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        renderItem={(song, index) => (
          <SongCard
            song={song}
            index={index}
            songIndex={index}
            queueSource={{
              type: playlistType,
              id: playlistId,
              name: presentation.label,
            }}
            inlineImagesRequested
            className="ring-0"
          />
        )}
        renderSkeleton={() => <SongCardSkeleton />}
        getItemKey={(song) => song.id}
        emptyMessage="No playlist songs"
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

function HomeSourceCard({
  source,
  onPlay,
}: {
  source: ContinueListeningSourceItem;
  onPlay: (source: ContinueListeningSourceItem) => void;
}) {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const details = getContinueListeningSourceDetails(
    source.sourceType,
    source.id,
  );
  const href = details
    ? getQueueSourceHref({
        type: details.queueSourceType,
        id: source.id,
        name: source.name,
      })
    : null;

  if (!details || !href) {
    return null;
  }

  const SourceIcon = getContinueListeningSourceIcon(
    details.queueSourceType,
    source.id,
  );
  if (!SourceIcon) {
    return null;
  }

  const coverArtUrl = source.coverArt
    ? getClient()?.getCoverArtUrl(source.coverArt, "medium")
    : undefined;

  const startSource = (shuffle: boolean) => {
    startQueue({
      sourceType: details.queueSourceType,
      sourceId: source.id,
      sourceName: source.name,
      startIndex: 0,
      shuffle,
      filters: details.filters,
    });
  };

  const handleShuffle = () => {
    startSource(true);
  };

  const handleAddToQueue = async (position: "next" | "end") => {
    if (!queueState || queueState.totalCount === 0) {
      startSource(false);
      toast.success(`Playing "${source.name}"`);
      return;
    }

    const result = await addToQueue({
      position,
      sourceType: details.queueSourceType,
      sourceId: source.id,
    });

    if (result.success) {
      toast.success(
        position === "next" ? "Added to play next" : "Added to queue",
      );
    } else {
      toast.error("Failed to add to queue");
    }
  };

  const renderSourceMenu = (components: MenuComponents) => {
    const { Separator } = components;

    return (
      <>
        {renderMenuItem(components, {
          icon: Play,
          label: "Play",
          onClick: () => onPlay(source),
        })}
        {renderMenuItem(components, {
          icon: Shuffle,
          label: "Shuffle",
          onClick: handleShuffle,
        })}
        <Separator />
        {renderMenuItem(components, {
          icon: ListPlus,
          label: "Play Next",
          onClick: () => void handleAddToQueue("next"),
        })}
        {renderMenuItem(components, {
          icon: ListEnd,
          label: "Add to Queue",
          onClick: () => void handleAddToQueue("end"),
        })}
      </>
    );
  };

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={source.name}
      titleIcon={
        <SourceIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
      }
      subtitle={details.subtitle}
      href={href}
      coverType={details.coverType}
      colorSeed={source.name}
      onPlay={() => onPlay(source)}
      contextMenu={(children) => (
        <ResponsiveContextMenu
          drawerTitle={source.name}
          drawerSubtitle={details.subtitle}
          drawerThumbnail={coverArtUrl}
          renderMenuContent={renderSourceMenu}
        >
          {children}
        </ResponsiveContextMenu>
      )}
    />
  );
}

export default function HomePage() {
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const connection = useAtomValue(serverConnectionAtom);
  const setConnection = useSetAtom(serverConnectionAtom);
  const savedAccounts = useAtomValue(savedAccountsAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const homeTiles = useAtomValue(homeTilesAtom);
  const homeSections = useAtomValue(homeSectionsAtom);
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
  // Store the discovery seed/count/exclusion for Similar Tracks so playback queues
  // match the rendered list.
  const similarTracksSeedRef = useRef<number | undefined>(undefined);
  const similarTracksCountRef = useRef<number>(50);
  const similarTracksExcludeRef = useRef<number>(7);

  // Responsive item dimensions
  const itemWidth = isSmallScreen ? 130 : 180;
  const itemGap = isSmallScreen ? 8 : 16;
  const paddingX = isSmallScreen ? 12 : 24;

  const normalizedHomeSections = normalizeHomeSections(homeSections);
  const enabledHomeSections = getEnabledHomeSections(normalizedHomeSections);
  const getSectionConfig = (kind: HomeSectionKind) =>
    normalizedHomeSections.find((section) => section.kind === kind);
  const isSectionEnabled = (kind: HomeSectionKind) =>
    enabledHomeSections.some((section) => section.kind === kind);
  const mostPlayedRecentlySection = getSectionConfig("mostPlayedRecently");
  const forgottenFavoritesSection = getSectionConfig("forgottenFavorites");
  const topAlbumsSection = getSectionConfig("topAlbums");
  const mostPlayedRecentlyDays = getMostPlayedRecentlyDays(
    mostPlayedRecentlySection,
  );
  const mostPlayedRecentlyFilters = getMostPlayedRecentlyFilters(
    mostPlayedRecentlyDays,
  );
  const forgottenFavoritesFilters = getForgottenFavoritesFilters(
    forgottenFavoritesSection,
  );
  const topAlbumsDays = getTopAlbumsDays(topAlbumsSection);
  const topAlbumsFilters = getTopAlbumsFilters(topAlbumsDays);

  useEffect(() => {
    discoverSeedRef.current = undefined;
    forgottenFavSeedRef.current = undefined;
    similarTracksSeedRef.current = undefined;
  }, [
    currentAccountKey,
    forgottenFavoritesFilters.minPlays,
    forgottenFavoritesFilters.notPlayedSinceDays,
  ]);

  // Dynamic page size based on viewport width
  const pageSize =
    typeof window !== "undefined"
      ? getPageSize(window.innerWidth, itemWidth, itemGap)
      : 15;

  // Navigate to search when user starts typing
  const handleSearchFocus = () => {
    hapticTap();
    router.push("/search");
  };

  const handleHomeTileQueueAction = (
    action: Extract<HomeTilePresentation["action"], { type: "queue" }>,
  ) => {
    startQueue({
      sourceType: action.sourceType,
      sourceId: action.sourceId,
      sourceName: action.sourceName,
      startIndex: 0,
      shuffle: action.shuffle,
      filters: action.filters,
    });
  };

  const handleHomeTileAccountAction = async (
    action: Extract<HomeTilePresentation["action"], { type: "account" }>,
  ) => {
    if (!action.accountKey) {
      toast.error("Choose an account for this tile in Settings");
      return;
    }

    if (action.accountKey === currentAccountKey) {
      toast.info("Already using this account");
      return;
    }

    const account = savedAccounts.find(
      (savedAccount) => accountKey(savedAccount) === action.accountKey,
    );
    if (!account) {
      toast.error("Saved account not found");
      return;
    }

    try {
      setConnectionStatus("connecting");
      const client = new FerrotuneClient(account);
      await client.ping();
      initializeClient(account);
      setConnection(account);
      setConnectionStatus("connected");
      toast.success(`Switched to ${account.label || accountLabel(account)}`);
    } catch {
      setConnectionStatus("error");
      toast.error("Failed to connect. The account may have expired.");
    }
  };

  const newestQueryKey = [
    "albums",
    "newest",
    "home",
    currentAccountKey,
  ] as const;
  const randomQueryKey = [
    "albums",
    "random",
    "home",
    currentAccountKey,
  ] as const;
  const mostPlayedRecentlyQueryKey = [
    "songs",
    "most-played-recently",
    "home",
    currentAccountKey,
    mostPlayedRecentlyDays,
  ] as const;
  const forgottenFavoritesQueryKey = [
    "songs",
    "forgotten-favorites",
    "home",
    currentAccountKey,
    forgottenFavoritesFilters.minPlays,
    forgottenFavoritesFilters.notPlayedSinceDays,
  ] as const;
  const continueListeningQueryKey = [
    "continue-listening",
    "home",
    currentAccountKey,
  ] as const;
  const topAlbumsQueryKey = [
    "albums",
    "top",
    "home",
    currentAccountKey,
    topAlbumsDays,
  ] as const;
  const recentAlbumsQueryKey = [
    "albums",
    "recent",
    "home",
    currentAccountKey,
  ] as const;
  const similarTracksQueryKey = [
    "discovery",
    "similar-songs",
    "home",
    currentAccountKey,
  ] as const;
  const batchSectionsKey = [
    isSectionEnabled("continueListening") ? "continue" : "no-continue",
    isSectionEnabled("recentlyAdded") ? "newest" : "no-newest",
    isSectionEnabled("discover") ? "discover" : "no-discover",
  ].join("|");

  // --- Batch fetch for initial home page load ---
  // Initial page fetches for batch-backed sections go through one HTTP request.
  // Configurable song sections use their own endpoints so custom filters are respected.
  const batchPromiseRef = useRef<{
    accountKey: string;
    sectionsKey: string;
    pageSize: number;
    promise: Promise<HomePageResponse>;
  } | null>(null);
  const fetchBatch = (): Promise<HomePageResponse> => {
    const cachedBatch = batchPromiseRef.current;
    if (
      !cachedBatch ||
      cachedBatch.accountKey !== currentAccountKey ||
      cachedBatch.sectionsKey !== batchSectionsKey ||
      cachedBatch.pageSize !== pageSize
    ) {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const promise = client.getHomePage({
        size: pageSize,
        inlineImages: "medium",
        includeContinueListening: isSectionEnabled("continueListening"),
        includeMostPlayedRecently: false,
        includeRecentlyAdded: isSectionEnabled("recentlyAdded"),
        includeForgottenFavorites: false,
        includeDiscover: isSectionEnabled("discover"),
      });
      batchPromiseRef.current = {
        accountKey: currentAccountKey,
        sectionsKey: batchSectionsKey,
        pageSize,
        promise,
      };
      // After the batch resolves, clear the ref so that future resets
      // (e.g., account switch) create a fresh request
      promise.finally(() => {
        setTimeout(() => {
          const activeBatch = batchPromiseRef.current;
          if (
            activeBatch?.accountKey === currentAccountKey &&
            activeBatch.sectionsKey === batchSectionsKey &&
            activeBatch.pageSize === pageSize &&
            activeBatch.promise === promise
          ) {
            batchPromiseRef.current = null;
          }
        }, 100);
      });
    }
    const activeBatch = batchPromiseRef.current;
    if (!activeBatch) {
      throw new Error("Home page batch request was not initialized");
    }

    return activeBatch.promise;
  };

  useEffect(() => {
    batchPromiseRef.current = null;
  }, [currentAccountKey, batchSectionsKey, pageSize]);

  // --- Infinite queries for album sections ---

  const {
    data: newestData,
    isLoading: loadingNewest,
    hasNextPage: hasNextNewest,
    isFetchingNextPage: fetchingNextNewest,
    fetchNextPage: fetchNextNewest,
  } = useInfiniteQuery({
    queryKey: newestQueryKey,
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
    enabled: isReady && isSectionEnabled("recentlyAdded"),
  });

  const {
    data: randomData,
    isLoading: loadingRandom,
    hasNextPage: hasNextRandom,
    isFetchingNextPage: fetchingNextRandom,
    fetchNextPage: fetchNextRandom,
  } = useInfiniteQuery({
    queryKey: randomQueryKey,
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
    enabled: isReady && isSectionEnabled("discover"),
  });

  const {
    data: mostPlayedRecentlyData,
    isLoading: loadingMostPlayedRecently,
    hasNextPage: hasNextMostPlayedRecently,
    isFetchingNextPage: fetchingNextMostPlayedRecently,
    fetchNextPage: fetchNextMostPlayedRecently,
  } = useInfiniteQuery({
    queryKey: mostPlayedRecentlyQueryKey,
    queryFn: async ({ pageParam }) => {
      if (pageParam === 0) {
        const client = getClient();
        if (!client) throw new Error("Not connected");
        const response = await client.getMostPlayedRecently({
          size: pageSize,
          offset: 0,
          inlineImages: "medium",
          ...mostPlayedRecentlyFilters,
        });
        return {
          songs: response.song ?? [],
          total: response.total,
          nextOffset: pageSize,
          pageSize,
        };
      }
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getMostPlayedRecently({
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
        ...mostPlayedRecentlyFilters,
      });
      return {
        songs: response.song ?? [],
        total: response.total,
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
        return lastPage.songs.length >= lastPage.pageSize
          ? lastPage.nextOffset
          : undefined;
      }
      return lastPage.nextOffset < cap ? lastPage.nextOffset : undefined;
    },
    enabled: isReady && isSectionEnabled("mostPlayedRecently"),
  });

  // --- Forgotten Favorites: songs played a lot long ago but not recently ---
  const {
    data: forgottenFavData,
    isLoading: loadingForgottenFav,
    hasNextPage: hasNextForgottenFav,
    isFetchingNextPage: fetchingNextForgottenFav,
    fetchNextPage: fetchNextForgottenFav,
  } = useInfiniteQuery({
    queryKey: forgottenFavoritesQueryKey,
    queryFn: async ({ pageParam }) => {
      if (pageParam === 0) {
        const client = getClient();
        if (!client) throw new Error("Not connected");
        const response = await client.getForgottenFavorites({
          size: pageSize,
          offset: 0,
          inlineImages: "medium",
          ...forgottenFavoritesFilters,
        });
        if (forgottenFavSeedRef.current === undefined) {
          forgottenFavSeedRef.current = response.seed;
        }
        return {
          songs: response.song ?? [],
          total: response.total,
          seed: response.seed,
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
        ...forgottenFavoritesFilters,
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
    enabled: isReady && isSectionEnabled("forgottenFavorites"),
  });

  // --- Continue Listening: unified endpoint with albums + playlists ---
  const {
    data: continueListeningData,
    isLoading: loadingContinueListening,
    hasNextPage: hasNextContinueListening,
    isFetchingNextPage: fetchingNextContinueListening,
    fetchNextPage: fetchNextContinueListening,
  } = useInfiniteQuery({
    queryKey: continueListeningQueryKey,
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
    enabled: isReady && isSectionEnabled("continueListening"),
  });

  const {
    data: topAlbumsData,
    isLoading: loadingTopAlbums,
    hasNextPage: hasNextTopAlbums,
    isFetchingNextPage: fetchingNextTopAlbums,
    fetchNextPage: fetchNextTopAlbums,
  } = useInfiniteQuery({
    queryKey: topAlbumsQueryKey,
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getAlbumList2({
        type: "frequent",
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
        ...topAlbumsFilters,
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
    enabled: isReady && isSectionEnabled("topAlbums"),
  });

  const {
    data: recentAlbumsData,
    isLoading: loadingRecentAlbums,
    hasNextPage: hasNextRecentAlbums,
    isFetchingNextPage: fetchingNextRecentAlbums,
    fetchNextPage: fetchNextRecentAlbums,
  } = useInfiniteQuery({
    queryKey: recentAlbumsQueryKey,
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
    enabled: isReady && isSectionEnabled("recentAlbums"),
  });

  // --- Similar Tracks: discovery based on listening history ---
  const {
    data: similarTracksData,
    isLoading: loadingSimilarTracks,
    hasNextPage: hasNextSimilarTracks,
    isFetchingNextPage: fetchingNextSimilarTracks,
    fetchNextPage: fetchNextSimilarTracks,
  } = useInfiniteQuery({
    queryKey: similarTracksQueryKey,
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      if (similarTracksSeedRef.current === undefined) {
        similarTracksSeedRef.current = Math.floor(
          Math.random() * Number.MAX_SAFE_INTEGER,
        );
      }
      const response = await client.getDiscoverySimilarSongs({
        size: pageSize,
        offset: pageParam,
        inlineImages: "medium",
        seed: similarTracksSeedRef.current,
      });
      similarTracksSeedRef.current = response.seed;
      similarTracksCountRef.current = response.count;
      similarTracksExcludeRef.current = response.excludeRecentDays;
      return {
        songs: response.song ?? [],
        total: response.total,
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
        return lastPage.songs.length >= lastPage.pageSize
          ? lastPage.nextOffset
          : undefined;
      }
      return lastPage.nextOffset < cap ? lastPage.nextOffset : undefined;
    },
    enabled: isReady && isSectionEnabled("similarTracks"),
  });

  const stickyRandomData = useStickyHomeSection(
    randomQueryKey,
    randomData,
    currentAccountKey,
  );
  const stickyForgottenFavData = useStickyHomeSection(
    forgottenFavoritesQueryKey,
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
  const mostPlayedRecentlySongs =
    mostPlayedRecentlyData?.pages.flatMap((p) => p.songs) ?? [];
  const mostPlayedRecentlyTotal =
    mostPlayedRecentlyData?.pages[0]?.total != null
      ? Math.min(mostPlayedRecentlyData.pages[0].total, MAX_SECTION_ITEMS)
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
  const topAlbums = topAlbumsData?.pages.flatMap((p) => p.albums) ?? [];
  const topAlbumsTotal =
    topAlbumsData?.pages[0]?.total != null
      ? Math.min(topAlbumsData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const recentAlbums = recentAlbumsData?.pages.flatMap((p) => p.albums) ?? [];
  const recentAlbumsTotal =
    recentAlbumsData?.pages[0]?.total != null
      ? Math.min(recentAlbumsData.pages[0].total, MAX_SECTION_ITEMS)
      : undefined;
  const similarTracksSongs =
    similarTracksData?.pages.flatMap((p) => p.songs) ?? [];
  const similarTracksTotal =
    similarTracksData?.pages[0]?.total != null
      ? Math.min(similarTracksData.pages[0].total, MAX_SECTION_ITEMS)
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

  const handlePlaySource = (source: ContinueListeningSourceItem) => {
    const details = getContinueListeningSourceDetails(
      source.sourceType,
      source.id,
    );
    if (!details) {
      return;
    }

    startQueue({
      sourceType: details.queueSourceType,
      sourceId: source.id,
      sourceName: source.name,
      startIndex: 0,
      shuffle: false,
      filters: details.filters,
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
          <div className="flex items-center gap-4 h-safe-16 pt-safe px-4 lg:px-6">
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
    if (item.source) {
      return <HomeSourceCard source={item.source} onPlay={handlePlaySource} />;
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

  const renderHomeSection = (section: HomeSectionConfig) => {
    const sectionOption = getHomeSectionOption(section.kind);

    switch (section.kind) {
      case "continueListening":
        return (
          <section key={section.id} className="space-y-2 sm:space-y-4">
            <SectionHeader
              title={sectionOption.label}
              icon={sectionOption.icon}
              hasItems={continueListeningItems.length > 0}
              isLoading={loadingContinueListening}
              onPlayAll={() =>
                startQueue({
                  sourceType: "continueListening",
                  sourceName: sectionOption.label,
                  startIndex: 0,
                  shuffle: false,
                })
              }
              onShuffleAll={() =>
                startQueue({
                  sourceType: "continueListening",
                  sourceName: sectionOption.label,
                  startIndex: 0,
                  shuffle: true,
                })
              }
              viewAllHref={getHomeSectionHref(section)}
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
                if (item.source) {
                  return `${item.source.sourceType}-${item.source.id}`;
                }
                return `al-${item.album?.id}`;
              }}
              emptyMessage="No recently played items"
            />
          </section>
        );
      case "mostPlayedRecently":
        return (
          <section key={section.id} className="space-y-2 sm:space-y-4">
            <SectionHeader
              title={sectionOption.label}
              icon={sectionOption.icon}
              hasItems={mostPlayedRecentlySongs.length > 0}
              isLoading={loadingMostPlayedRecently}
              onPlayAll={() =>
                startQueue({
                  sourceType: "mostPlayedRecently",
                  sourceName: sectionOption.label,
                  startIndex: 0,
                  shuffle: false,
                  filters: mostPlayedRecentlyFilters,
                })
              }
              onShuffleAll={() =>
                startQueue({
                  sourceType: "mostPlayedRecently",
                  sourceName: sectionOption.label,
                  startIndex: 0,
                  shuffle: true,
                  filters: mostPlayedRecentlyFilters,
                })
              }
              viewAllHref={getHomeSectionHref(section)}
            />
            <VirtualizedHorizontalScroll<Song>
              items={mostPlayedRecentlySongs}
              totalCount={mostPlayedRecentlyTotal}
              isLoading={loadingMostPlayedRecently}
              itemWidth={itemWidth}
              gap={itemGap}
              paddingX={paddingX}
              hasNextPage={hasNextMostPlayedRecently}
              isFetchingNextPage={fetchingNextMostPlayedRecently}
              fetchNextPage={fetchNextMostPlayedRecently}
              renderItem={(song, index) => (
                <SongCard
                  song={song}
                  index={index}
                  songIndex={index}
                  queueSource={{
                    type: "mostPlayedRecently",
                    name: sectionOption.label,
                    filters: mostPlayedRecentlyFilters,
                  }}
                  inlineImagesRequested
                  className="ring-0"
                />
              )}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(song) => song.id}
              emptyMessage="No recently played songs"
            />
          </section>
        );
      case "recentlyAdded":
        return (
          <AlbumSection
            key={section.id}
            title={sectionOption.label}
            icon={sectionOption.icon}
            albums={newestAlbums}
            totalCount={newestTotal}
            isLoading={loadingNewest}
            hasNextPage={hasNextNewest}
            isFetchingNextPage={fetchingNextNewest}
            fetchNextPage={fetchNextNewest}
            onPlayAlbum={handlePlayAlbum}
            onPlayAll={() => handlePlayAllAlbums("newest", sectionOption.label)}
            onShuffleAll={() =>
              handleShuffleAllAlbums("newest", sectionOption.label)
            }
            viewAllHref={getHomeSectionHref(section)}
            itemWidth={itemWidth}
            itemGap={itemGap}
            paddingX={paddingX}
          />
        );
      case "forgottenFavorites": {
        const queueFilters = {
          ...forgottenFavoritesFilters,
          seed: forgottenFavSeed,
        };

        if (forgottenFavSongs.length === 0 && !loadingForgottenFav) {
          return null;
        }

        return (
          <section key={section.id} className="space-y-2 sm:space-y-4">
            <SectionHeader
              title={sectionOption.label}
              icon={sectionOption.icon}
              hasItems={forgottenFavSongs.length > 0}
              isLoading={loadingForgottenFav}
              onPlayAll={() =>
                startQueue({
                  sourceType: "forgottenFavorites",
                  sourceName: sectionOption.label,
                  startIndex: 0,
                  shuffle: false,
                  filters: queueFilters,
                })
              }
              onShuffleAll={() =>
                startQueue({
                  sourceType: "forgottenFavorites",
                  sourceName: sectionOption.label,
                  startIndex: 0,
                  shuffle: true,
                  filters: queueFilters,
                })
              }
              viewAllHref={getHomeSectionHref(section)}
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
                    name: sectionOption.label,
                    filters: queueFilters,
                  }}
                  inlineImagesRequested
                  className="ring-0"
                />
              )}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(song) => song.id}
              emptyMessage="No forgotten favorites"
            />
          </section>
        );
      }
      case "discover":
        return (
          <AlbumSection
            key={section.id}
            title={sectionOption.label}
            icon={sectionOption.icon}
            albums={randomAlbums}
            totalCount={randomTotal}
            isLoading={loadingRandom}
            hasNextPage={hasNextRandom}
            isFetchingNextPage={fetchingNextRandom}
            fetchNextPage={fetchNextRandom}
            onPlayAlbum={handlePlayAlbum}
            onPlayAll={() =>
              handlePlayAllAlbums("random", sectionOption.label, {
                seed: randomSeed,
              })
            }
            onShuffleAll={() =>
              handleShuffleAllAlbums("random", sectionOption.label, {
                seed: randomSeed,
              })
            }
            viewAllHref={getHomeSectionHref(section)}
            itemWidth={itemWidth}
            itemGap={itemGap}
            paddingX={paddingX}
          />
        );
      case "similarTracks":
        return (
          <section key={section.id} className="space-y-2 sm:space-y-4">
            <SectionHeader
              title={sectionOption.label}
              icon={sectionOption.icon}
              hasItems={similarTracksSongs.length > 0}
              isLoading={loadingSimilarTracks}
              onPlayAll={() =>
                startQueue({
                  sourceType: "similarTracks",
                  sourceName: sectionOption.label,
                  startIndex: 0,
                  shuffle: false,
                  filters: {
                    seed: similarTracksSeedRef.current,
                    count: similarTracksCountRef.current,
                    excludeRecentDays: similarTracksExcludeRef.current,
                  },
                })
              }
              onShuffleAll={() =>
                startQueue({
                  sourceType: "similarTracks",
                  sourceName: sectionOption.label,
                  startIndex: 0,
                  shuffle: true,
                  filters: {
                    seed: similarTracksSeedRef.current,
                    count: similarTracksCountRef.current,
                    excludeRecentDays: similarTracksExcludeRef.current,
                  },
                })
              }
              viewAllHref={getHomeSectionHref(section)}
            />
            <VirtualizedHorizontalScroll<Song>
              items={similarTracksSongs}
              totalCount={similarTracksTotal}
              isLoading={loadingSimilarTracks}
              itemWidth={itemWidth}
              gap={itemGap}
              paddingX={paddingX}
              hasNextPage={hasNextSimilarTracks}
              isFetchingNextPage={fetchingNextSimilarTracks}
              fetchNextPage={fetchNextSimilarTracks}
              renderItem={(song, index) => (
                <SongCard
                  song={song}
                  index={index}
                  songIndex={index}
                  queueSource={{
                    type: "similarTracks",
                    name: sectionOption.label,
                    filters: {
                      seed: similarTracksSeedRef.current,
                      count: similarTracksCountRef.current,
                      excludeRecentDays: similarTracksExcludeRef.current,
                    },
                  }}
                  inlineImagesRequested
                  className="ring-0"
                />
              )}
              renderSkeleton={() => <SongCardSkeleton />}
              getItemKey={(song) => song.id}
              emptyMessage="No similar tracks found"
            />
          </section>
        );
      case "topAlbums":
        return (
          <AlbumSection
            key={section.id}
            title={sectionOption.label}
            icon={sectionOption.icon}
            albums={topAlbums}
            totalCount={topAlbumsTotal}
            isLoading={loadingTopAlbums}
            hasNextPage={hasNextTopAlbums}
            isFetchingNextPage={fetchingNextTopAlbums}
            fetchNextPage={fetchNextTopAlbums}
            onPlayAlbum={handlePlayAlbum}
            onPlayAll={() =>
              handlePlayAllAlbums(
                "frequent",
                sectionOption.label,
                topAlbumsFilters,
              )
            }
            onShuffleAll={() =>
              handleShuffleAllAlbums(
                "frequent",
                sectionOption.label,
                topAlbumsFilters,
              )
            }
            itemWidth={itemWidth}
            itemGap={itemGap}
            paddingX={paddingX}
          />
        );
      case "recentAlbums":
        return (
          <AlbumSection
            key={section.id}
            title={sectionOption.label}
            icon={sectionOption.icon}
            albums={recentAlbums}
            totalCount={recentAlbumsTotal}
            isLoading={loadingRecentAlbums}
            hasNextPage={hasNextRecentAlbums}
            isFetchingNextPage={fetchingNextRecentAlbums}
            fetchNextPage={fetchNextRecentAlbums}
            onPlayAlbum={handlePlayAlbum}
            onPlayAll={() => handlePlayAllAlbums("recent", sectionOption.label)}
            onShuffleAll={() =>
              handleShuffleAllAlbums("recent", sectionOption.label)
            }
            itemWidth={itemWidth}
            itemGap={itemGap}
            paddingX={paddingX}
          />
        );
      case "playlistSongs":
        return (
          <HomePlaylistSongsSection
            key={section.id}
            section={section}
            isReady={isReady}
            currentAccountKey={currentAccountKey}
            itemWidth={itemWidth}
            itemGap={itemGap}
            paddingX={paddingX}
            pageSize={pageSize}
          />
        );
    }
  };

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 h-safe-16 pt-safe px-4 lg:px-6">
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
        <HomeQuickTiles
          tiles={homeTiles}
          homeSections={normalizedHomeSections}
          onQueueAction={handleHomeTileQueueAction}
          onAccountAction={handleHomeTileAccountAction}
        />
        {enabledHomeSections.map(renderHomeSection)}
      </div>
    </div>
  );
}
