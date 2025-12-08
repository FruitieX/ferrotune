"use client";

import {
  Search,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Grid,
  List,
  Columns,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import type {
  SortField,
  SortDirection,
  ViewMode,
  AlbumColumnVisibility,
  ArtistColumnVisibility,
} from "@/lib/store/ui";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// Sort options for albums
const albumSortOptions: { value: SortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "artist", label: "Artist" },
  { value: "year", label: "Year" },
  { value: "dateAdded", label: "Date Added" },
  { value: "songCount", label: "Track Count" },
];

// Sort options for artists
const artistSortOptions: { value: SortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "albumCount", label: "Album Count" },
];

// Column options for albums in list view
const albumColumnOptions: {
  key: keyof AlbumColumnVisibility;
  label: string;
}[] = [
  { key: "artist", label: "Artist" },
  { key: "year", label: "Year" },
  { key: "songCount", label: "Songs" },
  { key: "duration", label: "Duration" },
];

// Column options for artists in list view
const artistColumnOptions: {
  key: keyof ArtistColumnVisibility;
  label: string;
}[] = [{ key: "albumCount", label: "Albums" }];

interface MediaListToolbarProps {
  // Filter
  filter: string;
  onFilterChange: (filter: string) => void;
  filterPlaceholder?: string;

  // Sort
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;

  // View mode
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;

  // Media type determines available sort options
  mediaType: "album" | "artist";

  // Column visibility (optional, only for list view)
  columnVisibility?: AlbumColumnVisibility | ArtistColumnVisibility;
  onColumnVisibilityChange?: (
    visibility: AlbumColumnVisibility | ArtistColumnVisibility,
  ) => void;

  // Optional: hide certain controls
  showFilter?: boolean;
  showSort?: boolean;
  showViewMode?: boolean;
  showColumns?: boolean;
}

export function MediaListToolbar({
  filter,
  onFilterChange,
  filterPlaceholder = "Filter...",
  sortConfig,
  onSortChange,
  viewMode,
  onViewModeChange,
  mediaType,
  columnVisibility,
  onColumnVisibilityChange,
  showFilter = true,
  showSort = true,
  showViewMode = true,
  showColumns = true,
}: MediaListToolbarProps) {
  const sortOptions =
    mediaType === "album" ? albumSortOptions : artistSortOptions;
  const columnOptions =
    mediaType === "album" ? albumColumnOptions : artistColumnOptions;

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

  const handleColumnToggle = (key: string) => {
    if (!columnVisibility || !onColumnVisibilityChange) return;
    const current = columnVisibility as unknown as Record<string, boolean>;
    onColumnVisibilityChange({
      ...columnVisibility,
      [key]: !current[key],
    } as AlbumColumnVisibility | ArtistColumnVisibility);
  };

  const SortIcon = sortConfig.direction === "asc" ? ArrowUp : ArrowDown;

  return (
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
      {showSort && sortOptions.length > 1 && (
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
            {sortOptions.map((option) => (
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Column visibility dropdown - only show in list view */}
      {showColumns &&
        viewMode === "list" &&
        columnVisibility &&
        onColumnVisibilityChange &&
        columnOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Column visibility"
              >
                <Columns className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columnOptions.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.key}
                  checked={
                    (columnVisibility as unknown as Record<string, boolean>)[
                      option.key
                    ]
                  }
                  onCheckedChange={() => handleColumnToggle(option.key)}
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
    </div>
  );
}
