"use client";

import { useState, useCallback, useMemo, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useAuth } from "@/lib/hooks/use-auth";
import { isConnectedAtom } from "@/lib/store/auth";
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import type { DirectoryChild, DirectoryArtist, Song } from "@/lib/api/types";
import { cn } from "@/lib/utils";

// Convert DirectoryChild to Song for playlist/queue operations
function directoryChildToSong(child: DirectoryChild): Song | null {
  if (child.isDir) return null;
  return {
    id: child.id,
    title: child.title,
    artist: child.artist ?? "Unknown Artist",
    artistId: "", // Not available in DirectoryChild
    album: child.album ?? null,
    albumId: child.parent ?? null,
    duration: child.duration ?? 0,
    track: child.track ?? null,
    discNumber: null, // Not available in DirectoryChild
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
    fullPath: null, // Not available in DirectoryChild
    userRating: child.userRating ?? null,
    type: "music",
    lastPlayed: null,
  };
}

function FilesPageContent() {
  const searchParams = useSearchParams();
  const directoryId = searchParams.get("id");
  
  const { isReady } = useAuth({ redirectToLogin: true });
  const isConnected = useAtomValue(isConnectedAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  // Fetch indexes (top-level artist listing) when no directory is selected
  const { data: indexes, isLoading: indexesLoading } = useQuery({
    queryKey: ["indexes"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getIndexes();
    },
    enabled: isReady && isConnected && !directoryId,
    staleTime: 60 * 1000,
  });

  // Fetch directory contents when a directory is selected
  const { data: directory, isLoading: directoryLoading } = useQuery({
    queryKey: ["directory", directoryId],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getMusicDirectory(directoryId!);
    },
    enabled: isReady && isConnected && !!directoryId,
    staleTime: 60 * 1000,
  });

  const isLoading = indexesLoading || directoryLoading;

  // Get all items for selection
  const allItems: DirectoryChild[] = useMemo(() => {
    return directory?.directory?.child ?? [];
  }, [directory]);

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
      sourceName: directory?.directory?.name ?? "Folder",
      songIds: songs.map(s => s.id),
      startIndex: 0,
      shuffle: false,
    });
  }, [songs, directory, startQueue]);

  const handleShuffleFolder = useCallback(async () => {
    if (songs.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: directory?.directory?.name ?? "Folder",
      songIds: songs.map(s => s.id),
      startIndex: 0,
      shuffle: true,
    });
  }, [songs, directory, startQueue]);

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
      sourceName: directory?.directory?.name ?? "Folder",
      songIds: songs.map(s => s.id),
      startIndex: index,
    });
  }, [songs, directory, startQueue]);

  const handleAddSongToQueue = useCallback((songId: string, position: "next" | "end") => {
    addToQueue({ songIds: [songId], position });
    toast.success(position === "next" ? "Added to play next" : "Added to queue");
  }, [addToQueue]);

  const handleAddSelectedToQueue = useCallback((position: "next" | "end") => {
    if (selectedSongs.length === 0) return;
    addToQueue({ songIds: selectedSongs.map(s => s.id), position });
    toast.success(`Added ${selectedSongs.length} songs to ${position === "next" ? "play next" : "queue"}`);
  }, [selectedSongs, addToQueue]);

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
              {directoryId && directory ? directory.directory.name : "Browse Files"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {directoryId 
                ? `${allItems.filter(i => i.isDir).length} folders, ${songs.length} songs`
                : "Browse your music library by folder structure"
              }
            </p>
          </div>
          {directoryId && songs.length > 0 && (
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
        <Breadcrumbs directory={directory?.directory} />
      </div>

      {/* Content */}
      <div className={cn("px-4 lg:px-6 pb-24", selectedIds.size > 0 && "select-none")}>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : directoryId && directory ? (
          // Directory contents view
          <DirectoryContents 
            items={allItems}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onPlaySong={handlePlaySong}
            onAddToQueue={handleAddSongToQueue}
            songs={songs}
          />
        ) : indexes ? (
          // Indexes view (top-level artist listing)
          <IndexesView indexes={indexes} />
        ) : null}
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
  directory?: {
    id: string;
    name: string;
    parent?: string | null;
  };
}

function Breadcrumbs({ directory }: BreadcrumbsProps) {
  if (!directory) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-1 mt-4 text-sm text-muted-foreground flex-wrap"
    >
      <Link 
        href="/library/files" 
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        <Home className="w-4 h-4" />
        <span>Files</span>
      </Link>
      {directory.parent && (
        <>
          <ChevronRight className="w-4 h-4 shrink-0" />
          <Link 
            href={`/library/files?id=${encodeURIComponent(directory.parent)}`}
            className="hover:text-foreground transition-colors truncate max-w-32"
          >
            ...
          </Link>
        </>
      )}
      <ChevronRight className="w-4 h-4 shrink-0" />
      <span className="text-foreground truncate">{directory.name}</span>
    </motion.div>
  );
}

// Indexes view showing artists grouped by letter
function IndexesView({ indexes }: { indexes: { indexes: { index: Array<{ name: string; artist: DirectoryArtist[] }> } } }) {
  const allArtists = useMemo(() => {
    return indexes.indexes.index.flatMap(group => 
      group.artist.map(artist => ({ ...artist, indexName: group.name }))
    );
  }, [indexes]);

  return (
    <VirtualizedList
      items={allArtists}
      getItemKey={(artist) => artist.id}
      estimateItemHeight={64}
      renderItem={(artist) => (
        <Link
          href={`/library/files?id=${encodeURIComponent(artist.id)}`}
        >
          <div
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg h-16",
              "hover:bg-muted/50 transition-colors cursor-pointer group"
            )}
          >
            <CoverImage
              src={null}
              alt={artist.name}
              colorSeed={artist.name}
              type="artist"
              size="sm"
              className="rounded"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{artist.name}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>
      )}
      renderSkeleton={() => <Skeleton className="h-16 w-full rounded-lg" />}
    />
  );
}

// Directory contents view
interface DirectoryContentsProps {
  items: DirectoryChild[];
  selectedIds: Set<string>;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onPlaySong: (song: Song, index: number) => void;
  onAddToQueue: (songId: string, position: "next" | "end") => void;
  songs: Song[];
}

function DirectoryContents({ items, selectedIds, onSelect, onPlaySong, onAddToQueue, songs }: DirectoryContentsProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Folder className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>This directory is empty</p>
      </div>
    );
  }

  // Helper to get cover art URL
  const getCoverUrl = (coverArt: string | null | undefined) => {
    if (!coverArt) return undefined;
    const client = getClient();
    return client?.getCoverArtUrl(coverArt, 100);
  };

  return (
    <VirtualizedList
      items={items}
      getItemKey={(item) => item.id}
      estimateItemHeight={72}
      renderItem={(item, index) => {
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
  item: DirectoryChild;
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
          {item.artist && (
            <p className="text-sm text-muted-foreground truncate">{item.artist}</p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

// File row component with selection and context menu
interface FileRowProps {
  item: DirectoryChild;
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
      {item.album && (
        <ContextMenuItem asChild>
          <Link href={`/library/albums/details?id=${item.parent}`}>
            Go to Album
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
            {item.size && (
              <span className="hidden md:inline w-16 text-right">{formatBytes(item.size)}</span>
            )}
            {item.duration && (
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
                {item.album && item.parent && (
                  <DropdownMenuItem asChild>
                    <Link href={`/library/albums/details?id=${item.parent}`}>
                      Go to Album
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
