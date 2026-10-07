"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSetAtom, useAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Search as SearchIcon,
  X,
  Loader2,
  ListMusic,
  Clock,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { startQueueAtom, type QueueSourceType } from "@/lib/store/server-queue";
import {
  advancedFiltersAtom,
  hasActiveFiltersAtom,
  searchHistoryAtom,
  addSearchHistoryAtom,
  clearSearchHistoryAtom,
} from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { isOfflineModeAtom } from "@/lib/store/downloads";
import { getSortedDownloadedSongs } from "@/lib/offline/downloaded-songs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton } from "@/components/browse/album-card";
import {
  ArtistCard,
  ArtistCardSkeleton,
} from "@/components/browse/artist-card";
import { SongRow, SongRowSkeleton } from "@/components/browse/song-row";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import { SmartPlaylistGridCard } from "@/components/playlists/smart-playlist-cards";
import { useSparsePagination } from "@/lib/hooks/use-sparse-pagination";
import { getPlaylistDetailsHref } from "@/lib/utils/source-links";
import type { PlaylistBrowseItem } from "@/lib/api/generated/PlaylistBrowseItem";
import { GenreCard } from "@/components/browse/genre-card";
import { CoverImage } from "@/components/shared/cover-image";
import {
  AdvancedFilterDialog,
  ActiveFilterBadges,
} from "@/components/shared/advanced-filter-dialog";
import { formatDuration, formatCount } from "@/lib/utils/format";
import type { Album, Artist, Song } from "@/lib/api/types";
import type { AdvancedFilters } from "@/lib/store/ui";

/** Results per page in the Artists/Albums/Songs tabs. */
const PAGE_SIZE = 50;
/** Cards and songs previewed per section on the "All" tab. */
const OVERVIEW_CARD_COUNT = 6;
const OVERVIEW_SONG_COUNT = 10;
const OVERVIEW_GRID =
  "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4";
const RESULT_COLUMNS = { default: 2, sm: 3, md: 4, lg: 5, xl: 6 };

/** Filters that are only applicable to songs (not albums/artists) */
const SONG_ONLY_FILTER_KEYS: (keyof AdvancedFilters)[] = [
  "minDuration",
  "maxDuration",
  "minPlayCount",
  "maxPlayCount",
  "minBitrate",
  "maxBitrate",
  "shuffleExcludedOnly",
  "disabledOnly",
  "addedAfter",
  "addedBefore",
  "lastPlayedAfter",
  "lastPlayedBefore",
  "missingCoverArt",
  "fileFormat",
  "titleFilter",
  "albumFilter",
];

/** Check if any active filters are song-specific (not supported by album/artist queries) */
function hasSongOnlyFilters(filters: AdvancedFilters): boolean {
  return SONG_ONLY_FILTER_KEYS.some((key) => {
    const v = filters[key];
    return v !== undefined && v !== false && v !== "";
  });
}

