"use client";

import { useState, useMemo, useCallback, useRef, Suspense } from "react";
import { useAtom, useSetAtom } from "jotai";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Plus,
  ListMusic,
  Upload,
  Clock,
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  Home,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { usePlaylistSelection } from "@/lib/hooks/use-playlist-selection";
import { startQueueAtom } from "@/lib/store/server-queue";
import {
  playlistsViewModeAtom,
  playlistsSortAtom,
  playlistsColumnVisibilityAtom,
} from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { PlaylistsListToolbar } from "@/components/shared/playlists-list-toolbar";
import {
  VirtualizedGrid,
  VirtualizedList,
} from "@/components/shared/virtualized-grid";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import { MediaRow, MediaRowSkeleton } from "@/components/shared/media-row";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { CreatePlaylistDialog } from "@/components/playlists/create-playlist-dialog";
import { ImportPlaylistDialog } from "@/components/playlists/import-playlist-dialog";
import {
  PlaylistContextMenu,
  PlaylistDropdownMenu,
} from "@/components/playlists/playlist-context-menu";
import {
  FolderContextMenu,
  FolderDropdownMenu,
} from "@/components/playlists/folder-context-menu";
import {
  formatDuration,
  formatCount,
  formatDate,
  formatTotalDuration,
} from "@/lib/utils/format";
import { filterPlaylists, sortPlaylists } from "@/lib/utils/sort-playlists";
import {
  organizePlaylistsIntoFolders,
  getPlaylistDisplayName,
  type PlaylistFolder,
} from "@/lib/utils/playlist-folders";
import { cn } from "@/lib/utils";
import type { Playlist } from "@/lib/api/types";

