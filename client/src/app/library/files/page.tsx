"use client";

import { useState, Suspense } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
  Library,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useAuth } from "@/lib/hooks/use-auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { isConnectedAtom } from "@/lib/store/auth";
import {
  libraryFilterAtom,
  filesSortAtom,
  filesColumnVisibilityAtom,
} from "@/lib/store/ui";
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
import { FilesListHeader } from "@/components/shared/song-list-header";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { formatDuration, formatBytes } from "@/lib/utils/format";
import type { DirectoryChildPaged } from "@/lib/api/generated/DirectoryChildPaged";
import type { BreadcrumbItem } from "@/lib/api/generated/BreadcrumbItem";
import type { LibraryInfo } from "@/lib/api/generated/LibraryInfo";
import type { Song } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

// Convert DirectoryChildPaged to Song for playlist/queue operations
function directoryChildToSong(child: DirectoryChildPaged): Song | null {
  if (child.isDir) return null;
  return {
    id: child.id,
    parent: child.parent ?? null,
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
    coverArtData: child.coverArtData ?? null, // Use inline thumbnail from API
    coverArtWidth: null,
    coverArtHeight: null,
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
  // New URL structure: ?libraryId=X&path=relative/path
  const libraryIdParam = searchParams.get("libraryId");
  const pathParam = searchParams.get("path") ?? "";
  const libraryId = libraryIdParam ? Number(libraryIdParam) : null;

  const { isReady } = useAuth({ redirectToLogin: true });
  const isConnected = useAtomValue(isConnectedAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  // Use shared atoms from layout header
  const libraryFilter = useAtomValue(libraryFilterAtom);
  const debouncedFilter = useDebounce(libraryFilter, 300);
  const sortConfig = useAtomValue(filesSortAtom);
  const visibleColumns = useAtomValue(filesColumnVisibilityAtom);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  // Fetch accessible libraries for root view
  const { data: librariesData, isLoading: librariesLoading } = useQuery({
    queryKey: ["libraries"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getLibraries();
    },
    enabled: isReady && isConnected && libraryId === null,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch directory contents with pagination (only when libraryId is provided)
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: [
        "directory-paged",
        libraryId,
        pathParam,
        sortConfig.field,
        sortConfig.direction,
        debouncedFilter,
      ],
      queryFn: async ({ pageParam = 0 }) => {
        const client = getClient();
        if (!client) throw new Error("Not connected");
        return client.getDirectoryPaged({
          libraryId: libraryId!,
          path: pathParam || null,
          count: PAGE_SIZE,
          offset: pageParam,
          sort: sortConfig.field,
          sortDir: sortConfig.direction,
          filter: debouncedFilter || null,
          foldersOnly: null,
          filesOnly: null,
          inlineImages: "small",
        });
      },
      getNextPageParam: (lastPage, allPages) => {
        const loadedCount = allPages.reduce(
          (sum, page) => sum + page.children.length,
          0,
        );
        return loadedCount < lastPage.total ? loadedCount : undefined;
      },
      initialPageParam: 0,
      enabled: isReady && isConnected && libraryId !== null,
      staleTime: 60 * 1000,
    });

  // Flatten all pages
  const allItems = data?.pages.flatMap((page) => page.children) ?? [];

  const directoryInfo = data?.pages[0];
  const totalCount = directoryInfo?.total ?? 0;
  const breadcrumbs = directoryInfo?.breadcrumbs ?? [];

  // Get songs for playback and playlist operations
  const songs: Song[] = allItems
    .map(directoryChildToSong)
    .filter((s): s is Song => s !== null);

  // Get selected songs (files only)
  const selectedSongs = songs.filter((s) => selectedIds.has(s.id));

  // Get selected directories
  const selectedDirectories = allItems.filter(
    (item) => item.isDir && selectedIds.has(item.id),
  );

  // Total selected count (files + directories)
  const totalSelectedCount = selectedSongs.length + selectedDirectories.length;

  // Build selection label based on what's selected
  const getSelectionLabel = () => {
    const songCount = selectedSongs.length;
    const dirCount = selectedDirectories.length;

    if (songCount > 0 && dirCount > 0) {
      const songLabel = songCount === 1 ? "song" : "songs";
      const dirLabel = dirCount === 1 ? "directory" : "directories";
      return `${songCount} ${songLabel}, ${dirCount} ${dirLabel}`;
    } else if (dirCount > 0) {
      return `${dirCount} ${dirCount === 1 ? "directory" : "directories"}`;
    } else {
      return `${songCount} ${songCount === 1 ? "song" : "songs"}`;
    }
  };

  // Clear selection when library or path changes
  const currentKey = `${libraryId ?? "root"}-${pathParam}`;
  const [lastKey, setLastKey] = useState<string>(currentKey);
  if (currentKey !== lastKey) {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setLastKey(currentKey);
  }

  // Selection handlers - supports both files and directories
  const handleSelect = (
    id: string,
    e: React.MouseEvent,
    isCheckbox = false,
  ) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (e.shiftKey && lastSelectedId) {
        // Range selection
        const items = allItems;
        const startIndex = items.findIndex(
          (item) => item.id === lastSelectedId,
        );
        const endIndex = items.findIndex((item) => item.id === id);

        if (startIndex !== -1 && endIndex !== -1) {
          const [from, to] =
            startIndex < endIndex
              ? [startIndex, endIndex]
              : [endIndex, startIndex];

          for (let i = from; i <= to; i++) {
            // Select both files and directories
            next.add(items[i].id);
          }
        }
      } else if (isCheckbox || e.ctrlKey || e.metaKey) {
        // Toggle selection (always toggle for checkbox clicks)
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
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  };

  const selectAll = () => {
    // Select all items (both files and directories)
    const allIds = allItems.map((item) => item.id);
    setSelectedIds(new Set(allIds));
  };

  // Playback handlers
  const handlePlayFolder = async () => {
    if (!libraryId) return;
    const relativePath = pathParam;
    startQueue({
      sourceType: "directory",
      sourceId: `${libraryId}:${relativePath}`,
      sourceName: directoryInfo?.name ?? "Folder",
      startIndex: 0,
      shuffle: false,
    });
  };

  const handleShuffleFolder = async () => {
    if (!libraryId) return;
    const relativePath = pathParam;
    startQueue({
      sourceType: "directory",
      sourceId: `${libraryId}:${relativePath}`,
      sourceName: directoryInfo?.name ?? "Folder",
      startIndex: 0,
      shuffle: true,
    });
  };

  const handlePlaySelected = () => {
    if (selectedSongs.length === 0) return;
    startQueue({
      sourceType: "other",
      sourceName: "Selection",
      songIds: selectedSongs.map((s) => s.id),
      startIndex: 0,
    });
    clearSelection();
  };

  const handlePlaySong = (song: Song, index: number) => {
    if (!libraryId) return;
    const relativePath = pathParam;
    // Use directoryFlat - only plays files in current directory, not subfolders
    // Pass sort and filter so the server materializes the queue in the same order
    startQueue({
      sourceType: "directoryFlat",
      sourceId: `${libraryId}:${relativePath}`,
      sourceName: directoryInfo?.name ?? "Folder",
      startIndex: index,
      startSongId: song.id,
      sort: { field: sortConfig.field, direction: sortConfig.direction },
      filters: debouncedFilter ? { filter: debouncedFilter } : undefined,
    });
  };

  const handleAddSongToQueue = async (
    songId: string,
    position: "next" | "end",
  ) => {
    const result = await addToQueue({ songIds: [songId], position });
    if (result.success) {
      toast.success(
        position === "next" ? "Added to play next" : "Added to queue",
      );
    } else {
      toast.error("Start playback first to add to queue");
    }
  };

  const handleAddSelectedToQueue = async (position: "next" | "end") => {
    if (selectedSongs.length === 0) return;
    const result = await addToQueue({
      songIds: selectedSongs.map((s) => s.id),
      position,
    });
    if (result.success) {
      toast.success(
        `Added ${result.addedCount} song${result.addedCount === 1 ? "" : "s"} to ${position === "next" ? "play next" : "queue"}`,
      );
    } else {
      toast.error("Start playback first to add to queue");
    }
  };

  // Directory playback handlers - use server-side queue materialization
  const handlePlayDirectory = (dirPath: string) => {
    if (!libraryId) return;
    // Find the directory name from items
    const dir = allItems.find((item) => item.path === dirPath);
    startQueue({
      sourceType: "directory",
      sourceId: `${libraryId}:${dirPath}`,
      sourceName: dir?.title ?? "Folder",
    });
  };

  const handleAddDirectoryToQueue = async (
    dirPath: string,
    position: "next" | "end",
  ) => {
    if (!libraryId) return;
    const result = await addToQueue({
      sourceType: "directory",
      sourceId: `${libraryId}:${dirPath}`,
      position,
    });
    if (result.success) {
      if (result.addedCount === 0) {
        toast.info("No songs found in folder");
      } else {
        toast.success(
          position === "next"
            ? `Added ${result.addedCount} song${result.addedCount === 1 ? "" : "s"} to play next`
            : `Added ${result.addedCount} song${result.addedCount === 1 ? "" : "s"} to queue`,
        );
      }
    } else {
      toast.error("Start playback first to add to queue");
    }
  };

  // Client-side filter libraries by the shared filter input (for library selection view)
  const filteredLibraries =
    librariesData?.libraries?.filter((lib) => {
      if (!debouncedFilter) return true;
      const lowerFilter = debouncedFilter.toLowerCase();
      return lib.name.toLowerCase().includes(lowerFilter);
    }) ?? [];

  // Calculate combined stats for all libraries (for root view header)
  const combinedLibraryStats = librariesData?.libraries?.reduce(
    (acc, lib) => ({
      libraryCount: acc.libraryCount + 1,
      songCount: acc.songCount + lib.songCount,
      totalSize: acc.totalSize + lib.totalSize,
    }),
    { libraryCount: 0, songCount: 0, totalSize: 0 },
  ) ?? { libraryCount: 0, songCount: 0, totalSize: 0 };

  // Show library selection if no library is selected
  if (libraryId === null) {
    return (
      <div className="min-h-dvh">
        {/* Header */}
        <div className="px-4 lg:px-6 pt-4 pb-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3"
          >
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
              <Library className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">Browse Files</h1>
              <p className="text-sm text-muted-foreground">
                {librariesLoading
                  ? "Loading libraries..."
                  : `${combinedLibraryStats.libraryCount} ${combinedLibraryStats.libraryCount === 1 ? "library" : "libraries"}, ${combinedLibraryStats.songCount} songs • ${formatBytes(combinedLibraryStats.totalSize)}`}
              </p>
            </div>
          </motion.div>
        </div>

        <div className="px-4 lg:px-6 pb-24">
          {librariesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[56px] w-full rounded-lg" />
              ))}
            </div>
          ) : filteredLibraries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Library className="w-12 h-12 mx-auto mb-4 opacity-50" />
              {debouncedFilter ? (
                <p>No libraries match &quot;{debouncedFilter}&quot;</p>
              ) : (
                <p>No music libraries available</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLibraries.map((library) => (
                <LibraryCard key={library.id} library={library} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {/* Directory Info Header */}
      <div className="px-4 lg:px-6 pt-4 pb-4">
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
              {directoryInfo?.name ??
                directoryInfo?.libraryName ??
                "Browse Files"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {directoryInfo
                ? `${directoryInfo.folderCount} folders, ${directoryInfo.fileCount} files • ${formatBytes(directoryInfo.totalSize)}`
                : "Browse your music library by folder structure"}
            </p>
          </div>
          {directoryInfo && songs.length > 0 && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handlePlayFolder}>
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
                  <DropdownMenuItem
                    onClick={() => {
                      addToQueue({
                        songIds: songs.map((s) => s.id),
                        position: "end",
                      });
                      toast.success(`Added ${songs.length} songs to queue`);
                    }}
                  >
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
        <Breadcrumbs
          breadcrumbs={breadcrumbs}
          currentName={
            directoryInfo?.name ?? directoryInfo?.libraryName ?? "Files"
          }
          libraryId={libraryId}
          libraryName={directoryInfo?.libraryName ?? "Library"}
        />
      </div>

      {/* Content */}
      <div
        className={cn(
          "px-4 lg:px-6 pb-24",
          selectedIds.size > 0 && "select-none",
        )}
      >
        {isLoading && allItems.length === 0 ? (
          <div className="space-y-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <FileRowSkeleton key={i} />
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Folder className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>
              {debouncedFilter
                ? "No matching items"
                : "This directory is empty"}
            </p>
          </div>
        ) : (
          <DirectoryContents
            items={allItems}
            totalCount={totalCount}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onPlaySong={handlePlaySong}
            onAddToQueue={handleAddSongToQueue}
            onPlayDirectory={handlePlayDirectory}
            onAddDirectoryToQueue={handleAddDirectoryToQueue}
            songs={songs}
            hasNextPage={hasNextPage ?? false}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            visibleColumns={visibleColumns}
            libraryId={libraryId}
          />
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={totalSelectedCount}
        customLabel={getSelectionLabel()}
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
  libraryId: number;
  libraryName: string;
}

function Breadcrumbs({
  breadcrumbs,
  currentName,
  libraryId,
  libraryName,
}: BreadcrumbsProps) {
  // Filter out the last breadcrumb if we have breadcrumbs, as the current directory
  // is displayed separately with currentName at the end (fixes duplicate bug)
  const displayBreadcrumbs =
    breadcrumbs.length > 0 ? breadcrumbs.slice(0, -1) : breadcrumbs;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-1 mt-4 text-sm text-muted-foreground flex-wrap"
    >
      {/* Files root */}
      <Link
        href="/library/files"
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        <Home className="w-4 h-4" />
        <span>Files</span>
      </Link>
      <ChevronRight className="w-4 h-4 shrink-0" />

      {/* Library name as link to library root */}
      {breadcrumbs.length > 0 ? (
        <>
          <Link
            href={`/library/files?libraryId=${libraryId}`}
            className="hover:text-foreground transition-colors truncate max-w-32"
          >
            {libraryName}
          </Link>
          {displayBreadcrumbs.map((crumb) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="w-4 h-4 shrink-0" />
              <Link
                href={`/library/files?libraryId=${libraryId}&path=${encodeURIComponent(crumb.id)}`}
                className="hover:text-foreground transition-colors truncate max-w-32"
              >
                {crumb.name}
              </Link>
            </span>
          ))}
          <ChevronRight className="w-4 h-4 shrink-0" />
          <span className="text-foreground truncate">{currentName}</span>
        </>
      ) : (
        // At library root, show library name as current (not a link)
        <span className="text-foreground truncate">{libraryName}</span>
      )}
    </motion.div>
  );
}

// Library card for library selection view
interface LibraryCardProps {
  library: LibraryInfo;
}

function LibraryCard({ library }: LibraryCardProps) {
  return (
    <Link href={`/library/files?libraryId=${library.id}`} prefetch={false}>
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg h-[56px]",
          "hover:bg-muted/50 transition-colors cursor-pointer group",
        )}
      >
        {/* Library icon */}
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Library className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{library.name}</p>
          <p className="text-sm text-muted-foreground">
            {library.songCount} songs • {formatBytes(library.totalSize)}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

// Directory contents view
interface VisibleColumns {
  size: boolean;
  duration: boolean;
  artist: boolean;
  album: boolean;
}

interface DirectoryContentsProps {
  items: DirectoryChildPaged[];
  totalCount: number;
  selectedIds: Set<string>;
  onSelect: (id: string, e: React.MouseEvent, isCheckbox?: boolean) => void;
  onPlaySong: (song: Song, index: number) => void;
  onAddToQueue: (songId: string, position: "next" | "end") => void;
  onPlayDirectory: (dirPath: string) => void;
  onAddDirectoryToQueue: (dirPath: string, position: "next" | "end") => void;
  songs: Song[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  visibleColumns: VisibleColumns;
  libraryId: number;
}

function DirectoryContents({
  items,
  totalCount,
  selectedIds,
  onSelect,
  onPlaySong,
  onAddToQueue,
  onPlayDirectory,
  onAddDirectoryToQueue,
  songs,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  visibleColumns,
  libraryId,
}: DirectoryContentsProps) {
  // Helper to get cover art URL - only used when no inline data
  const getCoverUrl = (
    coverArt: string | null | undefined,
    coverArtData: string | null | undefined,
  ) => {
    if (coverArtData || !coverArt) return undefined;
    const client = getClient();
    return client?.getCoverArtUrl(coverArt, 100);
  };

  return (
    <>
      <FilesListHeader columnVisibility={visibleColumns} />
      <VirtualizedList
        items={items}
        totalCount={totalCount}
        getItemKey={(item) => item.id}
        estimateItemHeight={56}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        renderItem={(item) => {
          const isSelected = selectedIds.has(item.id);
          const song = item.isDir ? null : directoryChildToSong(item);
          const songIndex = song
            ? songs.findIndex((s) => s.id === song.id)
            : -1;

          return item.isDir ? (
            <DirectoryRow
              item={item}
              coverUrl={getCoverUrl(item.coverArt, item.coverArtData)}
              coverArtData={item.coverArtData}
              isSelected={isSelected}
              onSelect={onSelect}
              onPlay={() => onPlayDirectory(item.path ?? "")}
              onAddToQueue={(position) =>
                onAddDirectoryToQueue(item.path ?? "", position)
              }
              visibleColumns={visibleColumns}
              libraryId={libraryId}
            />
          ) : (
            <FileRow
              item={item}
              coverUrl={getCoverUrl(item.coverArt, item.coverArtData)}
              coverArtData={item.coverArtData}
              isSelected={isSelected}
              onSelect={onSelect}
              onPlay={() => onPlaySong(song!, songIndex)}
              onAddToQueue={onAddToQueue}
              visibleColumns={visibleColumns}
            />
          );
        }}
        renderSkeleton={() => <FileRowSkeleton />}
      />
    </>
  );
}

// Directory row component with selection and context menu
interface DirectoryRowProps {
  item: DirectoryChildPaged;
  coverUrl?: string;
  coverArtData?: string | null;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent, isCheckbox?: boolean) => void;
  onPlay: () => void;
  onAddToQueue: (position: "next" | "end") => void;
  visibleColumns: VisibleColumns;
  libraryId: number;
}

function DirectoryRow({
  item,
  coverUrl,
  coverArtData,
  isSelected,
  onSelect,
  onPlay,
  onAddToQueue,
  visibleColumns,
  libraryId,
}: DirectoryRowProps) {
  // Build the URL for navigating into this directory
  const dirUrl = item.path
    ? `/library/files?libraryId=${libraryId}&path=${encodeURIComponent(item.path)}`
    : `/library/files?libraryId=${libraryId}`;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onSelect(item.id, e);
    }
  };

  const contextMenuContent = (
    <>
      <ContextMenuItem
        onClick={(e) => {
          e.preventDefault();
          onPlay();
        }}
      >
        <Play className="w-4 h-4 mr-2" />
        Play
      </ContextMenuItem>
      <ContextMenuItem
        onClick={(e) => {
          e.preventDefault();
          onAddToQueue("next");
        }}
      >
        <ListPlus className="w-4 h-4 mr-2" />
        Play Next
      </ContextMenuItem>
      <ContextMenuItem
        onClick={(e) => {
          e.preventDefault();
          onAddToQueue("end");
        }}
      >
        <ListEnd className="w-4 h-4 mr-2" />
        Add to Queue
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem asChild>
        <Link href={dirUrl} prefetch={false}>
          <FolderPlus className="w-4 h-4 mr-2" />
          Open Folder
        </Link>
      </ContextMenuItem>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link href={dirUrl} onClick={handleClick} prefetch={false}>
          <div
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg h-[56px]",
              "hover:bg-muted/50 transition-colors cursor-pointer group",
              isSelected && "bg-primary/10 hover:bg-primary/15",
            )}
          >
            {/* Selection checkbox */}
            <div
              className={cn(
                "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all cursor-pointer",
                isSelected
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:border-primary/50",
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(item.id, e, true);
              }}
            >
              {isSelected && <Check className="w-3 h-3" />}
            </div>
            {/* Cover art with play button overlay */}
            <div className="group/cover relative shrink-0">
              <CoverImage
                src={coverUrl}
                inlineData={coverArtData}
                alt={item.title}
                colorSeed={item.title}
                type="folder"
                size="sm"
                className="rounded"
              />
              <button
                type="button"
                aria-label="Play folder"
                className={cn(
                  "absolute inset-0 flex items-center justify-center rounded",
                  "bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity",
                  "cursor-pointer",
                )}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPlay();
                }}
              >
                <Play className="w-5 h-5 ml-0.5 text-white" />
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate flex items-center gap-2">
                <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                {item.title}
              </p>
            </div>
            {/* Right-aligned columns for item count and size */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
              {visibleColumns.size && item.folderSize != null && (
                <span className="hidden md:inline w-16 text-right">
                  {formatBytes(item.folderSize)}
                </span>
              )}
              {visibleColumns.duration && item.childCount != null && (
                <span className="w-12 text-right">{item.childCount} items</span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      onPlay();
                    }}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Play
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      onAddToQueue("next");
                    }}
                  >
                    <ListPlus className="w-4 h-4 mr-2" />
                    Play Next
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      onAddToQueue("end");
                    }}
                  >
                    <ListEnd className="w-4 h-4 mr-2" />
                    Add to Queue
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={dirUrl} prefetch={false}>
                      <FolderPlus className="w-4 h-4 mr-2" />
                      Open Folder
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {contextMenuContent}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// File row component with selection and context menu
interface FileRowProps {
  item: DirectoryChildPaged;
  coverUrl?: string;
  coverArtData?: string | null;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent, isCheckbox?: boolean) => void;
  onPlay: () => void;
  onAddToQueue: (songId: string, position: "next" | "end") => void;
  visibleColumns: VisibleColumns;
}

