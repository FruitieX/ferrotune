"use client";

import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown } from "lucide-react";
import type {
  ColumnVisibility,
  FilesColumnVisibility,
  AlbumColumnVisibility,
  ArtistColumnVisibility,
  SortField,
  SortDirection,
} from "@/lib/store/ui";

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

interface SongListHeaderProps {
  /** Column visibility settings */
  columnVisibility: ColumnVisibility;
  /** Whether to show index column */
  showIndex?: boolean;
  /** Whether to show cover art column */
  showCover?: boolean;
  /** Top offset for sticky positioning (default: 72px, use 120px for library views) */
  stickyTop?: "72px" | "120px";
  /** Additional class names */
  className?: string;
  /** Current sort config for highlighting active column */
  sortConfig?: SortConfig;
  /** Callback when a column header is clicked to sort */
  onSortChange?: (config: SortConfig) => void;
}

function SortableHeader({
  field,
  label,
  width,
  align = "right",
  sortConfig,
  onSort,
}: {
  field: SortField;
  label: string;
  width: string;
  align?: "left" | "right" | "center";
  sortConfig?: SortConfig;
  onSort: (field: SortField) => void;
}) {
  const isActive = sortConfig?.field === field;
  const SortIcon = sortConfig?.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={cn(
        width,
        align === "right" && "text-right",
        align === "center" && "text-center",
        "flex items-center gap-0.5 cursor-pointer hover:text-foreground transition-colors",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
        isActive && "text-foreground",
      )}
      onClick={() => onSort(field)}
    >
      <span>{label}</span>
      {isActive && <SortIcon className="w-3 h-3" />}
    </button>
  );
}

/**
 * Sticky header for song lists that displays column labels.
 * Column widths match SongRow's rightContent layout.
 */