function PlaylistsPageContent() {
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [createInFolderPath, setCreateInFolderPath] = useState<string>("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [activeDragPlaylist, setActiveDragPlaylist] = useState<Playlist | null>(
    null,
  );

  // Current folder path from URL
  const currentPath = searchParams.get("folder") || "";
  const pathParts = currentPath ? currentPath.split("/") : [];

  // Filter and view settings
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 300);
  const [viewMode, setViewMode] = useAtom(playlistsViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(playlistsSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(
    playlistsColumnVisibilityAtom,
  );

  // Queue management for play button
  const startQueue = useSetAtom(startQueueAtom);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  // Restore scroll position when navigating back to this page
  useScrollRestoration();

  // Fetch playlists
  const { data: playlists, isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
    enabled: isReady,
  });

  // Mutation to move playlist to a folder
  const movePlaylistMutation = useMutation({
    mutationFn: async ({
      playlist,
      targetFolderPath,
    }: {
      playlist: Playlist;
      targetFolderPath: string;
    }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Get just the playlist name without any folder prefix
      const displayName = getPlaylistDisplayName(playlist);

      // Build new name with folder path
      const newName = targetFolderPath
        ? `${targetFolderPath}/${displayName}`
        : displayName;

      await client.updatePlaylist({ playlistId: playlist.id, name: newName });
      return { playlist, newName, targetFolderPath };
    },
    onSuccess: ({ playlist, targetFolderPath }) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      const displayName = getPlaylistDisplayName(playlist);
      if (targetFolderPath) {
        toast.success(`Moved "${displayName}" to ${targetFolderPath}`);
      } else {
        toast.success(`Moved "${displayName}" to root`);
      }
    },
    onError: (error) => {
      toast.error("Failed to move playlist", { description: String(error) });
    },
  });

  // DnD handlers
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const playlistId = String(active.id).replace("playlist-", "");
      const playlist = playlists?.find((p) => p.id === playlistId);
      if (playlist) {
        setActiveDragPlaylist(playlist);
      }
    },
    [playlists],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragPlaylist(null);

      if (!over) return;

      const playlistId = String(active.id).replace("playlist-", "");
      const playlist = playlists?.find((p) => p.id === playlistId);
      if (!playlist) return;

      const overId = String(over.id);

      // Determine target folder path
      let targetFolderPath: string;
      if (overId === "drop-root") {
        // Moving to root
        targetFolderPath = "";
      } else if (overId.startsWith("folder-")) {
        // Moving to a folder
        targetFolderPath = overId.replace("folder-", "");
      } else if (overId.startsWith("breadcrumb-")) {
        // Moving to a breadcrumb level
        targetFolderPath = overId.replace("breadcrumb-", "");
      } else {
        return; // Unknown drop target
      }

      // Get the current folder path of the playlist
      const currentPlaylistPath = playlist.name.includes("/")
        ? playlist.name.substring(0, playlist.name.lastIndexOf("/"))
        : "";

      // Don't do anything if dropping on the same folder
      if (targetFolderPath === currentPlaylistPath) return;

      // Don't allow dropping a playlist into a subfolder that doesn't exist yet
      // (folders are created by naming convention)

      movePlaylistMutation.mutate({ playlist, targetFolderPath });
    },
    [playlists, movePlaylistMutation],
  );

  // Organize playlists into folder tree
  const playlistTree = useMemo(() => {
    if (!playlists) return null;
    return organizePlaylistsIntoFolders(playlists);
  }, [playlists]);

  // Get current folder from path
  const currentFolder = useMemo(() => {
    if (!playlistTree) return null;
    if (!currentPath) return playlistTree;

    let folder = playlistTree;
    for (const part of pathParts) {
      const subfolder = folder.subfolders.find((f) => f.name === part);
      if (!subfolder) return null; // Invalid path
      folder = subfolder;
    }
    return folder;
  }, [playlistTree, currentPath, pathParts]);

  // Get items in current folder (folders and playlists combined for display)
  const folderItems = useMemo(() => {
    if (!currentFolder) return { folders: [], playlists: [] };
    return {
      folders: currentFolder.subfolders,
      playlists: currentFolder.playlists,
    };
  }, [currentFolder]);

  // Filter and sort playlists in current folder
  const displayPlaylists = useMemo(() => {
    if (!folderItems.playlists) return [];
    const filtered = filterPlaylists(folderItems.playlists, debouncedFilter);
    return sortPlaylists(filtered, sortConfig.field, sortConfig.direction);
  }, [folderItems.playlists, debouncedFilter, sortConfig]);

  // Ref for displayPlaylists to make callbacks stable
  const displayPlaylistsRef = useRef(displayPlaylists);
  displayPlaylistsRef.current = displayPlaylists;

  // Play playlist handler - accepts id for stable callback reference
  const handlePlayPlaylist = useCallback(
    (id: string) => {
      const playlist = displayPlaylistsRef.current.find((p) => p.id === id);
      if (playlist) {
        startQueue({
          sourceType: "playlist",
          sourceId: playlist.id,
          sourceName: getPlaylistDisplayName(playlist),
        });
      }
    },
    [startQueue],
  );

  // Filter folders
  const displayFolders = useMemo(() => {
    if (!debouncedFilter.trim()) return folderItems.folders;
    const query = debouncedFilter.toLowerCase();
    return folderItems.folders.filter((f) =>
      f.name.toLowerCase().includes(query),
    );
  }, [folderItems.folders, debouncedFilter]);

  // Calculate totals
  const totalDuration = displayPlaylists.reduce(
    (acc, p) => acc + (p.duration ?? 0),
    0,
  );

  // Playlist selection
  const {
    selectedCount,
    hasSelection,
    isSelected,
    handleSelect,
    clearSelection,
    selectAll,
    getSelectedPlaylists,
    playSelectedNow,
    shuffleSelected,
    addSelectedToQueue,
    deleteSelected,
    mergeSelected,
  } = usePlaylistSelection(displayPlaylists);

  // Navigation helpers
  const navigateToFolder = (folderPath: string) => {
    if (folderPath) {
      router.push(`/playlists?folder=${encodeURIComponent(folderPath)}`);
    } else {
      router.push("/playlists");
    }
  };

  // Handlers for creating playlist/folder in a specific folder via context menu
  const handleCreatePlaylistInFolder = useCallback((folderPath: string) => {
    setCreateInFolderPath(folderPath);
    setCreateDialogOpen(true);
  }, []);

  const handleCreateSubfolder = useCallback((parentPath: string) => {
    setCreateInFolderPath(parentPath);
    setCreateFolderDialogOpen(true);
  }, []);

  // Build breadcrumb items
  const breadcrumbItems = useMemo(() => {
    const items = [{ label: "Playlists", path: "" }];
    let currentPathBuilt = "";
    for (const part of pathParts) {
      currentPathBuilt = currentPathBuilt
        ? `${currentPathBuilt}/${part}`
        : part;
      items.push({ label: part, path: currentPathBuilt });
    }
    return items;
  }, [pathParts]);

  // Always render the same loading state on server and during hydration
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen">
        <DetailHeader
          icon={ListMusic}
          iconClassName="bg-linear-to-br from-emerald-500 to-emerald-800"
          gradientColor="rgba(16,185,129,0.2)"
          label="Collection"
          title="Playlists"
          isLoading
        />

        {/* Action bar skeleton */}
        <div className="px-4 lg:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 border-b border-border">
          {/* Play/Shuffle buttons */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-12 w-12 rounded-full" />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-24 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>

          <div className="flex-1" />

          {/* Toolbar */}
          <Skeleton className="h-10 w-64" />
        </div>

        <div className="px-4 lg:px-6 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="min-h-screen">
        {/* Header */}
        <DetailHeader
          icon={currentPath ? FolderOpen : ListMusic}
          iconClassName="bg-linear-to-br from-emerald-500 to-emerald-800"
          gradientColor="rgba(16,185,129,0.2)"
          label={currentPath ? "Folder" : "Collection"}
          title={currentPath ? pathParts[pathParts.length - 1] : "Playlists"}
          isLoading={isLoading}
          subtitle={
            !isLoading &&
            `${formatCount(displayFolders.length, "folder")} • ${formatCount(displayPlaylists.length, "playlist")} • ${formatTotalDuration(totalDuration)}`
          }
        />

        {/* Breadcrumb navigation with droppable targets */}
        {currentPath && (
          <div className="relative z-20 px-4 lg:px-6 py-2 flex items-center gap-1 text-sm text-muted-foreground border-b border-border bg-background/80 backdrop-blur-sm">
            {breadcrumbItems.map((item, index) => (
              <div key={item.path} className="flex items-center">
                {index > 0 && <ChevronRight className="w-4 h-4 mx-1" />}
                {index === breadcrumbItems.length - 1 ? (
                  <span className="font-medium text-foreground">
                    {item.label}
                  </span>
                ) : (
                  <DroppableBreadcrumb
                    path={item.path}
                    onClick={() => navigateToFolder(item.path)}
                  >
                    {index === 0 ? <Home className="w-4 h-4" /> : item.label}
                  </DroppableBreadcrumb>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Action buttons and toolbar */}
        <ActionBar
          onPlayAll={playSelectedNow}
          onShuffle={shuffleSelected}
          disablePlay={displayPlaylists.length === 0}
          actions={
            <>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full gap-2"
                onClick={() => setImportDialogOpen(true)}
              >
                <Upload className="w-5 h-5" />
                Import
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full gap-2"
                onClick={() => setCreateFolderDialogOpen(true)}
              >
                <FolderPlus className="w-5 h-5" />
                Folder
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full gap-2"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="w-5 h-5" />
                Playlist
              </Button>
            </>
          }
          toolbar={
            <PlaylistsListToolbar
              filter={filter}
              onFilterChange={setFilter}
              filterPlaceholder="Filter playlists..."
              sortConfig={sortConfig}
              onSortChange={setSortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          }
        />

        {/* Content */}
        <div className={cn("px-4 lg:px-6 py-4", hasSelection && "select-none")}>
          {isLoading ? (
            viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <MediaCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {Array.from({ length: 10 }).map((_, i) => (
                  <MediaRowSkeleton key={i} showRightContent />
                ))}
              </div>
            )
          ) : displayFolders.length > 0 || displayPlaylists.length > 0 ? (
            viewMode === "grid" ? (
              <VirtualizedGrid
                items={[
                  ...displayFolders.map((f) => ({
                    type: "folder" as const,
                    data: f,
                  })),
                  ...displayPlaylists.map((p) => ({
                    type: "playlist" as const,
                    data: p,
                  })),
                ]}
                renderItem={(item) =>
                  item.type === "folder" ? (
                    <DroppableFolderGridCard
                      folder={item.data}
                      currentPath={currentPath}
                      onNavigate={navigateToFolder}
                      onCreateSubfolder={handleCreateSubfolder}
                      onCreatePlaylist={handleCreatePlaylistInFolder}
                    />
                  ) : (
                    <DraggablePlaylistGridCard
                      playlist={item.data}
                      isSelected={isSelected(item.data.id)}
                      isSelectionMode={hasSelection}
                      onSelect={(e) => handleSelect(item.data.id, e)}
                      onPlay={() => handlePlayPlaylist(item.data.id)}
                    />
                  )
                }
                renderSkeleton={() => <MediaCardSkeleton />}
                getItemKey={(item) =>
                  item.type === "folder"
                    ? `folder-${item.data.path}`
                    : item.data.id
                }
              />
            ) : (
              <VirtualizedList
                items={[
                  ...displayFolders.map((f) => ({
                    type: "folder" as const,
                    data: f,
                  })),
                  ...displayPlaylists.map((p) => ({
                    type: "playlist" as const,
                    data: p,
                  })),
                ]}
                renderItem={(item, index) =>
                  item.type === "folder" ? (
                    <DroppableFolderListRow
                      folder={item.data}
                      index={index}
                      currentPath={currentPath}
                      onNavigate={navigateToFolder}
                      onCreateSubfolder={handleCreateSubfolder}
                      onCreatePlaylist={handleCreatePlaylistInFolder}
                    />
                  ) : (
                    <DraggablePlaylistListRow
                      playlist={item.data}
                      index={index}
                      isSelected={isSelected(item.data.id)}
                      isSelectionMode={hasSelection}
                      onSelect={(e) => handleSelect(item.data.id, e)}
                      onPlay={() => handlePlayPlaylist(item.data.id)}
                      columnVisibility={columnVisibility}
                    />
                  )
                }
                renderSkeleton={() => <MediaRowSkeleton showRightContent />}
                getItemKey={(item) =>
                  item.type === "folder"
                    ? `folder-${item.data.path}`
                    : item.data.id
                }
                estimateItemHeight={56}
              />
            )
          ) : playlists && playlists.length > 0 ? (
            <EmptyFilterState message="No playlists match your filter" />
          ) : (
            <EmptyState
              icon={ListMusic}
              title="No playlists yet"
              description="Create your first playlist to organize your favorite music."
              action={
                <Button
                  className="rounded-full gap-2"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="w-4 h-4" />
                  Create Playlist
                </Button>
              }
            />
          )}
        </div>

        {/* Bulk actions bar */}
        <BulkActionsBar
          mediaType="playlist"
          selectedCount={selectedCount}
          onClear={clearSelection}
          onPlayNow={playSelectedNow}
          onShuffle={shuffleSelected}
          onPlayNext={() => addSelectedToQueue("next")}
          onAddToQueue={() => addSelectedToQueue("last")}
          onSelectAll={selectAll}
          getSelectedItems={getSelectedPlaylists}
          onDelete={deleteSelected}
          onMerge={mergeSelected}
        />

        {/* Create Playlist Dialog */}
        <CreatePlaylistDialog
          open={createDialogOpen}
          onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) setCreateInFolderPath("");
          }}
          folderPath={createInFolderPath || currentPath}
        />

        {/* Create Folder Dialog */}
        <CreatePlaylistDialog
          open={createFolderDialogOpen}
          onOpenChange={(open) => {
            setCreateFolderDialogOpen(open);
            if (!open) setCreateInFolderPath("");
          }}
          folderPath={createInFolderPath || currentPath}
          createFolder
        />

        {/* Import Playlist Dialog */}
        <ImportPlaylistDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          folderPath={currentPath}
        />

        {/* Spacer for player bar */}
        <div className="h-24" />
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDragPlaylist && (
          <div className="bg-background/90 backdrop-blur-sm rounded-lg border border-border shadow-lg p-3 flex items-center gap-3">
            <ListMusic className="w-6 h-6 text-emerald-500" />
            <span className="font-medium">
              {getPlaylistDisplayName(activeDragPlaylist)}
            </span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// Droppable breadcrumb for drag targets
interface DroppableBreadcrumbProps {
  path: string;
  onClick: () => void;
  children: React.ReactNode;
}

function DroppableBreadcrumb({
  path,
  onClick,
  children,
}: DroppableBreadcrumbProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: path === "" ? "drop-root" : `breadcrumb-${path}`,
  });

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={cn(
        "px-2 py-1 -mx-2 -my-1 rounded transition-colors hover:text-foreground",
        isOver && "bg-emerald-500/20 text-emerald-500",
      )}
    >
      {children}
    </button>
  );
}

// Droppable folder card for grid view
interface DroppableFolderGridCardProps {
  folder: PlaylistFolder;
  currentPath: string;
  onNavigate: (path: string) => void;
  onCreateSubfolder: (parentPath: string) => void;
  onCreatePlaylist: (folderPath: string) => void;
}

function DroppableFolderGridCard({
  folder,
  onNavigate,
  onCreateSubfolder,
  onCreatePlaylist,
}: DroppableFolderGridCardProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-${folder.path}`,
  });
  const playlistCount = countPlaylistsInFolder(folder);

  return (
    <FolderContextMenu
      folder={folder}
      onCreateSubfolder={onCreateSubfolder}
      onCreatePlaylist={onCreatePlaylist}
    >
      <button
        ref={setNodeRef}
        onClick={() => onNavigate(folder.path)}
        className={cn(
          "group relative flex flex-col items-center text-left w-full rounded-lg transition-colors hover:bg-accent/50 p-4",
          isOver && "bg-emerald-500/20 ring-2 ring-emerald-500",
        )}
      >
        <FolderDropdownMenu
          folder={folder}
          onCreateSubfolder={onCreateSubfolder}
          onCreatePlaylist={onCreatePlaylist}
        />
        <div
          className={cn(
            "w-full aspect-square rounded-lg bg-linear-to-br from-amber-500/20 to-amber-700/20 flex items-center justify-center mb-3",
            isOver && "from-emerald-500/30 to-emerald-700/30",
          )}
        >
          <Folder
            className={cn(
              "w-16 h-16 text-amber-500",
              isOver && "text-emerald-500",
            )}
          />
        </div>
        <div className="w-full">
          <h3 className="font-medium truncate">{folder.name}</h3>
          <p className="text-sm text-muted-foreground truncate">
            {formatCount(folder.subfolders.length, "folder")} •{" "}
            {formatCount(playlistCount, "playlist")}
          </p>
        </div>
      </button>
    </FolderContextMenu>
  );
}

// Droppable folder row for list view
interface DroppableFolderListRowProps {
  folder: PlaylistFolder;
  index: number;
  currentPath: string;
  onNavigate: (path: string) => void;
  onCreateSubfolder: (parentPath: string) => void;
  onCreatePlaylist: (folderPath: string) => void;
}

function DroppableFolderListRow({
  folder,
  index,
  onNavigate,
  onCreateSubfolder,
  onCreatePlaylist,
}: DroppableFolderListRowProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-${folder.path}`,
  });
  const playlistCount = countPlaylistsInFolder(folder);

  return (
    <FolderContextMenu
      folder={folder}
      onCreateSubfolder={onCreateSubfolder}
      onCreatePlaylist={onCreatePlaylist}
    >
      <div
        ref={setNodeRef}
        onClick={() => onNavigate(folder.path)}
        className={cn(
          "w-full flex items-center gap-4 py-2 px-2 rounded-md hover:bg-accent/50 transition-colors group cursor-pointer",
          isOver && "bg-emerald-500/20 ring-2 ring-emerald-500",
        )}
      >
        <span className="w-8 text-center text-sm text-muted-foreground tabular-nums">
          {index + 1}
        </span>
        <div
          className={cn(
            "w-10 h-10 rounded bg-linear-to-br from-amber-500/20 to-amber-700/20 flex items-center justify-center shrink-0",
            isOver && "from-emerald-500/30 to-emerald-700/30",
          )}
        >
          <Folder
            className={cn(
              "w-5 h-5 text-amber-500",
              isOver && "text-emerald-500",
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{folder.name}</h3>
          <p className="text-sm text-muted-foreground truncate">
            {formatCount(folder.subfolders.length, "folder")} •{" "}
            {formatCount(playlistCount, "playlist")}
          </p>
        </div>
        <FolderDropdownMenu
          folder={folder}
          inline
          onCreateSubfolder={onCreateSubfolder}
          onCreatePlaylist={onCreatePlaylist}
        />
        <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </FolderContextMenu>
  );
}

// Helper to count all playlists in a folder recursively
function countPlaylistsInFolder(folder: PlaylistFolder): number {
  let count = folder.playlists.length;
  for (const subfolder of folder.subfolders) {
    count += countPlaylistsInFolder(subfolder);
  }
  return count;
}

// Draggable playlist grid card
interface DraggablePlaylistGridCardProps {
  playlist: Playlist;
  isSelected: boolean;
  isSelectionMode: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onPlay?: () => void;
}

function DraggablePlaylistGridCard({
  playlist,
  isSelected,
  isSelectionMode,
  onSelect,
  onPlay,
}: DraggablePlaylistGridCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `playlist-${playlist.id}`,
  });

  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 300)
    : undefined;

  return (
    <div
      ref={setNodeRef}
      className={cn(isDragging && "opacity-50")}
      {...attributes}
      {...listeners}
    >
      <MediaCard
        coverArt={coverArtUrl}
        title={getPlaylistDisplayName(playlist)}
        subtitleContent={
          <span className="flex items-center gap-1">
            {formatCount(playlist.songCount, "song")} •{" "}
            <Clock className="w-3 h-3" /> {formatDuration(playlist.duration)}
          </span>
        }
        href={`/playlists/details?id=${playlist.id}`}
        coverType="playlist"
        colorSeed={playlist.name}
        isSelected={isSelected}
        isSelectionMode={isSelectionMode}
        onSelect={onSelect}
        onPlay={onPlay}
        dropdownMenu={<PlaylistDropdownMenu playlist={playlist} />}
        contextMenu={(children) => (
          <PlaylistContextMenu playlist={playlist}>
            {children}
          </PlaylistContextMenu>
        )}
      />
    </div>
  );
}

