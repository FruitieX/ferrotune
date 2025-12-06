"use client";

import { useState, useCallback, useMemo, Suspense } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { 
  Folder, 
  ChevronRight, 
  Home, 
  Music, 
  Play, 
  ListPlus, 
  ListEnd, 
  FolderPlus,
  Check,
  MoreHorizontal,
  Download,
  ArrowUpDown,
  Filter,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { isConnectedAtom } from "@/lib/store/auth";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CoverImage } from "@/components/shared/cover-image";
import { VirtualizedList } from "@/components/shared/virtualized-grid";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { formatDuration, formatBytes } from "@/lib/utils/format";
import type { DirectoryChildPaged } from "@/lib/api/generated/DirectoryChildPaged";
import type { BreadcrumbItem } from "@/lib/api/generated/BreadcrumbItem";
import type { Song } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

type SortField = "name" | "artist" | "album" | "year" | "duration" | "size" | "dateAdded";
type SortDir = "asc" | "desc";

// Convert DirectoryChildPaged to Song for playlist/queue operations
function directoryChildToSong(child: DirectoryChildPaged): Song | null {
  if (child.isDir) return null;
  return {
    id: child.id,
    title: child.title,
    artist: child.artist ?? "Unknown Artist",
    artistId: child.artistId ?? "",
    album: child.album ?? null,
    albumId: child.albumId ?? null,
    duration: child.duration ?? 0,
    track: child.track ?? null,
    discNumber: null,
    year: child.year ?? null,
    genre: child.genre ?? null,
    coverArt: child.coverArt ?? null,
    starred: child.starred ?? null,
    playCount: null,
    created: child.created ?? new Date().toISOString(),
    bitRate: child.bitRate ?? null,
    suffix: child.suffix ?? "",
    size: child.size ?? 0,
    contentType: child.contentType ?? "",
    path: child.path ?? "",
    fullPath: null,
    userRating: child.userRating ?? null,
    type: "music",
    lastPlayed: null,
  };
}

