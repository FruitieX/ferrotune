"use client";

import { cn } from "@/lib/utils";
import type {
  ColumnVisibility,
  FilesColumnVisibility,
  AlbumColumnVisibility,
  ArtistColumnVisibility,
} from "@/lib/store/ui";

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
}

/**
 * Sticky header for song lists that displays column labels.
 * Column widths match SongRow's rightContent layout.
 */
export function SongListHeader({
  columnVisibility,
  showIndex = true,
  showCover = false,
  stickyTop = "72px",
  className,
}: SongListHeaderProps) {
  return (
    <div
      className={cn(
        "sticky z-10 bg-background/95 backdrop-blur-sm border-b border-border",
        "flex items-center gap-3 px-3 py-2 h-8",
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
        Title
      </div>

      {/* Actions placeholder - reserve space for action buttons on hover */}
      <div className="w-[88px] shrink-0" />

      {/* Right content columns - match SongRow widths */}
      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground shrink-0">
        {/* Shuffle exclude indicator - just takes 4px but we need gap alignment */}
        {columnVisibility.year && (
          <span className="hidden sm:inline w-12 text-right">Year</span>
        )}
        {columnVisibility.playCount && (
          <span className="hidden md:inline w-12 text-right">Plays</span>
        )}
        {columnVisibility.lastPlayed && (
          <span className="hidden lg:inline w-24 text-right">Last Played</span>
        )}
        {columnVisibility.dateAdded && (
          <span className="hidden lg:inline w-24 text-right">Added</span>
        )}
        {columnVisibility.duration && (
          <span className="w-12 text-right">Time</span>
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
        "flex items-center gap-3 px-3 py-2 h-8",
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
        "flex items-center gap-3 px-3 py-2 h-8",
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

      {/* Actions placeholder */}
      <div className="w-[88px] shrink-0" />

      {/* Right content columns - match AlbumCardCompact widths */}
      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground shrink-0">
        {columnVisibility.year && (
          <span className="hidden sm:inline w-12 text-right">Year</span>
        )}
        {columnVisibility.songCount && (
          <span className="hidden md:inline w-12 text-right">Songs</span>
        )}
        {columnVisibility.duration && (
          <span className="w-12 text-right">Time</span>
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
        "flex items-center gap-3 px-3 py-2 h-8",
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

      {/* Actions placeholder */}
      <div className="w-[88px] shrink-0" />

      {/* Right content columns - match ArtistCardCompact widths */}
      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground shrink-0">
        {columnVisibility.albumCount && (
          <span className="hidden md:inline w-12 text-right">Albums</span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Genre List Header - for genre list views (uses song columns)
// ============================================================================

export { SongListHeader as GenreListHeader };
