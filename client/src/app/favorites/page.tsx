"use client";

import { useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { Heart, Play, Shuffle, Upload } from "lucide-react";
import type {
  SongResponse,
  AlbumResponse,
  ArtistResponse,
} from "@/lib/api/types";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useVirtualizedScrollRestoration } from "@/lib/hooks/use-virtualized-scroll-restoration";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useSparsePagination } from "@/lib/hooks/use-sparse-pagination";
import {
  useTrackSelection,
  useItemSelection,
} from "@/lib/hooks/use-track-selection";
import {
  startQueueAtom,
  addToQueueAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import {
  playlistViewModeAtom,
  playlistSortAtom,
  playlistColumnVisibilityAtom,
  favoritesAlbumViewModeAtom,
  favoritesAlbumSortAtom,
  favoritesAlbumColumnVisibilityAtom,
  favoritesArtistViewModeAtom,
  favoritesArtistSortAtom,
  favoritesArtistColumnVisibilityAtom,
} from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { useInvalidateFavorites } from "@/lib/store/starred";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlbumCard,
  AlbumCardSkeleton,
  AlbumCardCompact,
} from "@/components/browse/album-card";
import {
  ArtistCard,
  ArtistCardSkeleton,
  ArtistCardCompact,
} from "@/components/browse/artist-card";
import {
  SongRow,
  SongRowSkeleton,
  SongCard,
  SongCardSkeleton,
} from "@/components/browse/song-row";
import { MediaRowSkeleton } from "@/components/shared/media-row";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import { DetailHeader } from "@/components/shared/detail-header";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { SongListHeader } from "@/components/shared/song-list-header";
import { MediaListToolbar } from "@/components/shared/media-list-toolbar";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCount, formatTotalDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { ImportFavoritesDialog } from "@/components/stats/import-favorites-dialog";
import type { Album, Artist, Song } from "@/lib/api/types";

type TabValue = "songs" | "albums" | "artists";

