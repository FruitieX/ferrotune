"use client";

import {
  Search,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns,
  Grid,
  List,
  Check,
  MoreHorizontal,
  Shuffle,
  Pencil,
  Trash2,
  RefreshCw,
  Plus,
} from "lucide-react";
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import {
  AdvancedFilterDialog,
  ActiveFilterBadges,
} from "@/components/shared/advanced-filter-dialog";
import type {
  SortField,
  SortDirection,
  ColumnVisibility,
  ViewMode,
} from "@/lib/store/ui";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

const sortOptions: { value: SortField; label: string }[] = [
  { value: "custom", label: "Custom" },
  { value: "name", label: "Name" },
  { value: "artist", label: "Artist" },
  { value: "year", label: "Year" },
  { value: "dateAdded", label: "Date Added" },
  { value: "addedToPlaylist", label: "Added to Playlist" },
  { value: "playCount", label: "Play Count" },
  { value: "lastPlayed", label: "Last Played" },
  { value: "duration", label: "Duration" },
];

const columnOptions: { key: keyof ColumnVisibility; label: string }[] = [
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "duration", label: "Duration" },
  { key: "playCount", label: "Play Count" },
  { key: "dateAdded", label: "Date Added" },
  { key: "lastPlayed", label: "Last Played" },
  { key: "year", label: "Year" },
];

interface SongListToolbarProps {
  // Filter
  filter: string;
  onFilterChange: (filter: string) => void;
  filterPlaceholder?: string;

  // Sort
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;

  // Columns (only shown in list view)
  columnVisibility: ColumnVisibility;
  onColumnVisibilityChange: (visibility: ColumnVisibility) => void;

  // View mode
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;

  // Optional: hide certain controls
  showFilter?: boolean;
  showSort?: boolean;
  showColumns?: boolean;
  showViewMode?: boolean;
  showAdvancedFilters?: boolean;
  /** Show the "Custom" sort option (for playlist reordering) */
  showCustomSort?: boolean;
  /** Show the "Added to Playlist" sort option (for playlist views) */
  showAddedToPlaylist?: boolean;
}

export function SongListToolbar({
  filter,
  onFilterChange,
  filterPlaceholder = "Filter...",
  sortConfig,
  onSortChange,
  columnVisibility,
  onColumnVisibilityChange,
  viewMode,
  onViewModeChange,
  showFilter = true,
  showSort = true,
  showColumns = true,
  showViewMode = true,
  showAdvancedFilters = false,
  showCustomSort = false,
  showAddedToPlaylist = false,
}: SongListToolbarProps) {
  const handleSort = (field: SortField) => {
    // For "custom" sort (playlist order), don't toggle direction - always use ascending
    // as it represents the natural playlist order
    if (field === "custom") {
      onSortChange({ field, direction: "asc" });
      return;
    }

    if (sortConfig.field === field) {
      onSortChange({
        field,
        direction: sortConfig.direction === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({ field, direction: "asc" });
    }
  };

  const toggleColumn = (key: keyof ColumnVisibility) => {
    onColumnVisibilityChange({
      ...columnVisibility,
      [key]: !columnVisibility[key],
    });
  };

  const SortIcon = sortConfig.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* Search filter */}
        {showFilter && (
          <div className="flex-1 max-w-xs relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={filterPlaceholder}
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              className="pl-9 pr-8 h-9 bg-secondary border-0 rounded-full"
              aria-label="Filter items"
            />
            {filter && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => onFilterChange("")}
                aria-label="Clear filter"
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        )}

        {/* Sort dropdown */}
        {showSort && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Sort options"
              >
                <ArrowUpDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {sortOptions
                .filter(
                  (option) =>
                    (showCustomSort || option.value !== "custom") &&
                    (showAddedToPlaylist || option.value !== "addedToPlaylist"),
                )
                .map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => handleSort(option.value)}
                    className="flex items-center justify-between"
                  >
                    <span>{option.label}</span>
                    {sortConfig.field === option.value &&
                      (option.value === "custom" ? (
                        <Check className="w-4 h-4 text-primary" />
                      ) : (
                        <SortIcon className="w-4 h-4 text-primary" />
                      ))}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Column visibility dropdown - only in list view */}
        {showColumns && viewMode === "list" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Toggle columns"
              >
                <Columns className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Visible Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columnOptions.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.key}
                  checked={columnVisibility[option.key]}
                  onCheckedChange={() => toggleColumn(option.key)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* View mode toggle */}
        {showViewMode && (
          <>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => onViewModeChange("grid")}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <Grid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => onViewModeChange("list")}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List className="w-4 h-4" />
            </Button>
          </>
        )}

        {/* Advanced filters */}
        {showAdvancedFilters && <AdvancedFilterDialog />}
      </div>

      {/* Active filter badges */}
      {showAdvancedFilters && <ActiveFilterBadges />}
    </div>
  );
}

