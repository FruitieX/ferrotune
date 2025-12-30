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
