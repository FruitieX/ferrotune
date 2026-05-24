"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useAtom, useSetAtom } from "jotai";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Clock,
  Disc,
  Heart,
  History,
  ListMusic,
  Play,
  Radio,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { getClient } from "@/lib/api/client";
import { startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import {
  DEFAULT_FORGOTTEN_FAVORITES_MIN_PLAYS,
  DEFAULT_FORGOTTEN_FAVORITES_NOT_PLAYED_DAYS,
  DEFAULT_MOST_PLAYED_RECENTLY_DAYS,
  getMostPlayedRecentlyFilters,
} from "@/lib/utils/home-sections";
import { getContinueListeningSourceDetails } from "@/lib/utils/continue-listening";
import {
  getPlaylistDetailsHref,
  getQueueSourceHref,
} from "@/lib/utils/source-links";
import { formatCount, formatDate, formatDuration } from "@/lib/utils/format";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyFilterState, EmptyState } from "@/components/shared/empty-state";
import { MediaRow, MediaRowSkeleton } from "@/components/shared/media-row";
import { VirtualizedList } from "@/components/shared/virtualized-grid";
import { AlbumCardCompact } from "@/components/browse/album-card";
import {
  SongRow,
  SongRowSkeleton,
  type QueueSource,
} from "@/components/browse/song-row";
import {
  AlbumListHeader,
  SongListHeader,
} from "@/components/shared/song-list-header";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { MediaListToolbar } from "@/components/shared/media-list-toolbar";
import type { Album, Song } from "@/lib/api/types";
import type { ContinueListeningEntry } from "@/lib/api/generated/ContinueListeningEntry";
import {
  homeAlbumColumnVisibilityAtom,
  homeSongColumnVisibilityAtom,
  type SortConfig,
} from "@/lib/store/ui";

const PAGE_SIZE = 50;
const LIST_VIEW = "list";

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
      return Clock;
    case "songRadio":
      return Radio;
    case "forgottenFavorites":
      return History;
    case "mostPlayedRecently":
      return TrendingUp;
    default:
      return null;
  }
}

const continueListeningSortOptions = [
  { value: "lastPlayed" as const, label: "Last Played" },
  { value: "name" as const, label: "Name" },
];

type HomeSectionConfig =
  | {
      id: string;
      kind: "continueListening";
      title: string;
      label: string;
      emptyTitle: string;
      icon: LucideIcon;
      iconClassName: string;
      gradientColor: string;
      queueSourceType: "continueListening";
      queueSourceName: string;
    }
  | {
      id: string;
      kind: "song";
      title: string;
      label: string;
      emptyTitle: string;
      icon: LucideIcon;
      iconClassName: string;
      gradientColor: string;
      queueSourceType: "forgottenFavorites" | "mostPlayedRecently";
      queueSourceName: string;
    }
  | {
      id: string;
      kind: "album";
      title: string;
      label: string;
      emptyTitle: string;
      icon: LucideIcon;
      iconClassName: string;
      gradientColor: string;
      albumListType: "newest" | "random";
      queueSourceName: string;
    };