export default function FavoritesPage() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const invalidateFavorites = useInvalidateFavorites();
  const [activeTab, setActiveTab] = useState<TabValue>("songs");
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Separate search queries for each tab
  const [songSearchQuery, setSongSearchQuery] = useState("");
  const [albumSearchQuery, setAlbumSearchQuery] = useState("");
  const [artistSearchQuery, setArtistSearchQuery] = useState("");
  const debouncedSongSearch = useDebounce(songSearchQuery, 300);
  const debouncedAlbumSearch = useDebounce(albumSearchQuery, 300);
  const debouncedArtistSearch = useDebounce(artistSearchQuery, 300);

  // View settings for songs tab
  const [songViewMode, setSongViewMode] = useAtom(playlistViewModeAtom);
  const [songSortConfig, setSongSortConfig] = useAtom(playlistSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(
    playlistColumnVisibilityAtom,
  );

  // View settings for albums tab
  const [albumViewMode, setAlbumViewMode] = useAtom(favoritesAlbumViewModeAtom);
  const [albumSortConfig, setAlbumSortConfig] = useAtom(favoritesAlbumSortAtom);
  const [albumColumnVisibility, setAlbumColumnVisibility] = useAtom(
    favoritesAlbumColumnVisibilityAtom,
  );

  // View settings for artists tab
  const [artistViewMode, setArtistViewMode] = useAtom(
    favoritesArtistViewModeAtom,
  );
  const [artistSortConfig, setArtistSortConfig] = useAtom(
    favoritesArtistSortAtom,
  );
  const [artistColumnVisibility, setArtistColumnVisibility] = useAtom(
    favoritesArtistColumnVisibilityAtom,
  );

  const PAGE_SIZE = 50;

  // Fetch initial counts for all tabs in a single query
  // This ensures we show accurate counts in tab labels even before visiting each tab
  const { data: initialCounts } = useQuery({
    queryKey: ["favorites-counts"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Fetch minimal data (count only) for all three content types
      const response = await client.search3({
        query: "*",
        songCount: 0,
        albumCount: 0,
        artistCount: 0,
        starredOnly: true,
      });

      return {
        songs: response.searchResult3.songTotal ?? 0,
        albums: response.searchResult3.albumTotal ?? 0,
        artists: response.searchResult3.artistTotal ?? 0,
      };
    },
    enabled: isReady,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Virtualized scroll restoration for each tab
  const songScrollRestoration = useVirtualizedScrollRestoration(
    "favorites-songs-scroll",
    songViewMode,
  );
  const albumScrollRestoration = useVirtualizedScrollRestoration(
    "favorites-albums-scroll",
    albumViewMode,
  );
  const artistScrollRestoration = useVirtualizedScrollRestoration(
    "favorites-artists-scroll",
    artistViewMode,
  );

  // Fetch starred songs using sparse pagination for infinite scroll
  const {
    items: displaySongs,
    totalCount: totalSongs,
    isLoading: isSongsLoading,
    ensureRange: ensureSongsRange,
  } = useSparsePagination<SongResponse>({
    queryKey: [
      "starred-songs",
      debouncedSongSearch,
      songSortConfig,
      songViewMode,
    ],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const response = await client.search3({
        query: debouncedSongSearch.trim() || "*",
        songCount: PAGE_SIZE,
        songOffset: offset,
        albumCount: 0,
        artistCount: 0,
        starredOnly: true,
        songSort:
          songSortConfig.field !== "custom" ? songSortConfig.field : null,
        songSortDir:
          songSortConfig.field !== "custom" ? songSortConfig.direction : null,
        // Request small thumbnails for rows, medium for grid
        inlineImages: songViewMode === "grid" ? "medium" : "small",
      });
      const songs = response.searchResult3.song ?? [];
      const total = response.searchResult3.songTotal ?? songs.length;
      return { items: songs, total };
    },
    enabled: isReady && activeTab === "songs",
  });

  // Fetch starred albums using sparse pagination for infinite scroll
  const {
    items: displayAlbums,
    totalCount: totalAlbums,
    isLoading: isAlbumsLoading,
    ensureRange: ensureAlbumsRange,
  } = useSparsePagination<AlbumResponse>({
    queryKey: [
      "starred-albums",
      debouncedAlbumSearch,
      albumSortConfig,
      albumViewMode,
    ],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const response = await client.search3({
        query: debouncedAlbumSearch.trim() || "*",
        songCount: 0,
        albumCount: PAGE_SIZE,
        albumOffset: offset,
        artistCount: 0,
        starredOnly: true,
        albumSort:
          albumSortConfig.field !== "custom" ? albumSortConfig.field : null,
        albumSortDir:
          albumSortConfig.field !== "custom" ? albumSortConfig.direction : null,
        // Request medium inline thumbnails for album cards
        inlineImages: "medium",
      });
      const albums = response.searchResult3.album ?? [];
      const total = response.searchResult3.albumTotal ?? albums.length;
      return { items: albums, total };
    },
    enabled: isReady && activeTab === "albums",
  });

  // Fetch starred artists using sparse pagination for infinite scroll
  const {
    items: displayArtists,
    totalCount: totalArtists,
    isLoading: isArtistsLoading,
    ensureRange: ensureArtistsRange,
  } = useSparsePagination<ArtistResponse>({
    queryKey: [
      "starred-artists",
      debouncedArtistSearch,
      artistSortConfig,
      artistViewMode,
    ],
    pageSize: PAGE_SIZE,
    fetchPage: async (offset) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const response = await client.search3({
        query: debouncedArtistSearch.trim() || "*",
        songCount: 0,
        albumCount: 0,
        artistCount: PAGE_SIZE,
        artistOffset: offset,
        starredOnly: true,
        artistSort:
          artistSortConfig.field !== "custom" ? artistSortConfig.field : null,
        artistSortDir:
          artistSortConfig.field !== "custom"
            ? artistSortConfig.direction
            : null,
        // Request medium inline thumbnails for artist cards
        inlineImages: "medium",
      });
      const artists = response.searchResult3.artist ?? [];
      const total = response.searchResult3.artistTotal ?? artists.length;
      return { items: artists, total };
    },
    enabled: isReady && activeTab === "artists",
  });

  // Loading state per active tab (not combined - we only load active tab now)
  const isLoading =
    (activeTab === "songs" && isSongsLoading) ||
    (activeTab === "albums" && isAlbumsLoading) ||
    (activeTab === "artists" && isArtistsLoading);

  // Calculate total duration from loaded songs (approximation for display)
  const totalDuration = displaySongs.reduce(
    (acc, song) => acc + (song?.duration ?? 0),
    0,
  );

  // Queue source for favorites songs - server materializes with same sort
  const favoritesQueueSource = {
    type: "favorites" as QueueSourceType,
    name: "Favorites",
    sort:
      songSortConfig.field !== "custom"
        ? {
            field: songSortConfig.field,
            direction: songSortConfig.direction,
          }
        : undefined,
  };

  // Track selection for songs tab
  const songSelection = useTrackSelection(displaySongs);

  // Album selection
  const albumSelection = useItemSelection(displayAlbums);

  // Artist selection
  const artistSelection = useItemSelection(displayArtists);

  const handlePlaySelectedSongs = () => {
    const selected = songSelection.getSelectedSongs();
    if (selected.length > 0) {
      startQueue({
        sourceType: "favorites",
        sourceName: "Favorites (selection)",
        songIds: selected.map((s) => s.id),
        shuffle: false,
      });
      songSelection.clearSelection();
    }
  };

  // Get songs from selected albums
  const getSelectedAlbumsSongs = async (): Promise<Song[]> => {
    const client = getClient();
    if (!client) return [];

    const selectedAlbums = albumSelection.getSelectedItems();
    const songsPromises = selectedAlbums.map((album) =>
      client.getAlbum(album.id).then((res) => res.album.song ?? []),
    );
    const songsArrays = await Promise.all(songsPromises);
    return songsArrays.flat();
  };

  // Album bulk action handlers
  const handlePlaySelectedAlbums = async () => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "favorites",
        sourceName: "Favorites (albums selection)",
        songIds: songs.map((s) => s.id),
        shuffle: false,
      });
      albumSelection.clearSelection();
      toast.success(
        `Playing ${songs.length} songs from ${albumSelection.selectedCount} albums`,
      );
    }
  };

  const handleShuffleSelectedAlbums = async () => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "favorites",
        sourceName: "Favorites (albums selection)",
        songIds: songs.map((s) => s.id),
        shuffle: true,
      });
      albumSelection.clearSelection();
      toast.success(
        `Shuffling ${songs.length} songs from ${albumSelection.selectedCount} albums`,
      );
    }
  };

  const handleAddSelectedAlbumsToQueue = async (position: "next" | "end") => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position });
      albumSelection.clearSelection();
      toast.success(
        `Added ${songs.length} songs to ${position === "next" ? "play next" : "queue"}`,
      );
    }
  };

  const handleStarSelectedAlbums = async (star: boolean) => {
    const client = getClient();
    if (!client) return;

    const selected = albumSelection.getSelectedItems();
    try {
      if (star) {
        await Promise.all(selected.map((a) => client.star({ albumId: a.id })));
        toast.success(`Added ${selected.length} albums to favorites`);
      } else {
        await Promise.all(
          selected.map((a) => client.unstar({ albumId: a.id })),
        );
        toast.success(`Removed ${selected.length} albums from favorites`);
      }
      invalidateFavorites("album");
      albumSelection.clearSelection();
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  // Artist bulk action handlers
  const getSelectedArtistsSongs = async (): Promise<Song[]> => {
    const client = getClient();
    if (!client) return [];

    const selectedArtists = artistSelection.getSelectedItems();
    const songsPromises = selectedArtists.map((artist) =>
      client.getArtist(artist.id).then((res) => res.artist.song ?? []),
    );
    const songsArrays = await Promise.all(songsPromises);
    return songsArrays.flat();
  };

  const handlePlaySelectedArtists = async () => {
    const songs = await getSelectedArtistsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "favorites",
        sourceName: "Favorites (artists selection)",
        songIds: songs.map((s) => s.id),
        shuffle: false,
      });
      artistSelection.clearSelection();
      toast.success(
        `Playing ${songs.length} songs from ${artistSelection.selectedCount} artists`,
      );
    }
  };

  const handleShuffleSelectedArtists = async () => {
    const songs = await getSelectedArtistsSongs();
    if (songs.length > 0) {
      startQueue({
        sourceType: "favorites",
        sourceName: "Favorites (artists selection)",
        songIds: songs.map((s) => s.id),
        shuffle: true,
      });
      artistSelection.clearSelection();
      toast.success(
        `Shuffling ${songs.length} songs from ${artistSelection.selectedCount} artists`,
      );
    }
  };

  const handleAddSelectedArtistsToQueue = async (position: "next" | "end") => {
    const songs = await getSelectedArtistsSongs();
    if (songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position });
      artistSelection.clearSelection();
      toast.success(
        `Added ${songs.length} songs to ${position === "next" ? "play next" : "queue"}`,
      );
    }
  };

  const handleStarSelectedArtists = async (star: boolean) => {
    const client = getClient();
    if (!client) return;

    const selected = artistSelection.getSelectedItems();
    try {
      if (star) {
        await Promise.all(selected.map((a) => client.star({ artistId: a.id })));
        toast.success(`Added ${selected.length} artists to favorites`);
      } else {
        await Promise.all(
          selected.map((a) => client.unstar({ artistId: a.id })),
        );
        toast.success(`Removed ${selected.length} artists from favorites`);
      }
      invalidateFavorites("artist");
      artistSelection.clearSelection();
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  // Get the description based on active tab
  const getSubtitle = () => {
    switch (activeTab) {
      case "songs":
        return `${formatCount(totalSongs, "song")} • ${formatTotalDuration(totalDuration)}`;
      case "albums":
        return formatCount(totalAlbums, "album");
      case "artists":
        return formatCount(totalArtists, "artist");
    }
  };

  const handlePlayAll = () => {
    if (displaySongs.length > 0) {
      startQueue({
        sourceType: "favorites",
        sourceName: "Favorites",
        startIndex: 0,
        shuffle: false,
        // Pass sort config so server materializes queue in same order as displayed
        sort:
          songSortConfig.field !== "custom"
            ? {
                field: songSortConfig.field,
                direction: songSortConfig.direction,
              }
            : undefined,
      });
    }
  };

  const handleShuffle = () => {
    if (displaySongs.length > 0) {
      startQueue({
        sourceType: "favorites",
        sourceName: "Favorites",
        startIndex: 0,
        shuffle: true,
        // Pass sort config for consistent ordering before shuffle
        sort:
          songSortConfig.field !== "custom"
            ? {
                field: songSortConfig.field,
                direction: songSortConfig.direction,
              }
            : undefined,
      });
    }
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

  const handlePlayArtist = (artist: Artist) => {
    startQueue({
      sourceType: "artist",
      sourceId: artist.id,
      sourceName: artist.name,
      startIndex: 0,
      shuffle: false,
    });
  };

  // Always render the same loading state on server and during hydration
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-dvh">
        {/* Header skeleton */}
        <div className="relative">
          <div className="absolute inset-0 h-75 bg-linear-to-b from-red-500/20 to-background" />
          <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
            <div className="flex items-center gap-6">
              <Skeleton className="w-48 h-48 rounded-lg" />
              <div>
                <Skeleton className="h-4 w-16 mb-2" />
                <Skeleton className="h-12 w-48 mb-4" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
        </div>
        {/* Action buttons skeleton */}
        <div className="px-4 lg:px-6 py-4 border-b border-border">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-28 rounded-full" />
            <Skeleton className="h-12 w-28 rounded-full" />
          </div>
        </div>
        {/* Track list skeleton */}
        <div className="px-4 lg:px-6 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="w-8 h-4" />
              <Skeleton className="w-10 h-10 rounded" />
              <div className="flex-1">
                <Skeleton className="h-4 w-40 mb-1" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <DetailHeader
        icon={Heart}
        iconClassName="bg-linear-to-br from-red-500 to-red-800 [&>svg]:fill-white"
        gradientColor="rgba(239,68,68,0.2)"
        backgroundHeight={300}
        title="Favorites"
        isLoading={isLoading}
        subtitle={!isLoading && getSubtitle()}
      />

      {/* Action buttons */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 px-4 lg:px-6 py-4">
          <Button
            size="lg"
            className="rounded-full gap-2 px-8"
            onClick={handlePlayAll}
            disabled={isLoading || displaySongs.length === 0}
          >
            <Play className="w-5 h-5 ml-0.5" />
            Play
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleShuffle}
            disabled={isLoading || displaySongs.length === 0}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full gap-2"
            onClick={() => setImportDialogOpen(true)}
          >
            <Upload className="w-5 h-5" />
            Import
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Song list toolbar - only show on songs tab */}
          {activeTab === "songs" && (
            <SongListToolbar
              filter={songSearchQuery}
              onFilterChange={setSongSearchQuery}
              sortConfig={songSortConfig}
              onSortChange={setSongSortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              viewMode={songViewMode}
              onViewModeChange={setSongViewMode}
              filterPlaceholder="Search songs..."
            />
          )}

          {/* Albums toolbar */}
          {activeTab === "albums" && (
            <MediaListToolbar
              filter={albumSearchQuery}
              onFilterChange={setAlbumSearchQuery}
              sortConfig={albumSortConfig}
              onSortChange={setAlbumSortConfig}
              viewMode={albumViewMode}
              onViewModeChange={setAlbumViewMode}
              mediaType="album"
              filterPlaceholder="Search albums..."
              columnVisibility={albumColumnVisibility}
              onColumnVisibilityChange={(v) =>
                setAlbumColumnVisibility(v as typeof albumColumnVisibility)
              }
            />
          )}

          {/* Artists toolbar */}
          {activeTab === "artists" && (
            <MediaListToolbar
              filter={artistSearchQuery}
              onFilterChange={setArtistSearchQuery}
              sortConfig={artistSortConfig}
              onSortChange={setArtistSortConfig}
              viewMode={artistViewMode}
              onViewModeChange={setArtistViewMode}
              mediaType="artist"
              filterPlaceholder="Search artists..."
              columnVisibility={artistColumnVisibility}
              onColumnVisibilityChange={(v) =>
                setArtistColumnVisibility(v as typeof artistColumnVisibility)
              }
            />
          )}
        </div>
      </div>

      {/* Content tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="w-full"
      >
        <div className="px-4 lg:px-6 pt-4">
          <TabsList>
            <TabsTrigger value="songs">
              Songs ({totalSongs || initialCounts?.songs || 0})
            </TabsTrigger>
            <TabsTrigger value="albums">
              Albums ({totalAlbums || initialCounts?.albums || 0})
            </TabsTrigger>
            <TabsTrigger value="artists">
              Artists ({totalArtists || initialCounts?.artists || 0})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="songs" className="mt-0">
          <div
            className={cn(
              "p-4 lg:p-6",
              songSelection.hasSelection && "select-none-during-selection",
            )}
          >
            {isLoading ? (
              songViewMode === "grid" ? (
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <SongCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <SongRowSkeleton key={i} showCover showIndex />
                  ))}
                </div>
              )
            ) : displaySongs.length > 0 || totalSongs > 0 ? (
              songViewMode === "grid" ? (
                <VirtualizedGrid
                  items={displaySongs}
                  totalCount={totalSongs}
                  renderItem={(song, index) => (
                    <SongCard
                      song={song}
                      index={index}
                      inlineImagesRequested
                      queueSource={favoritesQueueSource}
                      isSelected={songSelection.isSelected(song.id)}
                      isSelectionMode={songSelection.hasSelection}
                      onSelect={songSelection.handleSelect}
                    />
                  )}
                  renderSkeleton={() => <SongCardSkeleton />}
                  getItemKey={(song) => song.id}
                  ensureRange={ensureSongsRange}
                  initialOffset={songScrollRestoration.getInitialOffset()}
                  onScrollChange={songScrollRestoration.saveOffset}
                  scrollToIndex={songScrollRestoration.getScrollToIndex()}
                  onFirstVisibleIndexChange={
                    songScrollRestoration.saveFirstVisibleIndex
                  }
                />
              ) : (
                <>
                  <SongListHeader
                    columnVisibility={columnVisibility}
                    showIndex
                    showCover
                    sortConfig={songSortConfig}
                    onSortChange={setSongSortConfig}
                  />
                  <VirtualizedList
                    items={displaySongs}
                    totalCount={totalSongs}
                    renderItem={(song, index) => (
                      <SongRow
                        song={song}
                        index={columnVisibility.trackNumber ? index : undefined}
                        showCover
                        inlineImagesRequested
                        showAlbum={columnVisibility.album}
                        showArtist={columnVisibility.artist}
                        showDuration={columnVisibility.duration}
                        showPlayCount={columnVisibility.playCount}
                        showYear={columnVisibility.year}
                        showDateAdded={columnVisibility.dateAdded}
                        showLastPlayed={columnVisibility.lastPlayed}
                        showStarred={columnVisibility.starred}
                        showGenre={columnVisibility.genre}
                        showBitRate={columnVisibility.bitRate}
                        showFormat={columnVisibility.format}
                        showRating={columnVisibility.rating}
                        queueSource={favoritesQueueSource}
                        isSelected={songSelection.isSelected(song.id)}
                        isSelectionMode={songSelection.hasSelection}
                        onSelect={songSelection.handleSelect}
                      />
                    )}
                    renderSkeleton={() => (
                      <SongRowSkeleton showCover showIndex />
                    )}
                    getItemKey={(song) => song.id}
                    estimateItemHeight={56}
                    ensureRange={ensureSongsRange}
                    initialOffset={songScrollRestoration.getInitialOffset()}
                    onScrollChange={songScrollRestoration.saveOffset}
                    onFirstVisibleIndexChange={
                      songScrollRestoration.saveFirstVisibleIndex
                    }
                  />
                </>
              )
            ) : (
              <EmptyState
                icon={Heart}
                title={
                  debouncedSongSearch
                    ? "No songs match your search"
                    : "No liked songs yet"
                }
                description="Start liking songs to build your collection"
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="albums" className="mt-0">
          <div
            className={cn(
              "p-4 lg:p-6",
              albumSelection.hasSelection && "select-none-during-selection",
            )}
          >
            {isLoading ? (
              albumViewMode === "grid" ? (
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <AlbumCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <MediaRowSkeleton
                      key={i}
                      showIndex={albumColumnVisibility.showIndex}
                    />
                  ))}
                </div>
              )
            ) : displayAlbums.length > 0 || totalAlbums > 0 ? (
              albumViewMode === "grid" ? (
                <VirtualizedGrid
                  items={displayAlbums}
                  totalCount={totalAlbums}
                  renderItem={(album) => (
                    <AlbumCard
                      album={album}
                      onPlay={() => handlePlayAlbum(album)}
                      isSelected={albumSelection.isSelected(album.id)}
                      isSelectionMode={albumSelection.hasSelection}
                      onSelect={albumSelection.handleSelect}
                    />
                  )}
                  renderSkeleton={() => <AlbumCardSkeleton />}
                  getItemKey={(album) => album.id}
                  ensureRange={ensureAlbumsRange}
                  initialOffset={albumScrollRestoration.getInitialOffset()}
                  onScrollChange={albumScrollRestoration.saveOffset}
                  scrollToIndex={albumScrollRestoration.getScrollToIndex()}
                  onFirstVisibleIndexChange={
                    albumScrollRestoration.saveFirstVisibleIndex
                  }
                />
              ) : (
                <VirtualizedList
                  items={displayAlbums}
                  totalCount={totalAlbums}
                  renderItem={(album, index) => (
                    <AlbumCardCompact
                      album={album}
                      index={
                        albumColumnVisibility.showIndex ? index : undefined
                      }
                      onPlay={() => handlePlayAlbum(album)}
                      isSelected={albumSelection.isSelected(album.id)}
                      isSelectionMode={albumSelection.hasSelection}
                      onSelect={albumSelection.handleSelect}
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
                    />
                  )}
                  getItemKey={(album) => album.id}
                  estimateItemHeight={56}
                  ensureRange={ensureAlbumsRange}
                  initialOffset={albumScrollRestoration.getInitialOffset()}
                  onScrollChange={albumScrollRestoration.saveOffset}
                  onFirstVisibleIndexChange={
                    albumScrollRestoration.saveFirstVisibleIndex
                  }
                />
              )
            ) : (
              <EmptyState
                icon={Heart}
                title={
                  debouncedAlbumSearch
                    ? "No albums match your search"
                    : "No liked albums yet"
                }
                description="Start liking albums to build your collection"
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="artists" className="mt-0">
          <div
            className={cn(
              "p-4 lg:p-6",
              artistSelection.hasSelection && "select-none-during-selection",
            )}
          >
            {isLoading ? (
              artistViewMode === "grid" ? (
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <ArtistCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <MediaRowSkeleton
                      key={i}
                      showIndex={artistColumnVisibility.showIndex}
                    />
                  ))}
                </div>
              )
            ) : displayArtists.length > 0 || totalArtists > 0 ? (
              artistViewMode === "grid" ? (
                <VirtualizedGrid
                  items={displayArtists}
                  totalCount={totalArtists}
                  renderItem={(artist) => (
                    <ArtistCard
                      artist={artist}
                      onPlay={() => handlePlayArtist(artist)}
                      isSelected={artistSelection.isSelected(artist.id)}
                      isSelectionMode={artistSelection.hasSelection}
                      onSelect={artistSelection.handleSelect}
                    />
                  )}
                  renderSkeleton={() => <ArtistCardSkeleton />}
                  getItemKey={(artist) => artist.id}
                  ensureRange={ensureArtistsRange}
                  initialOffset={artistScrollRestoration.getInitialOffset()}
                  onScrollChange={artistScrollRestoration.saveOffset}
                  scrollToIndex={artistScrollRestoration.getScrollToIndex()}
                  onFirstVisibleIndexChange={
                    artistScrollRestoration.saveFirstVisibleIndex
                  }
                />
              ) : (
                <VirtualizedList
                  items={displayArtists}
                  totalCount={totalArtists}
                  renderItem={(artist, index) => (
                    <ArtistCardCompact
                      artist={artist}
                      index={
                        artistColumnVisibility.showIndex ? index : undefined
                      }
                      onPlay={() => handlePlayArtist(artist)}
                      isSelected={artistSelection.isSelected(artist.id)}
                      isSelectionMode={artistSelection.hasSelection}
                      onSelect={artistSelection.handleSelect}
                      showAlbumCount={artistColumnVisibility.albumCount}
                      showSongCount={artistColumnVisibility.songCount}
                      showStarred={artistColumnVisibility.starred}
                      showRating={artistColumnVisibility.rating}
                    />
                  )}
                  renderSkeleton={() => (
                    <MediaRowSkeleton
                      showIndex={artistColumnVisibility.showIndex}
                    />
                  )}
                  getItemKey={(artist) => artist.id}
                  estimateItemHeight={56}
                  ensureRange={ensureArtistsRange}
                  initialOffset={artistScrollRestoration.getInitialOffset()}
                  onScrollChange={artistScrollRestoration.saveOffset}
                  onFirstVisibleIndexChange={
                    artistScrollRestoration.saveFirstVisibleIndex
                  }
                />
              )
            ) : (
              <EmptyState
                icon={Heart}
                title={
                  debouncedArtistSearch
                    ? "No artists match your search"
                    : "No liked artists yet"
                }
                description="Start liking artists to build your collection"
              />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Bulk actions bar for songs */}
      {activeTab === "songs" && (
        <BulkActionsBar
          selectedCount={songSelection.selectedCount}
          onClear={songSelection.clearSelection}
          onPlayNow={handlePlaySelectedSongs}
          onPlayNext={() => songSelection.addSelectedToQueue("next")}
          onAddToQueue={() => songSelection.addSelectedToQueue("end")}
          onStar={() => songSelection.starSelected(true)}
          onUnstar={() => songSelection.starSelected(false)}
          onSelectAll={songSelection.selectAll}
          getSelectedSongs={songSelection.getSelectedSongs}
        />
      )}

      {/* Bulk actions bar for albums */}
      {activeTab === "albums" && (
        <BulkActionsBar
          mediaType="album"
          selectedCount={albumSelection.selectedCount}
          onClear={albumSelection.clearSelection}
          onPlayNow={handlePlaySelectedAlbums}
          onShuffle={handleShuffleSelectedAlbums}
          onPlayNext={() => handleAddSelectedAlbumsToQueue("next")}
          onAddToQueue={() => handleAddSelectedAlbumsToQueue("end")}
          onStar={() => handleStarSelectedAlbums(true)}
          onUnstar={() => handleStarSelectedAlbums(false)}
          onSelectAll={albumSelection.selectAll}
          getSelectedItems={albumSelection.getSelectedItems}
        />
      )}

      {/* Bulk actions bar for artists */}
      {activeTab === "artists" && (
        <BulkActionsBar
          mediaType="artist"
          selectedCount={artistSelection.selectedCount}
          onClear={artistSelection.clearSelection}
          onPlayNow={handlePlaySelectedArtists}
          onShuffle={handleShuffleSelectedArtists}
          onPlayNext={() => handleAddSelectedArtistsToQueue("next")}
          onAddToQueue={() => handleAddSelectedArtistsToQueue("end")}
          onStar={() => handleStarSelectedArtists(true)}
          onUnstar={() => handleStarSelectedArtists(false)}
          onSelectAll={artistSelection.selectAll}
          getSelectedItems={artistSelection.getSelectedItems}
        />
      )}

      {/* Spacer for player bar */}
      <div className="h-24" />

      {/* Import Favorites Dialog */}
      <ImportFavoritesDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />
    </div>
  );
}