function FilesPageContent() {
  const searchParams = useSearchParams();
  const directoryId = searchParams.get("id") ?? undefined;
  
  const { isReady } = useAuth({ redirectToLogin: true });
  const isConnected = useAtomValue(isConnectedAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  // Filter and sort state
  const [filterText, setFilterText] = useState("");
  const debouncedFilter = useDebounce(filterText, 300);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  // Fetch directory contents with pagination
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["directory-paged", directoryId, sortField, sortDir, debouncedFilter],
    queryFn: async ({ pageParam = 0 }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getDirectoryPaged({
        id: directoryId ?? null,
        count: PAGE_SIZE,
        offset: pageParam,
        sort: sortField,
        sortDir: sortDir,
        filter: debouncedFilter || null,
        foldersOnly: null,
        filesOnly: null,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.children.length, 0);
      return loadedCount < lastPage.total ? loadedCount : undefined;
    },
    initialPageParam: 0,
    enabled: isReady && isConnected,
    staleTime: 60 * 1000,
  });

  // Flatten all pages
  const allItems = useMemo(() => {
    return data?.pages.flatMap(page => page.children) ?? [];
  }, [data]);

  const directoryInfo = data?.pages[0];
  const totalCount = directoryInfo?.total ?? 0;
  const breadcrumbs = directoryInfo?.breadcrumbs ?? [];

  // Get songs for playback and playlist operations
  const songs: Song[] = useMemo(() => {
    return allItems
      .map(directoryChildToSong)
      .filter((s): s is Song => s !== null);
  }, [allItems]);

  // Get selected songs
  const selectedSongs = useMemo(() => {
    return songs.filter(s => selectedIds.has(s.id));
  }, [songs, selectedIds]);

  // Clear selection when directory changes
  const currentDirId = directoryId ?? "root";
  const [lastDirId, setLastDirId] = useState<string>(currentDirId);
  if (currentDirId !== lastDirId) {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setLastDirId(currentDirId);
    setFilterText("");
  }

  // Selection handlers
  const handleSelect = useCallback((id: string, e: React.MouseEvent) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      
      if (e.shiftKey && lastSelectedId) {
        // Range selection
        const items = allItems;
        const startIndex = items.findIndex(item => item.id === lastSelectedId);
        const endIndex = items.findIndex(item => item.id === id);
        
        if (startIndex !== -1 && endIndex !== -1) {
          const [from, to] = startIndex < endIndex 
            ? [startIndex, endIndex] 
            : [endIndex, startIndex];
          
          for (let i = from; i <= to; i++) {
            // Only add songs, not directories
            if (!items[i].isDir) {
              next.add(items[i].id);
            }
          }
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      } else {
        // Single selection
        next.clear();
        next.add(id);
      }
      
      return next;
    });
    setLastSelectedId(id);
  }, [allItems, lastSelectedId]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  const selectAll = useCallback(() => {
    // Only select songs, not directories
    const songIds = songs.map(s => s.id);
    setSelectedIds(new Set(songIds));
  }, [songs]);

  // Playback handlers
  const handlePlayFolder = useCallback(async () => {
    if (songs.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: directoryInfo?.name ?? "Folder",
      songIds: songs.map(s => s.id),
      startIndex: 0,
      shuffle: false,
    });
  }, [songs, directoryInfo, startQueue]);

  const handleShuffleFolder = useCallback(async () => {
    if (songs.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: directoryInfo?.name ?? "Folder",
      songIds: songs.map(s => s.id),
      startIndex: 0,
      shuffle: true,
    });
  }, [songs, directoryInfo, startQueue]);

  const handlePlaySelected = useCallback(() => {
    if (selectedSongs.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: "Selection",
      songIds: selectedSongs.map(s => s.id),
      startIndex: 0,
    });
    clearSelection();
  }, [selectedSongs, startQueue, clearSelection]);

  const handlePlaySong = useCallback((song: Song, index: number) => {
    startQueue({
      sourceType: "other",
      sourceName: directoryInfo?.name ?? "Folder",
      songIds: songs.map(s => s.id),
      startIndex: index,
    });
  }, [songs, directoryInfo, startQueue]);

  const handleAddSongToQueue = useCallback((songId: string, position: "next" | "end") => {
    addToQueue({ songIds: [songId], position });
    toast.success(position === "next" ? "Added to play next" : "Added to queue");
  }, [addToQueue]);

  const handleAddSelectedToQueue = useCallback((position: "next" | "end") => {
    if (selectedSongs.length === 0) return;
    addToQueue({ songIds: selectedSongs.map(s => s.id), position });
    toast.success(`Added ${selectedSongs.length} songs to ${position === "next" ? "play next" : "queue"}`);
  }, [selectedSongs, addToQueue]);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }, [sortField]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="px-4 lg:px-6 pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
            <Folder className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">
              {directoryInfo?.name ?? "Browse Files"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {directoryInfo
                ? `${directoryInfo.folderCount} folders, ${directoryInfo.fileCount} files • ${formatBytes(directoryInfo.totalSize)}`
                : "Browse your music library by folder structure"
              }
            </p>
          </div>
          {directoryInfo && songs.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handlePlayFolder}
              >
                <Play className="w-4 h-4 mr-2" />
                Play All
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleShuffleFolder}>
                    Shuffle All
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    addToQueue({ songIds: songs.map(s => s.id), position: "end" });
                    toast.success(`Added ${songs.length} songs to queue`);
                  }}>
                    <ListEnd className="w-4 h-4 mr-2" />
                    Add All to Queue
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAddToPlaylistOpen(true)}>
                    <FolderPlus className="w-4 h-4 mr-2" />
                    Add All to Playlist
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </motion.div>

        {/* Breadcrumbs */}
        <Breadcrumbs breadcrumbs={breadcrumbs} currentName={directoryInfo?.name ?? "Files"} />

        {/* Filter and Sort Controls */}
        <div className="flex items-center gap-2 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter by name, artist, album..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="pl-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowUpDown className="w-4 h-4 mr-2" />
                Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={sortField === "name"}
                onCheckedChange={() => toggleSort("name")}
              >
                Name {sortField === "name" && (sortDir === "asc" ? "↑" : "↓")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortField === "artist"}
                onCheckedChange={() => toggleSort("artist")}
              >
                Artist {sortField === "artist" && (sortDir === "asc" ? "↑" : "↓")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortField === "album"}
                onCheckedChange={() => toggleSort("album")}
              >
                Album {sortField === "album" && (sortDir === "asc" ? "↑" : "↓")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortField === "year"}
                onCheckedChange={() => toggleSort("year")}
              >
                Year {sortField === "year" && (sortDir === "asc" ? "↑" : "↓")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortField === "duration"}
                onCheckedChange={() => toggleSort("duration")}
              >
                Duration {sortField === "duration" && (sortDir === "asc" ? "↑" : "↓")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortField === "size"}
                onCheckedChange={() => toggleSort("size")}
              >
                Size {sortField === "size" && (sortDir === "asc" ? "↑" : "↓")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortField === "dateAdded"}
                onCheckedChange={() => toggleSort("dateAdded")}
              >
                Date Added {sortField === "dateAdded" && (sortDir === "asc" ? "↑" : "↓")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content */}
      <div className={cn("px-4 lg:px-6 pb-24", selectedIds.size > 0 && "select-none")}>
        {isLoading && allItems.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Folder className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{debouncedFilter ? "No matching items" : "This directory is empty"}</p>
          </div>
        ) : (
          <DirectoryContents
            items={allItems}
            totalCount={totalCount}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onPlaySong={handlePlaySong}
            onAddToQueue={handleAddSongToQueue}
            songs={songs}
            hasNextPage={hasNextPage ?? false}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedSongs.length}
        onClear={clearSelection}
        onPlayNow={handlePlaySelected}
        onPlayNext={() => handleAddSelectedToQueue("next")}
        onAddToQueue={() => handleAddSelectedToQueue("end")}
        onSelectAll={selectAll}
        getSelectedSongs={() => selectedSongs}
      />

      {/* Add to Playlist Dialog */}
      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={songs}
      />
    </div>
  );
}

