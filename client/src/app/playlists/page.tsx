"use client";

import { useState, useMemo } from "react";
import { useAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { Plus, ListMusic, Upload, Clock } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { usePlaylistSelection } from "@/lib/hooks/use-playlist-selection";
import { playlistsViewModeAtom, playlistsSortAtom, playlistsColumnVisibilityAtom } from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/shared/detail-header";
import { ActionBar } from "@/components/shared/action-bar";
import { EmptyState, EmptyFilterState } from "@/components/shared/empty-state";
import { PlaylistsListToolbar } from "@/components/shared/playlists-list-toolbar";
import { VirtualizedGrid, VirtualizedList } from "@/components/shared/virtualized-grid";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import { MediaRow, MediaRowSkeleton } from "@/components/shared/media-row";
import { BulkActionsBar } from "@/components/shared/bulk-actions-bar";
import { CreatePlaylistDialog } from "@/components/playlists/create-playlist-dialog";
import { ImportPlaylistDialog } from "@/components/playlists/import-playlist-dialog";
import { PlaylistContextMenu, PlaylistDropdownMenu } from "@/components/playlists/playlist-context-menu";
import { formatDuration, formatCount, formatDate, formatTotalDuration } from "@/lib/utils/format";
import { filterPlaylists, sortPlaylists } from "@/lib/utils/sort-playlists";
import { cn } from "@/lib/utils";
import type { Playlist } from "@/lib/api/types";

export default function PlaylistsPage() {
  const { isReady, isLoading: authLoading } = useAuth({ redirectToLogin: true });
  const isMounted = useIsMounted();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
  // Filter and view settings
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebounce(filter, 300);
  const [viewMode, setViewMode] = useAtom(playlistsViewModeAtom);
  const [sortConfig, setSortConfig] = useAtom(playlistsSortAtom);
  const [columnVisibility, setColumnVisibility] = useAtom(playlistsColumnVisibilityAtom);
  
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

  // Filter and sort playlists
  const displayPlaylists = useMemo(() => {
    if (!playlists) return [];
    const filtered = filterPlaylists(playlists, debouncedFilter);
    return sortPlaylists(filtered, sortConfig.field, sortConfig.direction);
  }, [playlists, debouncedFilter, sortConfig]);

  // Calculate totals
  const totalDuration = displayPlaylists.reduce((acc, p) => acc + (p.duration ?? 0), 0);

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

  // Always render the same loading state on server and during hydration
  if (!isMounted || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <DetailHeader
        icon={ListMusic}
        iconClassName="bg-linear-to-br from-emerald-500 to-emerald-800"
        gradientColor="rgba(16,185,129,0.2)"
        label="Collection"
        title="Playlists"
        subtitle={
          isLoading 
            ? "Loading..." 
            : `${formatCount(displayPlaylists.length, "playlist")} • ${formatTotalDuration(totalDuration)}`
        }
      />

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
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="w-5 h-5" />
              Create
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

      {/* Playlist list */}
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
        ) : displayPlaylists.length > 0 ? (
          viewMode === "grid" ? (
            <VirtualizedGrid
              items={displayPlaylists}
              renderItem={(playlist) => (
                <PlaylistGridCard
                  playlist={playlist}
                  isSelected={isSelected(playlist.id)}
                  isSelectionMode={hasSelection}
                  onSelect={(e) => handleSelect(playlist.id, e)}
                />
              )}
              renderSkeleton={() => <MediaCardSkeleton />}
              getItemKey={(playlist) => playlist.id}
            />
          ) : (
            <VirtualizedList
              items={displayPlaylists}
              renderItem={(playlist, index) => (
                <PlaylistListRow
                  playlist={playlist}
                  index={index}
                  isSelected={isSelected(playlist.id)}
                  isSelectionMode={hasSelection}
                  onSelect={(e) => handleSelect(playlist.id, e)}
                  columnVisibility={columnVisibility}
                />
              )}
              renderSkeleton={() => <MediaRowSkeleton showRightContent />}
              getItemKey={(playlist) => playlist.id}
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
              <Button className="rounded-full gap-2" onClick={() => setCreateDialogOpen(true)}>
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
        onOpenChange={setCreateDialogOpen} 
      />

      {/* Import Playlist Dialog */}
      <ImportPlaylistDialog 
        open={importDialogOpen} 
        onOpenChange={setImportDialogOpen} 
      />

      {/* Spacer for player bar */}
      <div className="h-24" />
    </div>
  );
}

interface PlaylistGridCardProps {
  playlist: Playlist;
  isSelected: boolean;
  isSelectionMode: boolean;
  onSelect: (e: React.MouseEvent) => void;
}

function PlaylistGridCard({ playlist, isSelected, isSelectionMode, onSelect }: PlaylistGridCardProps) {
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 300)
    : undefined;

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={playlist.name}
      subtitleContent={
        <span className="flex items-center gap-1">
          {formatCount(playlist.songCount, "song")} • <Clock className="w-3 h-3" /> {formatDuration(playlist.duration)}
        </span>
      }
      href={`/playlists/details?id=${playlist.id}`}
      coverType="playlist"
      colorSeed={playlist.name}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect}
      dropdownMenu={<PlaylistDropdownMenu playlist={playlist} />}
      contextMenu={(children) => (
        <PlaylistContextMenu playlist={playlist}>{children}</PlaylistContextMenu>
      )}
    />
  );
}

interface PlaylistListRowProps {
  playlist: Playlist;
  index: number;
  isSelected: boolean;
  isSelectionMode: boolean;
  onSelect: (e: React.MouseEvent) => void;
  columnVisibility: {
    songCount: boolean;
    duration: boolean;
    owner: boolean;
    created: boolean;
  };
}

function PlaylistListRow({ playlist, index, isSelected, isSelectionMode, onSelect, columnVisibility }: PlaylistListRowProps) {
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 80)
    : undefined;

  return (
    <MediaRow
      coverArt={coverArtUrl}
      title={playlist.name}
      subtitle={playlist.comment}
      href={`/playlists/details?id=${playlist.id}`}
      coverType="playlist"
      colorSeed={playlist.name}
      index={index}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect}
      actions={<PlaylistDropdownMenu playlist={playlist} inline />}
      rightContent={
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          {columnVisibility.songCount && (
            <span className="w-16 text-right tabular-nums">{playlist.songCount} songs</span>
          )}
          {columnVisibility.duration && (
            <span className="w-16 text-right tabular-nums">{formatDuration(playlist.duration)}</span>
          )}
          {columnVisibility.owner && playlist.owner && (
            <span className="w-24 truncate">{playlist.owner}</span>
          )}
          {columnVisibility.created && (
            <span className="w-24 text-right">{formatDate(playlist.created)}</span>
          )}
        </div>
      }
      contextMenu={(children) => (
        <PlaylistContextMenu playlist={playlist}>{children}</PlaylistContextMenu>
      )}
    />
  );
}