export function SongListHeader({
  columnVisibility,
  showIndex: showIndexProp,
  showCover = false,
  stickyTop = "72px",
  className,
  sortConfig,
  onSortChange,
}: SongListHeaderProps) {
  const showIndex = showIndexProp ?? columnVisibility.trackNumber;
  const handleSort = (field: SortField) => {
    if (!onSortChange) return;
    if (sortConfig?.field === field) {
      onSortChange({
        field,
        direction: sortConfig.direction === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({ field, direction: "asc" });
    }
  };

  return (
    <div
      className={cn(
        "sticky z-10 bg-background/95 backdrop-blur-sm border-b border-border",
        "flex items-center gap-4 px-4 pr-6 py-2 h-8 border-l-2 border-l-transparent",
        stickyTop === "120px" ? "top-[120px]" : "top-[72px]",
        className,
      )}
    >
      {/* Index column */}
      {showIndex && (
        <div className="w-8 text-center shrink-0 text-xs font-medium text-muted-foreground">
          #
        </div>
      )}

      {/* Cover art column placeholder */}
      {showCover && <div className="w-10 h-10 shrink-0" />}

      {/* Title column - takes remaining space */}
      <div className="flex-1 min-w-0 text-xs font-medium text-muted-foreground">
        <SortableHeader
          field="name"
          label="Title"
          width=""
          align="left"
          sortConfig={sortConfig}
          onSort={handleSort}
        />
      </div>

      {/* Right content columns - match SongRow widths */}
      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground shrink-0">
        {columnVisibility.starred && (
          <SortableHeader
            field="starred"
            label="Fav"
            width="w-8"
            align="center"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.rating && (
          <SortableHeader
            field="rating"
            label="Rating"
            width="w-12"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.genre && (
          <SortableHeader
            field="genre"
            label="Genre"
            width="w-24"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.year && (
          <SortableHeader
            field="year"
            label="Year"
            width="w-12"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.playCount && (
          <SortableHeader
            field="playCount"
            label="Plays"
            width="w-12"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.lastPlayed && (
          <SortableHeader
            field="lastPlayed"
            label="Last Played"
            width="w-24"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.dateAdded && (
          <SortableHeader
            field="dateAdded"
            label="Added"
            width="w-24"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.bitRate && (
          <SortableHeader
            field="bitRate"
            label="Bitrate"
            width="w-16"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.format && (
          <SortableHeader
            field="format"
            label="Format"
            width="w-14"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
        {columnVisibility.duration && (
          <SortableHeader
            field="duration"
            label="Time"
            width="w-12"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Files List Header - for file browser view
// ============================================================================

interface FilesListHeaderProps {
  /** Column visibility settings for files */
  columnVisibility: FilesColumnVisibility;
  /** Top offset for sticky positioning (default: 72px, use 120px for library views) */
  stickyTop?: "72px" | "120px";
  /** Additional class names */
  className?: string;
}

/**
 * Sticky header for file lists that displays column labels.
 * Column widths match FileRow's layout.
 */
export function FilesListHeader({
  columnVisibility,
  stickyTop = "120px", // Files are in library layout
  className,
}: FilesListHeaderProps) {
  return (
    <div
      className={cn(
        "sticky z-10 bg-background/95 backdrop-blur-sm border-b border-border",
        "flex items-center gap-4 px-4 pr-6 py-2 h-8 border-l-2 border-l-transparent",
        stickyTop === "120px" ? "top-[120px]" : "top-[72px]",
        className,
      )}
    >
      {/* Selection checkbox placeholder */}
      <div className="w-5 shrink-0" />

      {/* Cover art column placeholder */}
      <div className="w-10 shrink-0" />

      {/* Title column - takes remaining space */}
      <div className="flex-1 min-w-0 text-xs font-medium text-muted-foreground">
        Name
      </div>

      {/* Right content columns - match FileRow widths */}
      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground shrink-0">
        {columnVisibility.size && (
          <span className="hidden md:inline w-16 text-right">Size</span>
        )}
        {columnVisibility.duration && (
          <span className="w-12 text-right">Time</span>
        )}
        {/* Actions dropdown placeholder */}
        <div className="w-8 shrink-0" />
      </div>
    </div>
  );
}

// ============================================================================
// Album List Header - for album list views
// ============================================================================

interface AlbumListHeaderProps {
  /** Column visibility settings for albums */
  columnVisibility: AlbumColumnVisibility;
  /** Whether to show index column */
  showIndex?: boolean;
  /** Top offset for sticky positioning (default: 120px for library views) */
  stickyTop?: "72px" | "120px";
  /** Additional class names */
  className?: string;
}

/**
 * Sticky header for album lists that displays column labels.
 * Column widths match AlbumCardCompact's layout.
 */
export function AlbumListHeader({
  columnVisibility,
  showIndex = true,
  stickyTop = "120px", // Albums are in library layout
  className,
}: AlbumListHeaderProps) {
  return (
    <div
      className={cn(
        "sticky z-10 bg-background/95 backdrop-blur-sm border-b border-border",
        "flex items-center gap-4 px-4 pr-6 py-2 h-8 border-l-2 border-l-transparent",
        stickyTop === "120px" ? "top-[120px]" : "top-[72px]",
        className,
      )}
    >
      {/* Index column */}
      {showIndex && (
        <div className="w-8 text-center shrink-0 text-xs font-medium text-muted-foreground">
          #
        </div>
      )}

      {/* Cover art column placeholder */}
      <div className="w-10 shrink-0" />

      {/* Album name column - takes remaining space */}
      <div className="flex-1 min-w-0 text-xs font-medium text-muted-foreground">
        Album
      </div>

      {/* Right content columns - match AlbumCardCompact widths */}
      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground shrink-0">
        {columnVisibility.starred && (
          <span className="w-8 text-center">Fav</span>
        )}
        {columnVisibility.genre && (
          <span className="w-24 text-right">Genre</span>
        )}
        {columnVisibility.year && <span className="w-12 text-right">Year</span>}
        {columnVisibility.songCount && (
          <span className="w-12 text-right">Songs</span>
        )}
        {columnVisibility.duration && (
          <span className="w-16 text-right">Time</span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Artist List Header - for artist list views
// ============================================================================

interface ArtistListHeaderProps {
  /** Column visibility settings for artists */
  columnVisibility: ArtistColumnVisibility;
  /** Whether to show index column */
  showIndex?: boolean;
  /** Top offset for sticky positioning (default: 120px for library views) */
  stickyTop?: "72px" | "120px";
  /** Additional class names */
  className?: string;
}

/**
 * Sticky header for artist lists that displays column labels.
 * Column widths match ArtistCardCompact's layout.
 */
export function ArtistListHeader({
  columnVisibility,
  showIndex = true,
  stickyTop = "120px", // Artists are in library layout
  className,
}: ArtistListHeaderProps) {
  return (
    <div
      className={cn(
        "sticky z-10 bg-background/95 backdrop-blur-sm border-b border-border",
        "flex items-center gap-4 px-4 pr-6 py-2 h-8 border-l-2 border-l-transparent",
        stickyTop === "120px" ? "top-[120px]" : "top-[72px]",
        className,
      )}
    >
      {/* Index column */}
      {showIndex && (
        <div className="w-8 text-center shrink-0 text-xs font-medium text-muted-foreground">
          #
        </div>
      )}

      {/* Cover art column placeholder */}
      <div className="w-10 shrink-0" />

      {/* Artist name column - takes remaining space */}
      <div className="flex-1 min-w-0 text-xs font-medium text-muted-foreground">
        Artist
      </div>

      {/* Right content columns - match ArtistCardCompact widths */}
      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground shrink-0">
        {columnVisibility.starred && (
          <span className="w-8 text-center">Fav</span>
        )}
        {columnVisibility.songCount && (
          <span className="w-12 text-right">Songs</span>
        )}
        {columnVisibility.albumCount && (
          <span className="w-12 text-right">Albums</span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Genre List Header - for genre list views (uses song columns)
// ============================================================================

export { SongListHeader as GenreListHeader };
