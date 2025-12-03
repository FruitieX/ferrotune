"use client";

import { useState, useMemo, useCallback } from "react";
import { useAtom, useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Heart, Play, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useTrackSelection, useItemSelection } from "@/lib/hooks/use-track-selection";
import { playNowAtom, isShuffledAtom, addToQueueAtom } from "@/lib/store/queue";
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
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumCard, AlbumCardSkeleton, AlbumCardCompact } from "@/components/browse/album-card";
import { ArtistCard, ArtistCardSkeleton, ArtistCardCompact } from "@/components/browse/artist-card";
import { SongRow, SongRowSkeleton, SongCard, SongCardSkeleton } from "@/components/browse/song-row";
import { MediaRowSkeleton } from "@/components/shared/media-row";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { SongListToolbar } from "@/components/shared/song-list-toolbar";
import { MediaListToolbar } from "@/components/shared/media-list-toolbar";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { formatCount, formatTotalDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Album, Artist, Song } from "@/lib/api/types";
import { sortSongs } from "@/lib/utils/sort-songs";
import { sortAlbums, sortArtists } from "@/lib/utils/sort-media";

type TabValue = "songs" | "albums" | "artists";

export default function FavoritesPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const setIsShuffled = useSetAtom(isShuffledAtom);
  const [activeTab, setActiveTab] = useState<TabValue>("songs");
  
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
  const [columnVisibility, setColumnVisibility] = useAtom(playlistColumnVisibilityAtom);
  
  // View settings for albums tab
  const [albumViewMode, setAlbumViewMode] = useAtom(favoritesAlbumViewModeAtom);
  const [albumSortConfig, setAlbumSortConfig] = useAtom(favoritesAlbumSortAtom);
  const [albumColumnVisibility, setAlbumColumnVisibility] = useAtom(favoritesAlbumColumnVisibilityAtom);
  
  // View settings for artists tab
  const [artistViewMode, setArtistViewMode] = useAtom(favoritesArtistViewModeAtom);
  const [artistSortConfig, setArtistSortConfig] = useAtom(favoritesArtistSortAtom);
  const [artistColumnVisibility, setArtistColumnVisibility] = useAtom(favoritesArtistColumnVisibilityAtom);
  
  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  // Fetch starred items
  const { data: starredData, isLoading } = useQuery({
    queryKey: ["starred"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getStarred2();
      return response.starred2;
    },
    enabled: isReady,
  });

  const songs = starredData?.song ?? [];
  const albums = starredData?.album ?? [];
  const artists = starredData?.artist ?? [];

  // Filter and sort songs
  const displaySongs = useMemo(() => {
    let filtered = songs;
    if (debouncedSongSearch.trim()) {
      const query = debouncedSongSearch.toLowerCase();
      filtered = songs.filter(song => 
        song.title.toLowerCase().includes(query) ||
        song.artist?.toLowerCase().includes(query) ||
        song.album?.toLowerCase().includes(query)
      );
    }
    return sortSongs(filtered as Song[], songSortConfig.field, songSortConfig.direction);
  }, [songs, debouncedSongSearch, songSortConfig]);

  // Filter and sort albums
  const displayAlbums = useMemo(() => {
    let filtered = albums;
    if (debouncedAlbumSearch.trim()) {
      const query = debouncedAlbumSearch.toLowerCase();
      filtered = albums.filter(album => 
        album.name.toLowerCase().includes(query) ||
        album.artist?.toLowerCase().includes(query)
      );
    }
    return sortAlbums(filtered, albumSortConfig.field, albumSortConfig.direction);
  }, [albums, debouncedAlbumSearch, albumSortConfig]);

  // Filter and sort artists
  const displayArtists = useMemo(() => {
    let filtered = artists;
    if (debouncedArtistSearch.trim()) {
      const query = debouncedArtistSearch.toLowerCase();
      filtered = artists.filter(artist => 
        artist.name.toLowerCase().includes(query)
      );
    }
    return sortArtists(filtered, artistSortConfig.field, artistSortConfig.direction);
  }, [artists, debouncedArtistSearch, artistSortConfig]);

  const totalDuration = displaySongs.reduce((acc, song) => acc + song.duration, 0);

  // Track selection for songs tab
  const songSelection = useTrackSelection(displaySongs);

  // Album selection
  const albumSelection = useItemSelection(displayAlbums);

  // Artist selection
  const artistSelection = useItemSelection(displayArtists);

  const handlePlaySelectedSongs = () => {
    const selected = songSelection.getSelectedSongs();
    if (selected.length > 0) {
      playNow(selected);
      songSelection.clearSelection();
    }
  };

  // Get songs from selected albums
  const getSelectedAlbumsSongs = async (): Promise<Song[]> => {
    const client = getClient();
    if (!client) return [];
    
    const selectedAlbums = albumSelection.getSelectedItems();
    const songsPromises = selectedAlbums.map(album => 
      client.getAlbum(album.id).then(res => res.album.song ?? [])
    );
    const songsArrays = await Promise.all(songsPromises);
    return songsArrays.flat();
  };

  // Album bulk action handlers
  const handlePlaySelectedAlbums = async () => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      playNow(songs);
      albumSelection.clearSelection();
      toast.success(`Playing ${songs.length} songs from ${albumSelection.selectedCount} albums`);
    }
  };

  const handleShuffleSelectedAlbums = async () => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      albumSelection.clearSelection();
      toast.success(`Shuffling ${songs.length} songs from ${albumSelection.selectedCount} albums`);
    }
  };

  const handleAddSelectedAlbumsToQueue = async (position: "next" | "last") => {
    const songs = await getSelectedAlbumsSongs();
    if (songs.length > 0) {
      songs.forEach(song => addToQueue(song, position));
      albumSelection.clearSelection();
      toast.success(`Added ${songs.length} songs to ${position === "next" ? "play next" : "queue"}`);
    }
  };

  const handleStarSelectedAlbums = async (star: boolean) => {
    const client = getClient();
    if (!client) return;
    
    const selected = albumSelection.getSelectedItems();
    try {
      if (star) {
        await Promise.all(selected.map(a => client.star({ albumId: a.id })));
        toast.success(`Added ${selected.length} albums to favorites`);
      } else {
        await Promise.all(selected.map(a => client.unstar({ albumId: a.id })));
        toast.success(`Removed ${selected.length} albums from favorites`);
      }
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
    const songsPromises = selectedArtists.map(artist => 
      client.getArtist(artist.id).then(res => res.artist.song ?? [])
    );
    const songsArrays = await Promise.all(songsPromises);
    return songsArrays.flat();
  };

  const handlePlaySelectedArtists = async () => {
    const songs = await getSelectedArtistsSongs();
    if (songs.length > 0) {
      playNow(songs);
      artistSelection.clearSelection();
      toast.success(`Playing ${songs.length} songs from ${artistSelection.selectedCount} artists`);
    }
  };

  const handleShuffleSelectedArtists = async () => {
    const songs = await getSelectedArtistsSongs();
    if (songs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      artistSelection.clearSelection();
      toast.success(`Shuffling ${songs.length} songs from ${artistSelection.selectedCount} artists`);
    }
  };

  const handleAddSelectedArtistsToQueue = async (position: "next" | "last") => {
    const songs = await getSelectedArtistsSongs();
    if (songs.length > 0) {
      songs.forEach(song => addToQueue(song, position));
      artistSelection.clearSelection();
      toast.success(`Added ${songs.length} songs to ${position === "next" ? "play next" : "queue"}`);
    }
  };

  const handleStarSelectedArtists = async (star: boolean) => {
    const client = getClient();
    if (!client) return;
    
    const selected = artistSelection.getSelectedItems();
    try {
      if (star) {
        await Promise.all(selected.map(a => client.star({ artistId: a.id })));
        toast.success(`Added ${selected.length} artists to favorites`);
      } else {
        await Promise.all(selected.map(a => client.unstar({ artistId: a.id })));
        toast.success(`Removed ${selected.length} artists from favorites`);
      }
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
        return `${formatCount(displaySongs.length, "song")} • ${formatTotalDuration(totalDuration)}`;
      case "albums":
        return formatCount(displayAlbums.length, "album");
      case "artists":
        return formatCount(displayArtists.length, "artist");
    }
  };

  const handlePlayAll = () => {
    if (displaySongs.length > 0) {
      setIsShuffled(false);
      playNow(displaySongs);
    }
  };

  const handleShuffle = () => {
    if (displaySongs.length > 0) {
      setIsShuffled(true);
      const shuffled = [...displaySongs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
    }
  };

  const handlePlayAlbum = async (album: Album) => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getAlbum(album.id);
      if (response.album.song?.length > 0) {
        playNow(response.album.song);
      }
    } catch (error) {
      console.error("Failed to play album:", error);
    }
  };

  const handlePlayArtist = async (artist: Artist) => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getArtist(artist.id);
      if (response.artist.song && response.artist.song.length > 0) {
        playNow(response.artist.song);
      }
    } catch (error) {
      console.error("Failed to play artist:", error);
    }
  };

  // Always render the same loading state on server and during hydration
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen">
        {/* Header skeleton */}
        <div className="relative">
          <div className="absolute inset-0 h-[300px] bg-linear-to-b from-red-500/20 to-background" />
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
    <div className="min-h-screen">
      {/* Header */}
      <div className="relative">
        <div 
          className="absolute inset-0 h-[300px]"
          style={{
            background: `linear-gradient(180deg, rgba(239,68,68,0.2) 0%, rgba(10,10,10,1) 100%)`
          }}
        />

        <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
          <div className="flex items-center gap-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-48 h-48 rounded-lg bg-linear-to-br from-red-500 to-red-800 flex items-center justify-center shadow-xl"
            >
              <Heart className="w-20 h-20 text-white fill-white" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <h1 className="text-4xl lg:text-5xl font-bold mt-2">Favorites</h1>
              <p className="mt-4 text-muted-foreground">
                {getSubtitle()}
              </p>
            </motion.div>
          </div>
        </div>
      </div>

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
              onColumnVisibilityChange={(v) => setAlbumColumnVisibility(v as typeof albumColumnVisibility)}
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
              onColumnVisibilityChange={(v) => setArtistColumnVisibility(v as typeof artistColumnVisibility)}
            />
          )}
        </div>
      </div>

      {/* Content tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="w-full">
        <div className="px-4 lg:px-6 pt-4">
          <TabsList>
            <TabsTrigger value="songs">
              Songs ({displaySongs.length})
            </TabsTrigger>
            <TabsTrigger value="albums">
              Albums ({displayAlbums.length})
            </TabsTrigger>
            <TabsTrigger value="artists">
              Artists ({displayArtists.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="songs" className="mt-0">
          <div className={cn("p-4 lg:p-6", songSelection.hasSelection && "select-none-during-selection")}>
            {isLoading ? (
              songViewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
            ) : displaySongs.length > 0 ? (
              songViewMode === "grid" ? (
                <VirtualizedGrid
                  items={displaySongs}
                  renderItem={(song) => (
                    <SongCard 
                      song={song} 
                      queueSongs={displaySongs}
                      isSelected={songSelection.isSelected(song.id)}
                      isSelectionMode={songSelection.hasSelection}
                      onSelect={(e) => songSelection.handleSelect(song.id, e)}
                    />
                  )}
                  renderSkeleton={() => <SongCardSkeleton />}
                  getItemKey={(song) => song.id}
                />
              ) : (
                <VirtualizedList
                  items={displaySongs}
                  renderItem={(song, index) => (
                    <SongRow
                      song={song}
                      index={index}
                      showCover
                      showAlbum={columnVisibility.album}
                      showArtist={columnVisibility.artist}
                      showDuration={columnVisibility.duration}
                      showPlayCount={columnVisibility.playCount}
                      showYear={columnVisibility.year}
                      showDateAdded={columnVisibility.dateAdded}
                      queueSongs={displaySongs}
                      isSelected={songSelection.isSelected(song.id)}
                      isSelectionMode={songSelection.hasSelection}
                      onSelect={(e) => songSelection.handleSelect(song.id, e)}
                    />
                  )}
                  renderSkeleton={() => <SongRowSkeleton showCover showIndex />}
                  getItemKey={(song) => song.id}
                  estimateItemHeight={56}
                />
              )
            ) : (
              <EmptyState message={debouncedSongSearch ? "No songs match your search" : "No liked songs yet"} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="albums" className="mt-0">
          <div className={cn("p-4 lg:p-6", albumSelection.hasSelection && "select-none-during-selection")}>
            {isLoading ? (
              albumViewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <AlbumCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <MediaRowSkeleton key={i} showIndex />
                  ))}
                </div>
              )
            ) : displayAlbums.length > 0 ? (
              albumViewMode === "grid" ? (
                <VirtualizedGrid
                  items={displayAlbums}
                  renderItem={(album) => (
                    <AlbumCard 
                      album={album} 
                      onPlay={() => handlePlayAlbum(album)}
                      isSelected={albumSelection.isSelected(album.id)}
                      isSelectionMode={albumSelection.hasSelection}
                      onSelect={(e) => albumSelection.handleSelect(album.id, e)}
                    />
                  )}
                  renderSkeleton={() => <AlbumCardSkeleton />}
                  getItemKey={(album) => album.id}
                />
              ) : (
                <VirtualizedList
                  items={displayAlbums}
                  renderItem={(album, index) => (
                    <AlbumCardCompact
                      album={album}
                      index={index}
                      onPlay={() => handlePlayAlbum(album)}
                      isSelected={albumSelection.isSelected(album.id)}
                      isSelectionMode={albumSelection.hasSelection}
                      onSelect={(e) => albumSelection.handleSelect(album.id, e)}
                      showArtist={albumColumnVisibility.artist}
                      showYear={albumColumnVisibility.year}
                      showSongCount={albumColumnVisibility.songCount}
                      showDuration={albumColumnVisibility.duration}
                    />
                  )}
                  renderSkeleton={() => <MediaRowSkeleton showIndex />}
                  getItemKey={(album) => album.id}
                  estimateItemHeight={56}
                />
              )
            ) : (
              <EmptyState message={debouncedAlbumSearch ? "No albums match your search" : "No liked albums yet"} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="artists" className="mt-0">
          <div className={cn("p-4 lg:p-6", artistSelection.hasSelection && "select-none-during-selection")}>
            {isLoading ? (
              artistViewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <ArtistCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <MediaRowSkeleton key={i} showIndex />
                  ))}
                </div>
              )
            ) : displayArtists.length > 0 ? (
              artistViewMode === "grid" ? (
                <VirtualizedGrid
                  items={displayArtists}
                  renderItem={(artist) => (
                    <ArtistCard 
                      artist={artist}
                      onPlay={() => handlePlayArtist(artist)}
                      isSelected={artistSelection.isSelected(artist.id)}
                      isSelectionMode={artistSelection.hasSelection}
                      onSelect={(e) => artistSelection.handleSelect(artist.id, e)}
                    />
                  )}
                  renderSkeleton={() => <ArtistCardSkeleton />}
                  getItemKey={(artist) => artist.id}
                />
              ) : (
                <VirtualizedList
                  items={displayArtists}
                  renderItem={(artist, index) => (
                    <ArtistCardCompact
                      artist={artist}
                      index={index}
                      onPlay={() => handlePlayArtist(artist)}
                      isSelected={artistSelection.isSelected(artist.id)}
                      isSelectionMode={artistSelection.hasSelection}
                      onSelect={(e) => artistSelection.handleSelect(artist.id, e)}
                      showAlbumCount={artistColumnVisibility.albumCount}
                    />
                  )}
                  renderSkeleton={() => <MediaRowSkeleton showIndex />}
                  getItemKey={(artist) => artist.id}
                  estimateItemHeight={56}
                />
              )
            ) : (
              <EmptyState message={debouncedArtistSearch ? "No artists match your search" : "No liked artists yet"} />
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
          onAddToQueue={() => songSelection.addSelectedToQueue("last")}
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
          onAddToQueue={() => handleAddSelectedAlbumsToQueue("last")}
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
          onAddToQueue={() => handleAddSelectedArtistsToQueue("last")}
          onStar={() => handleStarSelectedArtists(true)}
          onUnstar={() => handleStarSelectedArtists(false)}
          onSelectAll={artistSelection.selectAll}
          getSelectedItems={artistSelection.getSelectedItems}
        />
      )}

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
        <Heart className="w-10 h-10 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground">{message}</p>
      <p className="text-sm text-muted-foreground mt-2">
        Start liking songs to build your collection
      </p>
    </div>
  );
}