/**
 * Mobile overflow menu for song lists (e.g., playlist details, album details).
 * Contains shuffle, more actions (edit, add, delete), sort, column visibility, and view mode.
 */
interface SongListMobileMenuProps {
  // Shuffle
  onShuffle?: () => void;
  disableShuffle?: boolean;

  // More menu actions (edit playlist, add song, resolve missing, delete)
  onEditPlaylist?: () => void;
  onAddSong?: () => void;
  onResolveMissing?: () => void;
  showResolveMissing?: boolean;
  onDeletePlaylist?: () => void;

  // Sort
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;
  showCustomSort?: boolean;
  showAddedToPlaylist?: boolean;

  // View mode
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;

  // Column visibility (optional, only for list view)
  columnVisibility?: ColumnVisibility;
  onColumnVisibilityChange?: (visibility: ColumnVisibility) => void;
}

export function SongListMobileMenu({
  onShuffle,
  disableShuffle = false,
  onEditPlaylist,
  onAddSong,
  onResolveMissing,
  showResolveMissing = false,
  onDeletePlaylist,
  sortConfig,
  onSortChange,
  showCustomSort = false,
  showAddedToPlaylist = false,
  viewMode,
  onViewModeChange,
  columnVisibility,
  onColumnVisibilityChange,
}: SongListMobileMenuProps) {
  const handleSort = (field: SortField) => {
    if (field === "custom") {
      onSortChange({ field, direction: "asc" });
      return;
    }

    if (sortConfig.field === field) {
      onSortChange({
        field,
        direction: sortConfig.direction === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({ field, direction: "asc" });
    }
  };

  const handleColumnToggle = (key: keyof ColumnVisibility) => {
    if (!columnVisibility || !onColumnVisibilityChange) return;
    onColumnVisibilityChange({
      ...columnVisibility,
      [key]: !columnVisibility[key],
    });
  };

  const SortIcon = sortConfig.direction === "asc" ? ArrowUp : ArrowDown;

  const hasMoreActions =
    onEditPlaylist ||
    onAddSong ||
    (showResolveMissing && onResolveMissing) ||
    onDeletePlaylist;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="More options"
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {/* Shuffle */}
        {onShuffle && (
          <>
            <DropdownMenuItem onClick={onShuffle} disabled={disableShuffle}>
              <Shuffle className="w-4 h-4 mr-2" />
              Shuffle
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Playlist actions - inline */}
        {onEditPlaylist && (
          <DropdownMenuItem onClick={onEditPlaylist}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit Playlist
          </DropdownMenuItem>
        )}
        {onAddSong && (
          <DropdownMenuItem onClick={onAddSong}>
            <Plus className="w-4 h-4 mr-2" />
            Add Song
          </DropdownMenuItem>
        )}
        {showResolveMissing && onResolveMissing && (
          <DropdownMenuItem onClick={onResolveMissing}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Resolve Missing
          </DropdownMenuItem>
        )}
        {onDeletePlaylist && (
          <DropdownMenuItem
            onClick={onDeletePlaylist}
            className="text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Playlist
          </DropdownMenuItem>
        )}
        {hasMoreActions && <DropdownMenuSeparator />}

        {/* Sort submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowUpDown className="w-4 h-4 mr-2" />
            Sort
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-40">
              {sortOptions
                .filter(
                  (option) =>
                    (showCustomSort || option.value !== "custom") &&
                    (showAddedToPlaylist || option.value !== "addedToPlaylist"),
                )
                .map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => handleSort(option.value)}
                    className="flex items-center justify-between"
                  >
                    <span>{option.label}</span>
                    {sortConfig.field === option.value &&
                      (option.value === "custom" ? (
                        <Check className="w-4 h-4 text-primary" />
                      ) : (
                        <SortIcon className="w-4 h-4 text-primary" />
                      ))}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        {/* Column visibility submenu - only in list view */}
        {viewMode === "list" &&
          columnVisibility &&
          onColumnVisibilityChange && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Columns className="w-4 h-4 mr-2" />
                Columns
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-40">
                  {columnOptions.map((option) => (
                    <DropdownMenuCheckboxItem
                      key={option.key}
                      checked={columnVisibility[option.key]}
                      onCheckedChange={() => handleColumnToggle(option.key)}
                    >
                      {option.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

        {/* View mode */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          View
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onViewModeChange("grid")}>
          <Grid className="w-4 h-4 mr-2" />
          Grid
          {viewMode === "grid" && (
            <Check className="w-4 h-4 ml-auto text-primary" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onViewModeChange("list")}>
          <List className="w-4 h-4 mr-2" />
          List
          {viewMode === "list" && (
            <Check className="w-4 h-4 ml-auto text-primary" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Mobile filter input - a compact filter input for mobile views.
 */
interface MobileFilterInputProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  placeholder?: string;
}

export function MobileFilterInput({
  filter,
  onFilterChange,
  placeholder = "Filter...",
}: MobileFilterInputProps) {
  return (
    <div className="relative w-full">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        type="text"
        placeholder={placeholder}
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        className="pl-9 pr-8 h-9 bg-secondary border-0 rounded-full w-full"
        aria-label="Filter items"
      />
      {filter && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={() => onFilterChange("")}
          aria-label="Clear filter"
        >
          <X className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

/**
 * Mobile overflow menu for album/artist detail views.
 * Contains sort, column visibility, and view mode options.
 * Simpler than SongListMobileMenu - no playlist-specific actions.
 */
interface AlbumDetailMobileMenuProps {
  // Sort
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;

  // View mode
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;

  // Column visibility (optional, only for list view)
  columnVisibility?: ColumnVisibility;
  onColumnVisibilityChange?: (visibility: ColumnVisibility) => void;
}

export function AlbumDetailMobileMenu({
  sortConfig,
  onSortChange,
  viewMode,
  onViewModeChange,
  columnVisibility,
  onColumnVisibilityChange,
}: AlbumDetailMobileMenuProps) {
  const handleSort = (field: SortField) => {
    if (sortConfig.field === field) {
      onSortChange({
        field,
        direction: sortConfig.direction === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({ field, direction: "asc" });
    }
  };

  const handleColumnToggle = (key: keyof ColumnVisibility) => {
    if (!columnVisibility || !onColumnVisibilityChange) return;
    onColumnVisibilityChange({
      ...columnVisibility,
      [key]: !columnVisibility[key],
    });
  };

  const SortIcon = sortConfig.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="More options"
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {/* Sort submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowUpDown className="w-4 h-4 mr-2" />
            Sort
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-40">
              {sortOptions
                .filter(
                  (option) =>
                    option.value !== "custom" &&
                    option.value !== "addedToPlaylist",
                )
                .map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => handleSort(option.value)}
                    className="flex items-center justify-between"
                  >
                    <span>{option.label}</span>
                    {sortConfig.field === option.value && (
                      <SortIcon className="w-4 h-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        {/* Column visibility submenu - only in list view */}
        {viewMode === "list" &&
          columnVisibility &&
          onColumnVisibilityChange && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Columns className="w-4 h-4 mr-2" />
                Columns
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-40">
                  {columnOptions.map((option) => (
                    <DropdownMenuCheckboxItem
                      key={option.key}
                      checked={columnVisibility[option.key]}
                      onCheckedChange={() => handleColumnToggle(option.key)}
                    >
                      {option.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

        {/* View mode */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          View
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onViewModeChange("grid")}>
          <Grid className="w-4 h-4 mr-2" />
          Grid
          {viewMode === "grid" && (
            <Check className="w-4 h-4 ml-auto text-primary" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onViewModeChange("list")}>
          <List className="w-4 h-4 mr-2" />
          List
          {viewMode === "list" && (
            <Check className="w-4 h-4 ml-auto text-primary" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