function getHomeSectionConfig(
  sectionId: string | undefined,
): HomeSectionConfig | null {
  switch (sectionId) {
    case "continue-listening":
      return {
        id: sectionId,
        kind: "continueListening",
        title: "Continue Listening",
        label: "Home",
        emptyTitle: "No recently played items",
        icon: Play,
        iconClassName: "bg-linear-to-br from-emerald-500 to-cyan-700",
        gradientColor: "rgba(16,185,129,0.22)",
        queueSourceType: "continueListening",
        queueSourceName: "Continue Listening",
      };
    case "most-played-recently":
      return {
        id: sectionId,
        kind: "song",
        title: "Most Played Recently",
        label: "Home",
        emptyTitle: "No recently played songs",
        icon: TrendingUp,
        iconClassName: "bg-linear-to-br from-rose-500 to-amber-600",
        gradientColor: "rgba(244,63,94,0.2)",
        queueSourceType: "mostPlayedRecently",
        queueSourceName: "Most Played Recently",
      };
    case "recently-added":
      return {
        id: sectionId,
        kind: "album",
        title: "Recently Added",
        label: "Home",
        emptyTitle: "No recently added albums",
        icon: Clock,
        iconClassName: "bg-linear-to-br from-sky-500 to-blue-700",
        gradientColor: "rgba(14,165,233,0.2)",
        albumListType: "newest",
        queueSourceName: "Recently Added",
      };
    case "forgotten-favorites":
      return {
        id: sectionId,
        kind: "song",
        title: "Forgotten Favorites",
        label: "Home",
        emptyTitle: "No forgotten favorites",
        icon: History,
        iconClassName: "bg-linear-to-br from-amber-500 to-teal-700",
        gradientColor: "rgba(245,158,11,0.2)",
        queueSourceType: "forgottenFavorites",
        queueSourceName: "Forgotten Favorites",
      };
    case "discover":
      return {
        id: sectionId,
        kind: "album",
        title: "Discover Something New",
        label: "Home",
        emptyTitle: "No discovery albums found",
        icon: Sparkles,
        iconClassName: "bg-linear-to-br from-violet-500 to-fuchsia-700",
        gradientColor: "rgba(139,92,246,0.2)",
        albumListType: "random",
        queueSourceName: "Discover",
      };
    default:
      return null;
  }
}

function getDefaultSortConfig(section: HomeSectionConfig | null): SortConfig {
  if (!section) {
    return { field: "lastPlayed", direction: "desc" };
  }

  if (section.kind === "continueListening") {
    return { field: "lastPlayed", direction: "desc" };
  }

  if (section.kind === "song") {
    return { field: "playCount", direction: "desc" };
  }

  if (section.albumListType === "random") {
    return { field: "recommended", direction: "desc" };
  }

  return { field: "dateAdded", direction: "desc" };
}