function FileRow({
  item,
  coverUrl,
  coverArtData,
  isSelected,
  onSelect,
  onPlay,
  onAddToQueue,
  visibleColumns,
}: FileRowProps) {
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
            "flex items-center gap-3 px-3 py-2 rounded-lg h-[56px]",
            "hover:bg-muted/50 transition-colors cursor-pointer group",
            isSelected && "bg-primary/10 hover:bg-primary/15",
          )}
        >
          {/* Selection checkbox */}
          <div
            className={cn(
              "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all cursor-pointer",
              isSelected
                ? "bg-primary border-primary text-primary-foreground"
                : "border-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:border-primary/50",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id, e, true); // isCheckbox = true for toggle behavior
            }}
          >
            {isSelected && <Check className="w-3 h-3" />}
          </div>

          {/* Cover art with play button overlay */}
          <div className="group/cover relative shrink-0">
            <CoverImage
              src={coverUrl}
              inlineData={coverArtData}
              alt={item.title}
              colorSeed={item.title}
              type="song"
              size="sm"
              className="rounded"
            />
            <button
              type="button"
              aria-label="Play"
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded",
                "bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity",
                "cursor-pointer",
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPlay();
              }}
            >
              <Play className="w-5 h-5 ml-0.5 text-white" />
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate flex items-center gap-2">
              <Music className="w-4 h-4 text-muted-foreground shrink-0" />
              {item.title}
            </p>
            {(visibleColumns.artist || visibleColumns.album) && (
              <p className="text-sm text-muted-foreground truncate">
                {[
                  visibleColumns.artist && item.artist,
                  visibleColumns.album && item.album,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
            {visibleColumns.size && item.size != null && (
              <span className="hidden md:inline w-16 text-right">
                {formatBytes(item.size)}
              </span>
            )}
            {visibleColumns.duration && item.duration != null && (
              <span className="w-12 text-right">
                {formatDuration(item.duration)}
              </span>
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

// Skeleton for directory/file rows - matches actual row structure
function FileRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 h-[56px]">
      {/* Checkbox placeholder - same size as actual checkbox */}
      <div className="w-5 h-5 shrink-0 rounded bg-muted/30" />
      {/* Cover art skeleton - matches CoverImage size="sm" (40px) */}
      <Skeleton className="w-10 h-10 rounded shrink-0" />
      {/* Text content - two lines like actual content */}
      <div className="flex-1 min-w-0 space-y-1">
        <Skeleton className="h-4 w-[45%] max-w-[180px]" />
        <Skeleton className="h-3 w-[30%] max-w-[120px]" />
      </div>
      {/* Right side columns - duration/size */}
      <div className="flex items-center gap-4 shrink-0">
        <Skeleton className="h-3.5 w-10 hidden md:block" />
        <Skeleton className="h-3.5 w-8" />
      </div>
    </div>
  );
}

export default function FilesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 lg:p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <FileRowSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <FilesPageContent />
    </Suspense>
  );
}