// Breadcrumbs component
interface BreadcrumbsProps {
  breadcrumbs: BreadcrumbItem[];
  currentName: string;
}

function Breadcrumbs({ breadcrumbs, currentName }: BreadcrumbsProps) {
  if (breadcrumbs.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-1 mt-4 text-sm text-muted-foreground flex-wrap"
    >
      {breadcrumbs.map((crumb, index) => (
        <span key={crumb.id} className="flex items-center gap-1">
          {index > 0 && <ChevronRight className="w-4 h-4 shrink-0" />}
          {index === 0 ? (
            <Link 
              href="/library/files"
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Home className="w-4 h-4" />
              <span>Files</span>
            </Link>
          ) : (
            <Link 
              href={`/library/files?id=${encodeURIComponent(crumb.id)}`}
              className="hover:text-foreground transition-colors truncate max-w-32"
            >
              {crumb.name}
            </Link>
          )}
        </span>
      ))}
      <ChevronRight className="w-4 h-4 shrink-0" />
      <span className="text-foreground truncate">{currentName}</span>
    </motion.div>
  );
}

// Directory contents view
interface DirectoryContentsProps {
  items: DirectoryChildPaged[];
  totalCount: number;
  selectedIds: Set<string>;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onPlaySong: (song: Song, index: number) => void;
  onAddToQueue: (songId: string, position: "next" | "end") => void;
  songs: Song[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

function DirectoryContents({ 
  items, 
  totalCount,
  selectedIds, 
  onSelect, 
  onPlaySong, 
  onAddToQueue, 
  songs,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: DirectoryContentsProps) {
  // Helper to get cover art URL
  const getCoverUrl = (coverArt: string | null | undefined) => {
    if (!coverArt) return undefined;
    const client = getClient();
    return client?.getCoverArtUrl(coverArt, 100);
  };

  return (
    <VirtualizedList
      items={items}
      totalCount={totalCount}
      getItemKey={(item) => item.id}
      estimateItemHeight={72}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={fetchNextPage}
      renderItem={(item) => {
        const isSelected = selectedIds.has(item.id);
        const song = item.isDir ? null : directoryChildToSong(item);
        const songIndex = song ? songs.findIndex(s => s.id === song.id) : -1;

        return item.isDir ? (
          <DirectoryRow
            item={item}
            coverUrl={getCoverUrl(item.coverArt)}
          />
        ) : (
          <FileRow
            item={item}
            song={song!}
            songIndex={songIndex}
            coverUrl={getCoverUrl(item.coverArt)}
            isSelected={isSelected}
            onSelect={onSelect}
            onPlay={() => onPlaySong(song!, songIndex)}
            onAddToQueue={onAddToQueue}
          />
        );
      }}
      renderSkeleton={() => <Skeleton className="h-[72px] w-full rounded-lg" />}
    />
  );
}

// Directory row component
interface DirectoryRowProps {
  item: DirectoryChildPaged;
  coverUrl?: string;
}

function DirectoryRow({ item, coverUrl }: DirectoryRowProps) {
  return (
    <Link href={`/library/files?id=${encodeURIComponent(item.id)}`}>
      <div
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg h-[72px]",
          "hover:bg-muted/50 transition-colors cursor-pointer group"
        )}
      >
        <CoverImage
          src={coverUrl}
          alt={item.title}
          colorSeed={item.title}
          type="album"
          size="md"
          className="rounded"
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate flex items-center gap-2">
            <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
            {item.title}
          </p>
          <p className="text-sm text-muted-foreground truncate">
            {item.childCount != null && `${item.childCount} items`}
            {item.folderSize != null && ` • ${formatBytes(item.folderSize)}`}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

// File row component with selection and context menu
interface FileRowProps {
  item: DirectoryChildPaged;
  song: Song;
  songIndex: number;
  coverUrl?: string;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onPlay: () => void;
  onAddToQueue: (songId: string, position: "next" | "end") => void;
}

function FileRow({ item, song, songIndex, coverUrl, isSelected, onSelect, onPlay, onAddToQueue }: FileRowProps) {
  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onSelect(item.id, e);
    }
  };

  const handleDoubleClick = () => {
    onPlay();
  };

  const handleDownload = () => {
    const client = getClient();
    if (!client) return;
    const downloadUrl = client.getDownloadUrl(item.id);
    window.open(downloadUrl, "_blank");
  };

  const contextMenuContent = (
    <>
      <ContextMenuItem onClick={onPlay}>
        <Play className="w-4 h-4 mr-2" />
        Play
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAddToQueue(item.id, "next")}>
        <ListPlus className="w-4 h-4 mr-2" />
        Play Next
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAddToQueue(item.id, "end")}>
        <ListEnd className="w-4 h-4 mr-2" />
        Add to Queue
      </ContextMenuItem>
      <ContextMenuSeparator />
      {item.albumId && (
        <ContextMenuItem asChild>
          <Link href={`/library/albums/details?id=${item.albumId}`}>
            Go to Album
          </Link>
        </ContextMenuItem>
      )}
      {item.artistId && (
        <ContextMenuItem asChild>
          <Link href={`/library/artists/details?id=${item.artistId}`}>
            Go to Artist
          </Link>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleDownload}>
        <Download className="w-4 h-4 mr-2" />
        Download
      </ContextMenuItem>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg h-[72px]",
            "hover:bg-muted/50 transition-colors cursor-pointer group",
            isSelected && "bg-primary/10 hover:bg-primary/15"
          )}
        >
          {/* Selection checkbox */}
          <div
            className={cn(
              "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all cursor-pointer",
              isSelected
                ? "bg-primary border-primary text-primary-foreground"
                : "border-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:border-primary/50"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id, e);
            }}
          >
            {isSelected && <Check className="w-3 h-3" />}
          </div>

          <CoverImage
            src={coverUrl}
            alt={item.title}
            colorSeed={item.title}
            type="song"
            size="md"
            className="rounded"
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate flex items-center gap-2">
              <Music className="w-4 h-4 text-muted-foreground shrink-0" />
              {item.title}
            </p>
            <p className="text-sm text-muted-foreground truncate">
              {[item.artist, item.album].filter(Boolean).join(" • ")}
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
            {item.size != null && (
              <span className="hidden md:inline w-16 text-right">{formatBytes(item.size)}</span>
            )}
            {item.duration != null && (
              <span className="w-12 text-right">{formatDuration(item.duration)}</span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onPlay}>
                  <Play className="w-4 h-4 mr-2" />
                  Play
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAddToQueue(item.id, "next")}>
                  <ListPlus className="w-4 h-4 mr-2" />
                  Play Next
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAddToQueue(item.id, "end")}>
                  <ListEnd className="w-4 h-4 mr-2" />
                  Add to Queue
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {item.albumId && (
                  <DropdownMenuItem asChild>
                    <Link href={`/library/albums/details?id=${item.albumId}`}>
                      Go to Album
                    </Link>
                  </DropdownMenuItem>
                )}
                {item.artistId && (
                  <DropdownMenuItem asChild>
                    <Link href={`/library/artists/details?id=${item.artistId}`}>
                      Go to Artist
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleDownload}>
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {contextMenuContent}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function FilesPage() {
  return (
    <Suspense fallback={
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    }>
      <FilesPageContent />
    </Suspense>
  );
}