function getFilterParam(filter: string) {
  const trimmed = filter.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getSortParam(sortConfig: SortConfig) {
  return {
    sort: sortConfig.field,
    sortDir: sortConfig.direction,
  };
}

function getQueueFilters(
  filter: string,
  extraFilters?: Record<string, unknown>,
) {
  const filterParam = getFilterParam(filter);
  if (!filterParam) return extraFilters;
  return {
    ...extraFilters,
    filter: filterParam,
  };
}

function getPositiveNumberParam(
  params: URLSearchParams,
  key: string,
  fallback: number,
) {
  const value = Number(params.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getNextOffsetPageParam(lastPage: {
  nextOffset: number;
  pageSize: number;
  total?: number | null;
  count: number;
}) {
  if (lastPage.total == null) {
    return lastPage.count >= lastPage.pageSize
      ? lastPage.nextOffset
      : undefined;
  }

  return lastPage.nextOffset < lastPage.total ? lastPage.nextOffset : undefined;
}

function getEntryKey(entry: ContinueListeningEntry) {
  if (
    (entry.type === "playlist" || entry.type === "smartPlaylist") &&
    entry.playlist
  ) {
    return `${entry.type}-${entry.playlist.id}`;
  }
  if (entry.source) return `${entry.source.sourceType}-${entry.source.id}`;
  return `album-${entry.album?.id ?? entry.lastPlayed}`;
}

function ContinueListeningRow({
  entry,
  index,
  onPlayAlbum,
  onPlayPlaylist,
  onPlaySource,
}: {
  entry: ContinueListeningEntry;
  index: number;
  onPlayAlbum: (album: Album) => void;
  onPlayPlaylist: (playlist: {
    id: string;
    name: string;
    playlistType: string;
  }) => void;
  onPlaySource: (source: ContinueListeningSourceItem) => void;
}) {
  if (entry.album) {
    const album = entry.album;
    const coverArtUrl =
      album.coverArt && !album.coverArtData
        ? getClient()?.getCoverArtUrl(album.coverArt, "small")
        : undefined;

    return (
      <MediaRow
        coverArt={coverArtUrl}
        coverArtData={album.coverArtData}
        title={album.name}
        titleIcon={<Disc className="w-4 h-4 shrink-0 text-muted-foreground" />}
        subtitleContent={
          <Link
            href={`/library/artists/details?id=${album.artistId}`}
            prefetch={false}
            className="hover:underline hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            {album.artist}
          </Link>
        }
        href={`/library/albums/details?id=${album.id}`}
        colorSeed={album.name}
        coverType="album"
        index={index}
        onPlay={() => onPlayAlbum(album)}
        onDoubleClick={() => onPlayAlbum(album)}
        rightContent={
          <span className="hidden sm:block text-sm text-muted-foreground w-24 text-right shrink-0">
            {formatDate(entry.lastPlayed)}
          </span>
        }
      />
    );
  }

  if (
    (entry.type === "playlist" || entry.type === "smartPlaylist") &&
    entry.playlist
  ) {
    const playlist = entry.playlist;
    const isSmartPlaylist = playlist.playlistType === "smartPlaylist";
    const coverArtUrl = playlist.coverArt
      ? getClient()?.getCoverArtUrl(playlist.coverArt, "small")
      : undefined;
    const PlaylistIcon = isSmartPlaylist ? Sparkles : ListMusic;

    return (
      <MediaRow
        coverArt={coverArtUrl}
        title={playlist.name}
        titleIcon={
          <PlaylistIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
        }
        subtitleContent={
          <span>
            {formatCount(playlist.songCount, "song")} •{" "}
            {formatDuration(playlist.duration)}
          </span>
        }
        href={getPlaylistDetailsHref(playlist.playlistType, playlist.id)}
        colorSeed={playlist.name}
        coverType={isSmartPlaylist ? "smartPlaylist" : "playlist"}
        index={index}
        onPlay={() => onPlayPlaylist(playlist)}
        onDoubleClick={() => onPlayPlaylist(playlist)}
        rightContent={
          <span className="hidden sm:block text-sm text-muted-foreground w-24 text-right shrink-0">
            {formatDate(entry.lastPlayed)}
          </span>
        }
      />
    );
  }

  if (entry.source) {
    const source = entry.source;
    const details = getContinueListeningSourceDetails(
      source.sourceType,
      source.id,
    );
    if (!details) {
      return null;
    }

    const SourceIcon = getContinueListeningSourceIcon(
      details.queueSourceType,
      source.id,
    );
    if (!SourceIcon) {
      return null;
    }

    const href = getQueueSourceHref({
      type: details.queueSourceType,
      id: source.id,
      name: source.name,
    });
    const coverArtUrl = source.coverArt
      ? getClient()?.getCoverArtUrl(source.coverArt, "small")
      : undefined;

    return (
      <MediaRow
        coverArt={coverArtUrl}
        title={source.name}
        titleIcon={
          <SourceIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
        }
        subtitle={details.subtitle}
        href={href ?? undefined}
        colorSeed={source.name}
        coverType={details.coverType}
        index={index}
        onPlay={() => onPlaySource(source)}
        onDoubleClick={() => onPlaySource(source)}
        rightContent={
          <span className="hidden sm:block text-sm text-muted-foreground w-24 text-right shrink-0">
            {formatDate(entry.lastPlayed)}
          </span>
        }
      />
    );
  }

  return null;
}

export default function HomeSectionPage() {
  const { sectionId } = useParams();
  const [searchParams] = useSearchParams();
  const section = getHomeSectionConfig(sectionId);
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const startQueue = useSetAtom(startQueueAtom);
  const [songColumnVisibility, setSongColumnVisibility] = useAtom(
    homeSongColumnVisibilityAtom,
  );
  const [albumColumnVisibility, setAlbumColumnVisibility] = useAtom(
    homeAlbumColumnVisibilityAtom,
  );
  const [filter, setFilter] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>(() =>
    getDefaultSortConfig(section),
  );
  const mostPlayedRecentlyDays = getPositiveNumberParam(
    searchParams,
    "days",
    DEFAULT_MOST_PLAYED_RECENTLY_DAYS,
  );
  const forgottenFavoritesMinPlays = getPositiveNumberParam(
    searchParams,
    "minPlays",
    DEFAULT_FORGOTTEN_FAVORITES_MIN_PLAYS,
  );
  const forgottenFavoritesNotPlayedSinceDays = getPositiveNumberParam(
    searchParams,
    "notPlayedSinceDays",
    DEFAULT_FORGOTTEN_FAVORITES_NOT_PLAYED_DAYS,
  );
  const forgottenFavoritesFilters = {
    minPlays: forgottenFavoritesMinPlays,
    notPlayedSinceDays: forgottenFavoritesNotPlayedSinceDays,
  };
  const debouncedFilter = useDebounce(filter, 300);
  const seedRef = useRef<number | undefined>(undefined);
  const mostPlayedFiltersRef = useRef(
    getMostPlayedRecentlyFilters(mostPlayedRecentlyDays),
  );

  useEffect(() => {
    seedRef.current = undefined;
    mostPlayedFiltersRef.current = getMostPlayedRecentlyFilters(
      mostPlayedRecentlyDays,
    );
    setFilter("");
    setSortConfig(getDefaultSortConfig(getHomeSectionConfig(sectionId)));
  }, [
    sectionId,
    mostPlayedRecentlyDays,
    forgottenFavoritesFilters.minPlays,
    forgottenFavoritesFilters.notPlayedSinceDays,
  ]);

  const query = useInfiniteQuery({
    queryKey: [
      "home-section",
      section?.id,
      debouncedFilter,
      sortConfig.field,
      sortConfig.direction,
      mostPlayedRecentlyDays,
      forgottenFavoritesFilters.minPlays,
      forgottenFavoritesFilters.notPlayedSinceDays,
    ],
    queryFn: async ({ pageParam }) => {
      if (!section) {
        return {
          entries: [] as ContinueListeningEntry[],
          songs: [] as Song[],
          albums: [] as Album[],
          total: 0,
          count: 0,
          nextOffset: pageParam + PAGE_SIZE,
          pageSize: PAGE_SIZE,
        };
      }

      const client = getClient();
      if (!client) throw new Error("Not connected");
      const filterParam = getFilterParam(debouncedFilter);
      const sortParam = getSortParam(sortConfig);

      if (section.kind === "continueListening") {
        const response = await client.getContinueListening({
          size: PAGE_SIZE,
          offset: pageParam,
          inlineImages: "small",
          filter: filterParam,
          ...sortParam,
        });
        return {
          entries: response.entries,
          songs: [] as Song[],
          albums: [] as Album[],
          total: response.total,
          count: response.entries.length,
          nextOffset: pageParam + PAGE_SIZE,
          pageSize: PAGE_SIZE,
        };
      }

      if (
        section.kind === "song" &&
        section.queueSourceType === "mostPlayedRecently"
      ) {
        const response = await client.getMostPlayedRecently({
          size: PAGE_SIZE,
          offset: pageParam,
          inlineImages: "small",
          ...mostPlayedFiltersRef.current,
          filter: filterParam,
          ...sortParam,
        });
        return {
          entries: [] as ContinueListeningEntry[],
          songs: response.song ?? [],
          albums: [] as Album[],
          total: response.total,
          count: response.song.length,
          nextOffset: pageParam + PAGE_SIZE,
          pageSize: PAGE_SIZE,
        };
      }

      if (
        section.kind === "song" &&
        section.queueSourceType === "forgottenFavorites"
      ) {
        const response = await client.getForgottenFavorites({
          size: PAGE_SIZE,
          offset: pageParam,
          inlineImages: "small",
          seed: pageParam > 0 ? seedRef.current : undefined,
          ...forgottenFavoritesFilters,
          filter: filterParam,
          ...sortParam,
        });
        seedRef.current = response.seed;
        return {
          entries: [] as ContinueListeningEntry[],
          songs: response.song ?? [],
          albums: [] as Album[],
          total: response.total,
          count: response.song.length,
          nextOffset: pageParam + PAGE_SIZE,
          pageSize: PAGE_SIZE,
        };
      }

      if (section.kind === "album") {
        const response = await client.getAlbumList2({
          type: section.albumListType,
          size: PAGE_SIZE,
          offset: pageParam,
          inlineImages: "small",
          filter: filterParam,
          ...sortParam,
          seed:
            section.albumListType === "random" && pageParam > 0
              ? seedRef.current
              : undefined,
        });
        seedRef.current = response.albumList2.seed;
        const albums = response.albumList2.album ?? [];
        return {
          entries: [] as ContinueListeningEntry[],
          songs: [] as Song[],
          albums,
          total: response.albumList2.total,
          count: albums.length,
          nextOffset: pageParam + PAGE_SIZE,
          pageSize: PAGE_SIZE,
        };
      }

      return {
        entries: [] as ContinueListeningEntry[],
        songs: [] as Song[],
        albums: [] as Album[],
        total: 0,
        count: 0,
        nextOffset: pageParam + PAGE_SIZE,
        pageSize: PAGE_SIZE,
      };
    },
    initialPageParam: 0,
    getNextPageParam: getNextOffsetPageParam,
    enabled: isReady && section !== null,
  });

  if (!section) {
    return <Navigate to="/" replace />;
  }

  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  const songs = query.data?.pages.flatMap((page) => page.songs) ?? [];
  const albums = query.data?.pages.flatMap((page) => page.albums) ?? [];
  const loadedCount = entries.length + songs.length + albums.length;
  const totalCount = query.data?.pages[0]?.total ?? loadedCount;
  const isLoading = authLoading || query.isLoading;
  const hasItems = loadedCount > 0 || totalCount > 0;
  const hasFilter = getFilterParam(debouncedFilter) !== undefined;
  const subtitle = !isLoading
    ? formatCount(
        totalCount,
        section.kind === "album"
          ? "album"
          : section.kind === "song"
            ? "song"
            : "item",
      )
    : undefined;

  const playAll = (shuffle: boolean) => {
    const queueSort = {
      field: sortConfig.field,
      direction: sortConfig.direction,
    };

    if (section.kind === "album") {
      const seedFilters =
        section.albumListType === "random" && seedRef.current !== undefined
          ? { seed: seedRef.current }
          : undefined;
      startQueue({
        sourceType: "albumList",
        sourceId: section.albumListType,
        sourceName: section.queueSourceName,
        startIndex: 0,
        shuffle,
        filters: getQueueFilters(debouncedFilter, seedFilters),
        sort: queueSort,
      });
      return;
    }

    if (section.kind === "song") {
      const sectionFilters =
        section.queueSourceType === "mostPlayedRecently"
          ? mostPlayedFiltersRef.current
          : seedRef.current !== undefined
            ? { ...forgottenFavoritesFilters, seed: seedRef.current }
            : forgottenFavoritesFilters;
      startQueue({
        sourceType: section.queueSourceType,
        sourceName: section.queueSourceName,
        startIndex: 0,
        shuffle,
        filters: getQueueFilters(debouncedFilter, sectionFilters),
        sort: queueSort,
      });
      return;
    }

    startQueue({
      sourceType: section.queueSourceType,
      sourceName: section.queueSourceName,
      startIndex: 0,
      shuffle,
      filters: getQueueFilters(debouncedFilter),
      sort: queueSort,
    });
  };

  const handlePlayAlbum = (album: Album) => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
      startIndex: 0,
      shuffle: false,
    });
  };

  const handlePlayAlbumById = (id: string) => {
    const album = albums.find((item) => item.id === id);
    if (album) {
      handlePlayAlbum(album);
    }
  };

  const handlePlayPlaylist = (playlist: {
    id: string;
    name: string;
    playlistType: string;
  }) => {
    const sourceType: QueueSourceType =
      playlist.playlistType === "smartPlaylist" ? "smartPlaylist" : "playlist";
    startQueue({
      sourceType,
      sourceId: playlist.id,
      sourceName: playlist.name,
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

  const songQueueSource: QueueSource | undefined =
    section.kind === "song"
      ? {
          type: section.queueSourceType,
          name: section.queueSourceName,
          filters: getQueueFilters(
            debouncedFilter,
            section.queueSourceType === "mostPlayedRecently"
              ? mostPlayedFiltersRef.current
              : seedRef.current !== undefined
                ? { seed: seedRef.current }
                : undefined,
          ),
          sort: {
            field: sortConfig.field,
            direction: sortConfig.direction,
          },
        }
      : undefined;

  const toolbar =
    section.kind === "song" ? (
      <SongListToolbar
        filter={filter}
        onFilterChange={setFilter}
        filterPlaceholder={`Filter ${section.title.toLowerCase()}...`}
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        columnVisibility={songColumnVisibility}
        onColumnVisibilityChange={setSongColumnVisibility}
        viewMode={LIST_VIEW}
        onViewModeChange={() => undefined}
        showViewMode={false}
      />
    ) : section.kind === "album" ? (
      <MediaListToolbar
        filter={filter}
        onFilterChange={setFilter}
        filterPlaceholder={`Filter ${section.title.toLowerCase()}...`}
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        viewMode={LIST_VIEW}
        onViewModeChange={() => undefined}
        mediaType="album"
        columnVisibility={albumColumnVisibility}
        onColumnVisibilityChange={(visibility) => {
          if ("artist" in visibility) {
            setAlbumColumnVisibility(visibility);
          }
        }}
        showViewMode={false}
        showRecommendedSort={section.albumListType === "random"}
      />
    ) : (
      <SongListToolbar
        filter={filter}
        onFilterChange={setFilter}
        filterPlaceholder="Filter continue listening..."
        sortConfig={sortConfig}
        onSortChange={setSortConfig}
        columnVisibility={songColumnVisibility}
        onColumnVisibilityChange={setSongColumnVisibility}
        viewMode={LIST_VIEW}
        onViewModeChange={() => undefined}
        showColumns={false}
        showViewMode={false}
        sortOptionsOverride={continueListeningSortOptions}
      />
    );

  if (!isMounted || authLoading) {
    return (
      <div className="min-h-dvh">
        <DetailHeader
          icon={section.icon}
          iconClassName={section.iconClassName}
          gradientColor={section.gradientColor}
          label={section.label}
          title={section.title}
          isLoading
        />
        <ActionBar disablePlay />
        <div className="px-4 lg:px-6 py-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <MediaRowSkeleton key={index} showIndex showRightContent />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <DetailHeader
        icon={section.icon}
        iconClassName={section.iconClassName}
        gradientColor={section.gradientColor}
        label={section.label}
        title={section.title}
        subtitle={subtitle}
      />

      <ActionBar
        onPlayAll={() => playAll(false)}
        onShuffle={() => playAll(true)}
        disablePlay={isLoading || !hasItems}
        toolbar={toolbar}
      />

      <div className="px-4 lg:px-6 py-4">
        {section.kind === "continueListening" && hasItems ? (
          <>
            <div className="sticky top-18 z-10 bg-background/95 backdrop-blur-sm border-b border-border flex items-center gap-4 px-4 pr-6 py-2 h-8 border-l-2 border-l-transparent">
              <div className="w-8 text-center shrink-0 text-xs font-medium text-muted-foreground">
                #
              </div>
              <div className="w-10 shrink-0" />
              <div className="flex-1 min-w-0 text-xs font-medium text-muted-foreground">
                Item
              </div>
              <div className="hidden sm:block text-xs font-medium text-muted-foreground w-24 text-right shrink-0">
                Last Played
              </div>
            </div>
            <VirtualizedList
              items={entries}
              totalCount={totalCount}
              hasNextPage={query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              fetchNextPage={() => {
                void query.fetchNextPage();
              }}
              renderItem={(entry, index) => (
                <ContinueListeningRow
                  entry={entry}
                  index={index}
                  onPlayAlbum={handlePlayAlbum}
                  onPlayPlaylist={handlePlayPlaylist}
                  onPlaySource={handlePlaySource}
                />
              )}
              renderSkeleton={() => (
                <MediaRowSkeleton showIndex showRightContent />
              )}
              getItemKey={getEntryKey}
              estimateItemHeight={56}
            />
          </>
        ) : section.kind === "song" && hasItems && songQueueSource ? (
          <>
            <SongListHeader
              columnVisibility={songColumnVisibility}
              showCover
              stickyTop="72px"
              sortConfig={sortConfig}
              onSortChange={setSortConfig}
            />
            <VirtualizedList
              items={songs}
              totalCount={totalCount}
              hasNextPage={query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              fetchNextPage={() => {
                void query.fetchNextPage();
              }}
              renderItem={(song, index) => (
                <SongRow
                  song={song}
                  index={songColumnVisibility.trackNumber ? index : undefined}
                  songIndex={index}
                  showCover
                  inlineImagesRequested
                  showArtist={songColumnVisibility.artist}
                  showAlbum={songColumnVisibility.album}
                  showDuration={songColumnVisibility.duration}
                  showPlayCount={songColumnVisibility.playCount}
                  showYear={songColumnVisibility.year}
                  showDateAdded={songColumnVisibility.dateAdded}
                  showLastPlayed={songColumnVisibility.lastPlayed}
                  showStarred={songColumnVisibility.starred}
                  showGenre={songColumnVisibility.genre}
                  showBitRate={songColumnVisibility.bitRate}
                  showFormat={songColumnVisibility.format}
                  showRating={songColumnVisibility.rating}
                  queueSource={songQueueSource}
                />
              )}
              renderSkeleton={() => (
                <SongRowSkeleton
                  showCover
                  showIndex={songColumnVisibility.trackNumber}
                />
              )}
              getItemKey={(song) => song.id}
              estimateItemHeight={56}
            />
          </>
        ) : section.kind === "album" && hasItems ? (
          <>
            <AlbumListHeader
              columnVisibility={albumColumnVisibility}
              showIndex={albumColumnVisibility.showIndex}
              stickyTop="72px"
            />
            <VirtualizedList
              items={albums}
              totalCount={totalCount}
              hasNextPage={query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              fetchNextPage={() => {
                void query.fetchNextPage();
              }}
              renderItem={(album, index) => (
                <AlbumCardCompact
                  album={album}
                  index={albumColumnVisibility.showIndex ? index : undefined}
                  onPlay={handlePlayAlbumById}
                  showArtist={albumColumnVisibility.artist}
                  showYear={albumColumnVisibility.year}
                  showSongCount={albumColumnVisibility.songCount}
                  showDuration={albumColumnVisibility.duration}
                  showGenre={albumColumnVisibility.genre}
                  showStarred={albumColumnVisibility.starred}
                  showRating={albumColumnVisibility.rating}
                  showDateAdded={albumColumnVisibility.dateAdded}
                />
              )}
              renderSkeleton={() => (
                <MediaRowSkeleton
                  showIndex={albumColumnVisibility.showIndex}
                  showRightContent
                />
              )}
              getItemKey={(album) => album.id}
              estimateItemHeight={56}
            />
          </>
        ) : hasFilter ? (
          <EmptyFilterState message="No items match your filter" />
        ) : (
          <EmptyState icon={section.icon} title={section.emptyTitle} />
        )}
      </div>

      <div className="h-24" />
    </div>
  );
}