export function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isReady } = useAuth({ redirectToLogin: true });
  const startQueue = useSetAtom(startQueueAtom);
  const [advancedFilters, setAdvancedFilters] = useAtom(advancedFiltersAtom);
  const hasActiveFilters = useAtomValue(hasActiveFiltersAtom);
  const isOfflineMode = useAtomValue(isOfflineModeAtom);
  const searchHistory = useAtomValue(searchHistoryAtom);
  const addSearchHistory = useSetAtom(addSearchHistoryAtom);
  const clearSearchHistory = useSetAtom(clearSearchHistoryAtom);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const searchSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSearchRef = useRef<string | null>(null);

  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [activeTab, setActiveTab] = useState<
    "all" | "artists" | "albums" | "songs" | "genres" | "playlists"
  >("all");
  const debouncedQuery = useDebounce(query, 300);

  // Clear filters when leaving search page
  useEffect(() => {
    return () => {
      setAdvancedFilters({});
    };
  }, [setAdvancedFilters]);

  // Update URL when query changes
  useEffect(() => {
    if (debouncedQuery) {
      router.replace(`/search?q=${encodeURIComponent(debouncedQuery)}`, {
        scroll: false,
      });
      // Delay saving to search history so intermediate typing doesn't
      // pollute recent searches. Each new debounced query resets the timer.
      if (searchSaveTimerRef.current) {
        clearTimeout(searchSaveTimerRef.current);
      }
      pendingSearchRef.current = debouncedQuery;
      searchSaveTimerRef.current = setTimeout(() => {
        addSearchHistory(debouncedQuery);
        pendingSearchRef.current = null;
        searchSaveTimerRef.current = null;
      }, 5000);
    } else {
      router.replace("/search", { scroll: false });
    }
  }, [debouncedQuery, router, addSearchHistory]);

  // Flush pending search history save on unmount
  useEffect(() => {
    return () => {
      if (searchSaveTimerRef.current) {
        clearTimeout(searchSaveTimerRef.current);
      }
      if (pendingSearchRef.current) {
        addSearchHistory(pendingSearchRef.current);
      }
    };
  }, [addSearchHistory]);

  // Search is active when we have a query long enough OR when advanced filters are set
  const isSearchActive = debouncedQuery.length >= 2 || hasActiveFilters;

  const songOnlyFilters =
    hasActiveFilters && hasSongOnlyFilters(advancedFilters);
  const searchEnabled = isReady && isSearchActive && !isOfflineMode;

  // Overview: the first few of each kind plus server totals for the tabs
  const {
    data: searchResults,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["search", debouncedQuery, advancedFilters],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.search3({
        query: debouncedQuery,
        artistCount: songOnlyFilters ? 0 : OVERVIEW_CARD_COUNT,
        albumCount: songOnlyFilters ? 0 : OVERVIEW_CARD_COUNT,
        songCount: OVERVIEW_SONG_COUNT,
        // Request medium thumbnails for cards (overview) and small for song rows
        inlineImages: "medium",
        ...advancedFilters,
      });
      return response.searchResult3;
    },
    enabled: searchEnabled,
    refetchOnMount: "always",
  });

  // Each tab pages through every match as it scrolls
  const searchPage = async (
    offset: number,
    kind: "song" | "album" | "artist",
  ) => {
    const client = getClient();
    if (!client) throw new Error("Not connected");
    const response = await client.search3({
      query: debouncedQuery,
      artistCount: kind === "artist" ? PAGE_SIZE : 0,
      artistOffset: kind === "artist" ? offset : 0,
      albumCount: kind === "album" ? PAGE_SIZE : 0,
      albumOffset: kind === "album" ? offset : 0,
      songCount: kind === "song" ? PAGE_SIZE : 0,
      songOffset: kind === "song" ? offset : 0,
      inlineImages: "medium",
      ...advancedFilters,
    });
    return response.searchResult3;
  };
  const songPages = useSparsePagination<Song>({
    queryKey: ["search", "songs", debouncedQuery, advancedFilters],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const result = await searchPage(offset, "song");
      const items = result.song ?? [];
      return { items, total: result.songTotal ?? items.length };
    },
    enabled: searchEnabled && activeTab === "songs",
  });
  const albumPages = useSparsePagination<Album>({
    queryKey: ["search", "albums", debouncedQuery, advancedFilters],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const result = await searchPage(offset, "album");
      const items = result.album ?? [];
      return { items, total: result.albumTotal ?? items.length };
    },
    enabled: searchEnabled && activeTab === "albums" && !songOnlyFilters,
  });
  const artistPages = useSparsePagination<Artist>({
    queryKey: ["search", "artists", debouncedQuery, advancedFilters],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const result = await searchPage(offset, "artist");
      const items = result.artist ?? [];
      return { items, total: result.artistTotal ?? items.length };
    },
    enabled: searchEnabled && activeTab === "artists" && !songOnlyFilters,
  });

  const nameQuery = debouncedQuery.trim();
  const nameSearchEnabled = isReady && !isOfflineMode && nameQuery.length >= 2;

  // Genres and playlists are matched by name on the server
  const { data: genres = [] } = useQuery({
    queryKey: ["genres", nameQuery],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getGenres({ filter: nameQuery });
      return response.genres?.genre ?? [];
    },
    enabled: nameSearchEnabled,
    staleTime: 60000,
  });

  const { data: playlistItems = [] } = useQuery({
    queryKey: ["playlistBrowse", "search", nameQuery],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.browsePlaylists({
        recursive: true,
        filter: nameQuery,
      });
      return response.items;
    },
    enabled: nameSearchEnabled,
    staleTime: 60000,
  });

  const { data: downloadedSongs = [], isLoading: isLoadingDownloadedSongs } =
    useQuery({
      queryKey: ["offline-search-downloaded-songs"],
      queryFn: getSortedDownloadedSongs,
      enabled: isReady && isOfflineMode,
      staleTime: 30_000,
    });

  const artistTotal =
    searchResults?.artistTotal ?? searchResults?.artist?.length ?? 0;
  const albumTotal =
    searchResults?.albumTotal ?? searchResults?.album?.length ?? 0;
  const songTotal =
    searchResults?.songTotal ?? searchResults?.song?.length ?? 0;

  const offlineResults = isOfflineMode
    ? filterDownloadedSongs(downloadedSongs, debouncedQuery)
    : [];
  const offlineSearchActive = debouncedQuery.length >= 2;

  const handlePlayAlbum = (album: Album) => {
    startQueue({
      sourceType: "album",
      sourceId: album.id,
      sourceName: album.name,
      startIndex: 0,
      shuffle: false,
    });
  };

  const handlePlayArtist = (artist: Artist) => {
    startQueue({
      sourceType: "artist",
      sourceId: artist.id,
      sourceName: artist.name,
      startIndex: 0,
      shuffle: false,
    });
  };

  // Queue source for search results - uses server-side search materialization
  const searchQueueSource = {
    type: "search" as QueueSourceType,
    name: `Search: ${debouncedQuery}`,
    // No sort: the queue keeps the results' relevance order.
    filters: {
      query: debouncedQuery,
      ...advancedFilters,
    },
  };

  const hasResults =
    artistTotal > 0 ||
    albumTotal > 0 ||
    songTotal > 0 ||
    playlistItems.length > 0 ||
    genres.length > 0;

  return (
    <div className="min-h-dvh">
      {/* Header with search input */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="px-4 pb-4 pt-safe-4 lg:px-6">
          <div className="flex items-center justify-center gap-2 max-w-xl mx-auto">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="text"
                placeholder="Search for artists, albums, or songs..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setShowHistory(true)}
                onBlur={() => {
                  // Delay to allow clicking on history items
                  setTimeout(() => setShowHistory(false), 200);
                }}
                className="pl-10 pr-10 h-12 text-lg bg-secondary border-0 rounded-full"
                autoFocus
              />
              {isFetching && (
                <Loader2 className="absolute right-12 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
              )}
              {query && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                  onClick={() => setQuery("")}
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
              {/* Search history suggestions dropdown */}
              {showHistory &&
                query.length > 0 &&
                query.length < 2 &&
                (() => {
                  const matching = searchHistory.filter((h) =>
                    h.toLowerCase().includes(query.toLowerCase()),
                  );
                  if (matching.length === 0) return null;
                  return (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
                      {matching.slice(0, 8).map((h) => (
                        <button
                          key={h}
                          type="button"
                          className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 active:bg-muted/70 transition-colors text-left text-sm cursor-pointer touch-manipulation active:scale-[0.99]"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setQuery(h);
                          }}
                        >
                          <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">{h}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
            </div>
            {!isOfflineMode && <AdvancedFilterDialog className="h-10 w-10" />}
          </div>
        </div>
        {/* Active filter badges */}
        {!isOfflineMode && hasActiveFilters && (
          <div className="px-4 lg:px-6 pb-2">
            <div className="max-w-xl mx-auto">
              <ActiveFilterBadges />
            </div>
          </div>
        )}
      </header>

      {/* Content */}
      <div className="p-4 lg:p-6">
        {isOfflineMode ? (
          !offlineSearchActive ? (
            query.length > 0 ? (
              <div className="py-20 text-center text-muted-foreground">
                Type at least 2 characters to search downloaded songs
              </div>
            ) : searchHistory.length > 0 ? (
              <SearchHistory
                history={searchHistory}
                onSelect={(q) => {
                  setQuery(q);
                  inputRef.current?.focus();
                }}
                onClear={clearSearchHistory}
              />
            ) : (
              <OfflineSearchEmpty />
            )
          ) : isLoadingDownloadedSongs ? (
            <div className="space-y-1">
              {Array.from({ length: 8 }).map((_, index) => (
                <SongRowSkeleton key={index} showCover showIndex />
              ))}
            </div>
          ) : offlineResults.length > 0 ? (
            <OfflineSongResults
              songs={offlineResults}
              query={debouncedQuery}
              allDownloadedSongs={downloadedSongs}
            />
          ) : (
            <NoResults query={debouncedQuery} />
          )
        ) : !isSearchActive && !debouncedQuery ? (
          searchHistory.length > 0 ? (
            <SearchHistory
              history={searchHistory}
              onSelect={(q) => {
                setQuery(q);
                inputRef.current?.focus();
              }}
              onClear={clearSearchHistory}
            />
          ) : (
            <EmptySearch />
          )
        ) : !isSearchActive ? (
          <div className="py-20 text-center text-muted-foreground">
            Type at least 2 characters to search
          </div>
        ) : isLoading ? (
          <SearchSkeleton />
        ) : !hasResults ? (
          <NoResults query={debouncedQuery} />
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          >
            <TabsList className="mb-6">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="artists" disabled={artistTotal === 0}>
                Artists ({artistTotal})
              </TabsTrigger>
              <TabsTrigger value="albums" disabled={albumTotal === 0}>
                Albums ({albumTotal})
              </TabsTrigger>
              <TabsTrigger value="songs" disabled={songTotal === 0}>
                Songs ({songTotal})
              </TabsTrigger>
              <TabsTrigger value="genres" disabled={genres.length === 0}>
                Genres ({genres.length})
              </TabsTrigger>
              <TabsTrigger
                value="playlists"
                disabled={playlistItems.length === 0}
              >
                Playlists ({playlistItems.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-8">
              {/* Artists */}
              {searchResults?.artist && searchResults.artist.length > 0 && (
                <section>
                  <OverviewHeading
                    title="Artists"
                    total={artistTotal}
                    shown={searchResults.artist.length}
                    onShowAll={() => setActiveTab("artists")}
                  />
                  <div className={OVERVIEW_GRID}>
                    {searchResults.artist.map((artist) => (
                      <ArtistCard
                        key={artist.id}
                        artist={artist}
                        onPlay={() => handlePlayArtist(artist)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Albums */}
              {searchResults?.album && searchResults.album.length > 0 && (
                <section>
                  <OverviewHeading
                    title="Albums"
                    total={albumTotal}
                    shown={searchResults.album.length}
                    onShowAll={() => setActiveTab("albums")}
                  />
                  <div className={OVERVIEW_GRID}>
                    {searchResults.album.map((album) => (
                      <AlbumCard
                        key={album.id}
                        album={album}
                        onPlay={() => handlePlayAlbum(album)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Songs */}
              {searchResults?.song && searchResults.song.length > 0 && (
                <section>
                  <OverviewHeading
                    title="Songs"
                    total={songTotal}
                    shown={searchResults.song.length}
                    onShowAll={() => setActiveTab("songs")}
                  />
                  <div className="divide-y divide-border/50">
                    {searchResults.song.map((song, index) => (
                      <SongRow
                        key={song.id}
                        song={song}
                        index={index}
                        showCover
                        inlineImagesRequested
                        queueSongs={searchResults.song}
                        queueSource={searchQueueSource}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Genres */}
              {genres.length > 0 && (
                <section>
                  <OverviewHeading
                    title="Genres"
                    total={genres.length}
                    shown={Math.min(genres.length, OVERVIEW_CARD_COUNT)}
                    onShowAll={() => setActiveTab("genres")}
                  />
                  <div className={OVERVIEW_GRID}>
                    {genres.slice(0, OVERVIEW_CARD_COUNT).map((genre) => (
                      <GenreCard key={genre.value} genre={genre} />
                    ))}
                  </div>
                </section>
              )}

              {/* Playlists */}
              {playlistItems.length > 0 && (
                <section>
                  <OverviewHeading
                    title="Playlists"
                    total={playlistItems.length}
                    shown={Math.min(playlistItems.length, OVERVIEW_CARD_COUNT)}
                    onShowAll={() => setActiveTab("playlists")}
                  />
                  <div className={OVERVIEW_GRID}>
                    {playlistItems.slice(0, OVERVIEW_CARD_COUNT).map((item) => (
                      <PlaylistResultCard
                        key={playlistItemKey(item)}
                        item={item}
                      />
                    ))}
                  </div>
                </section>
              )}
            </TabsContent>

            <TabsContent value="artists">
              <VirtualizedGrid
                items={artistPages.items}
                totalCount={artistPages.totalCount}
                ensureRange={artistPages.ensureRange}
                renderItem={(artist) => (
                  <ArtistCard
                    artist={artist}
                    onPlay={() => handlePlayArtist(artist)}
                  />
                )}
                renderSkeleton={() => <ArtistCardSkeleton />}
                getItemKey={(artist) => artist.id}
                columns={RESULT_COLUMNS}
              />
            </TabsContent>

            <TabsContent value="albums">
              <VirtualizedGrid
                items={albumPages.items}
                totalCount={albumPages.totalCount}
                ensureRange={albumPages.ensureRange}
                renderItem={(album) => (
                  <AlbumCard
                    album={album}
                    onPlay={() => handlePlayAlbum(album)}
                  />
                )}
                renderSkeleton={() => <AlbumCardSkeleton />}
                getItemKey={(album) => album.id}
                columns={RESULT_COLUMNS}
              />
            </TabsContent>

            <TabsContent value="songs">
              <VirtualizedList
                items={songPages.items}
                totalCount={songPages.totalCount}
                ensureRange={songPages.ensureRange}
                renderItem={(song, index) => (
                  <SongRow
                    song={song}
                    index={index}
                    showCover
                    inlineImagesRequested
                    queueSource={searchQueueSource}
                  />
                )}
                renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
                getItemKey={(song) => song.id}
                estimateItemHeight={56}
              />
            </TabsContent>

            <TabsContent value="genres">
              <VirtualizedGrid
                items={genres}
                renderItem={(genre) => <GenreCard genre={genre} />}
                getItemKey={(genre) => genre.value}
                estimateItemHeight={96}
                columns={RESULT_COLUMNS}
              />
            </TabsContent>

            <TabsContent value="playlists">
              <VirtualizedGrid
                items={playlistItems}
                renderItem={(item) => <PlaylistResultCard item={item} />}
                getItemKey={playlistItemKey}
                columns={RESULT_COLUMNS}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function filterDownloadedSongs(songs: Song[], query: string): Song[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];

  return songs.filter((song) =>
    [song.title, song.artist, song.album]
      .filter((value): value is string => !!value)
      .some((value) => value.toLowerCase().includes(normalized)),
  );
}

function OfflineSongResults({
  songs,
  query,
  allDownloadedSongs,
}: {
  songs: Song[];
  query: string;
  allDownloadedSongs: Song[];
}) {
  const searchQueueSource = {
    type: "other" as QueueSourceType,
    name: `Downloaded Search: ${query}`,
  };

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <WifiOff className="h-4 w-4" />
        <span>
          Searching {allDownloadedSongs.length} downloaded song
          {allDownloadedSongs.length === 1 ? "" : "s"}
        </span>
      </div>
      <VirtualizedList
        items={songs}
        renderItem={(song, index) => (
          <SongRow
            song={song}
            index={index}
            showCover
            inlineImagesRequested
            queueSongs={songs}
            queueSource={searchQueueSource}
            disableLibraryLinks
          />
        )}
        renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
        getItemKey={(song) => song.id}
        estimateItemHeight={56}
      />
    </section>
  );
}

function SearchHistory({
  history,
  onSelect,
  onClear,
}: {
  history: string[];
  onSelect: (query: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto py-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          Recent searches
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground h-7"
          onClick={onClear}
        >
          <Trash2 className="w-3 h-3 mr-1" />
          Clear
        </Button>
      </div>
      <div className="space-y-1">
        {history.map((q) => (
          <button
            key={q}
            type="button"
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-muted/50 active:bg-muted/70 transition-colors text-left cursor-pointer touch-manipulation active:scale-[0.99]"
            onClick={() => onSelect(q)}
          >
            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm truncate">{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptySearch() {
  return (
    <div className="py-20 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring" }}
        className="w-24 h-24 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center"
      >
        <SearchIcon className="w-10 h-10 text-muted-foreground" />
      </motion.div>
      <h2 className="text-xl font-semibold mb-2">Search your library</h2>
      <p className="text-muted-foreground">Find artists, albums, and songs</p>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="py-20 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring" }}
        className="w-24 h-24 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center"
      >
        <X className="w-10 h-10 text-muted-foreground" />
      </motion.div>
      <h2 className="text-xl font-semibold mb-2">No results found</h2>
      <p className="text-muted-foreground">
        No results found for &quot;{query}&quot;
      </p>
    </div>
  );
}

function OfflineSearchEmpty() {
  return (
    <div className="py-20 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring" }}
        className="w-24 h-24 mx-auto mb-6 rounded-full bg-amber-500/10 flex items-center justify-center"
      >
        <WifiOff className="w-10 h-10 text-amber-600 dark:text-amber-400" />
      </motion.div>
      <h2 className="text-xl font-semibold mb-2">Search downloaded songs</h2>
      <p className="text-muted-foreground">
        Offline search matches downloaded song title, artist, and album.
      </p>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-8">
      <section>
        <Skeleton className="h-7 w-24 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ArtistCardSkeleton key={i} />
          ))}
        </div>
      </section>
      <section>
        <Skeleton className="h-7 w-24 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <AlbumCardSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

function playlistItemKey(item: PlaylistBrowseItem): string {
  return item.playlist ? item.playlist.id : `smart-${item.smartPlaylist?.id}`;
}

function OverviewHeading({
  title,
  total,
  shown,
  onShowAll,
}: {
  title: string;
  total: number;
  shown: number;
  onShowAll: () => void;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-xl font-bold">{title}</h2>
      {total > shown && (
        <Button
          variant="link"
          className="h-auto p-0 text-sm text-muted-foreground"
          onClick={onShowAll}
        >
          Show all {total}
        </Button>
      )}
    </div>
  );
}

// Playlist or smart playlist card for search results
function PlaylistResultCard({ item }: { item: PlaylistBrowseItem }) {
  const playlist = item.playlist;
  if (!playlist) {
    return item.smartPlaylist ? (
      <SmartPlaylistGridCard smartPlaylist={item.smartPlaylist} />
    ) : null;
  }
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 300)
    : undefined;

  return (
    <Link
      href={getPlaylistDetailsHref("playlist", playlist.id)}
      className="group block p-4 rounded-lg bg-card hover:bg-accent/70 active:bg-accent/80 hover:shadow-lg hover:shadow-black/20 active:shadow-md active:shadow-black/20 transition-all touch-manipulation active:scale-[0.98]"
    >
      <div className="relative mb-4">
        <CoverImage
          src={coverArtUrl}
          alt={playlist.name || "Playlist cover"}
          size="full"
          type="playlist"
          className="rounded-md shadow-lg"
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-xl">
            <ListMusic className="w-6 h-6 text-primary-foreground" />
          </div>
        </div>
      </div>
      <h3 className="font-semibold truncate">{playlist.name}</h3>
      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
        <span>{formatCount(playlist.songCount, "song")}</span>
        <span>•</span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDuration(playlist.duration)}
        </span>
      </div>
    </Link>
  );
}
