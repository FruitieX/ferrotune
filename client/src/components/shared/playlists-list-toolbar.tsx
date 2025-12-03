"use client";

import { Search, X, ArrowUpDown, ArrowUp, ArrowDown, Grid, List, Columns } from "lucide-react";
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
import type { SortField, SortDirection, ViewMode, PlaylistColumnVisibility } from "@/lib/store/ui";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// Sort options for playlists
const playlistSortOptions: { value: SortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "songCount", label: "Song Count" },
  { value: "duration", label: "Duration" },
  { value: "dateAdded", label: "Date Created" },
];

// Column options for playlists in list view
const playlistColumnOptions: { key: keyof PlaylistColumnVisibility; label: string }[] = [
  { key: "songCount", label: "Songs" },
  { key: "duration", label: "Duration" },
  { key: "owner", label: "Owner" },
  { key: "created", label: "Created" },
];

interface PlaylistsListToolbarProps {
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
  
  // Column visibility (optional, only for list view)
  columnVisibility?: PlaylistColumnVisibility;
  onColumnVisibilityChange?: (visibility: PlaylistColumnVisibility) => void;
  
  // Optional: hide certain controls
  showFilter?: boolean;
  showSort?: boolean;
  showViewMode?: boolean;
  showColumns?: boolean;
}

export function PlaylistsListToolbar({
  filter,
  onFilterChange,
  filterPlaceholder = "Filter playlists...",
  sortConfig,
  onSortChange,
  viewMode,
  onViewModeChange,
  columnVisibility,
  onColumnVisibilityChange,
  showFilter = true,
  showSort = true,
  showViewMode = true,
  showColumns = true,
}: PlaylistsListToolbarProps) {
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

  const handleColumnToggle = (key: keyof PlaylistColumnVisibility) => {
    if (!columnVisibility || !onColumnVisibilityChange) return;
    onColumnVisibilityChange({
      ...columnVisibility,
      [key]: !columnVisibility[key],
    });
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
            aria-label="Filter playlists"
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
            {playlistSortOptions.map((option) => (
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
      {showColumns && viewMode === "list" && columnVisibility && onColumnVisibilityChange && (
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
            {playlistColumnOptions.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.key}
                checked={columnVisibility[option.key]}
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