// Draggable playlist list row
interface DraggablePlaylistListRowProps {
  playlist: Playlist;
  index: number;
  isSelected: boolean;
  isSelectionMode: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onPlay?: () => void;
  columnVisibility: {
    songCount: boolean;
    duration: boolean;
    owner: boolean;
    created: boolean;
  };
}

function DraggablePlaylistListRow({
  playlist,
  index,
  isSelected,
  isSelectionMode,
  onSelect,
  onPlay,
  columnVisibility,
}: DraggablePlaylistListRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `playlist-${playlist.id}`,
  });

  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 80)
    : undefined;

  return (
    <div
      ref={setNodeRef}
      className={cn(isDragging && "opacity-50")}
      {...attributes}
      {...listeners}
    >
      <MediaRow
        coverArt={coverArtUrl}
        title={getPlaylistDisplayName(playlist)}
        subtitle={playlist.comment ?? undefined}
        href={`/playlists/details?id=${playlist.id}`}
        coverType="playlist"
        colorSeed={playlist.name}
        index={index}
        isSelected={isSelected}
        isSelectionMode={isSelectionMode}
        onSelect={onSelect}
        onPlay={onPlay}
        actions={<PlaylistDropdownMenu playlist={playlist} inline />}
        rightContent={
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            {columnVisibility.songCount && (
              <span className="w-16 text-right tabular-nums">
                {playlist.songCount} songs
              </span>
            )}
            {columnVisibility.duration && (
              <span className="w-16 text-right tabular-nums">
                {formatDuration(playlist.duration)}
              </span>
            )}
            {columnVisibility.owner && playlist.owner && (
              <span className="w-24 truncate">{playlist.owner}</span>
            )}
            {columnVisibility.created && (
              <span className="w-24 text-right">
                {formatDate(playlist.created)}
              </span>
            )}
          </div>
        }
        contextMenu={(children) => (
          <PlaylistContextMenu playlist={playlist}>
            {children}
          </PlaylistContextMenu>
        )}
      />
    </div>
  );
}

export default function PlaylistsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen">
          <DetailHeader
            icon={ListMusic}
            iconClassName="bg-linear-to-br from-emerald-500 to-emerald-800"
            gradientColor="rgba(16,185,129,0.2)"
            label="Collection"
            title="Playlists"
            isLoading
          />
        </div>
      }
    >
      <PlaylistsPageContent />
    </Suspense>
  );
}
