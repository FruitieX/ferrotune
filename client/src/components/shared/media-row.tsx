"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { Play, Pause, Heart, MoreHorizontal, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CoverImage } from "@/components/shared/cover-image";

// Shared row container styles
export const rowContainerStyles = cn(
  "group flex items-center gap-4 px-4 pr-6 py-2 rounded-md",
  "hover:bg-accent/70 transition-all cursor-pointer",
  "border-l-2 border-transparent hover:border-primary"
);

// Shared action button styles
export const rowActionButtonStyles = "h-8 w-8";

// Shared actions container styles
export const rowActionsContainerStyles = cn(
  "flex items-center gap-1",
  "opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
);

interface MediaRowProps {
  /** Cover art URL */
  coverArt?: string;
  /** Primary text (title) */
  title: string;
  /** Secondary text (subtitle) - simple string */
  subtitle?: string;
  /** Custom subtitle content (overrides subtitle) - for complex subtitles with links */
  subtitleContent?: React.ReactNode;
  /** Navigation link */
  href?: string;
  /** Cover art shape */
  coverShape?: "square" | "circle";
  /** Cover art color seed for placeholder */
  colorSeed?: string;
  /** Cover art type for placeholder icon */
  coverType?: "album" | "artist" | "song" | "playlist" | "genre";
  /** Whether this row is currently active/selected */
  isActive?: boolean;
  /** Whether this row is currently playing (shows pause icon) */
  isPlaying?: boolean;
  /** Whether this row is selected in multi-select mode */
  isSelected?: boolean;
  /** Whether any items are selected (enables selection mode UI) */
  isSelectionMode?: boolean;
  /** Content to show on the left side before cover art (e.g., track number) */
  leftContent?: React.ReactNode;
  /** Row index for displaying row number when no leftContent */
  index?: number;
  /** Called when play button on cover art is clicked */
  onPlay?: () => void;
  /** Called when checkbox is clicked for selection */
  onSelect?: (e: React.MouseEvent) => void;
  /** Actions to render on the right side (use RowActions component) */
  actions?: React.ReactNode;
  /** Additional content after actions (e.g., duration) */
  rightContent?: React.ReactNode;
  /** Context menu wrapper */
  contextMenu?: (children: React.ReactNode) => React.ReactNode;
  /** Called on double-click */
  onDoubleClick?: () => void;
  /** Additional class names */
  className?: string;
  /** Children to render as main content (overrides title/subtitle) */
  children?: React.ReactNode;
}

/**
 * Base component for media list rows (albums, artists, songs in compact/list view).
 * Provides consistent layout, hover states, and navigation behavior.
 */
export function MediaRow({
  coverArt,
  title,
  subtitle,
  subtitleContent,
  href,
  coverShape = "square",
  colorSeed,
  coverType = "album",
  isActive,
  isPlaying,
  isSelected,
  isSelectionMode,
  leftContent,
  index,
  onPlay,
  onSelect,
  actions,
  rightContent,
  contextMenu,
  onDoubleClick,
  className,
  children,
}: MediaRowProps) {
  // Index column with checkbox on hover (when onSelect is provided and no custom leftContent)
  const showIndexColumn = onSelect && index !== undefined && !leftContent;
  
  const indexColumn = showIndexColumn ? (
    <div 
      className="w-8 text-center shrink-0 relative cursor-pointer"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(e);
      }}
    >
      {/* Checkbox - shows when selected or on hover in selection mode */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity",
          isSelected || isSelectionMode
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select item ${index + 1}`}
          className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
            isSelected
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/50 hover:border-primary/50"
          )}
        >
          {isSelected && <Check className="w-3 h-3" />}
        </button>
      </div>
      {/* Index number - hidden when checkbox is visible */}
      <span
        className={cn(
          "text-sm tabular-nums text-muted-foreground transition-opacity",
          isActive && "text-primary",
          (isSelected || isSelectionMode) 
            ? "opacity-0 pointer-events-none" 
            : "group-hover:opacity-0 group-hover:pointer-events-none"
        )}
      >
        {index + 1}
      </span>
    </div>
  ) : null;
  const coverArtElement = (
    <div
      className={cn(
        "group/cover relative w-10 h-10 overflow-hidden shrink-0",
        coverShape === "circle" ? "rounded-full" : "rounded"
      )}
    >
      <CoverImage
        src={coverArt}
        alt={title}
        colorSeed={colorSeed ?? title}
        type={coverType}
        size="sm"
        className={coverShape === "circle" ? "rounded-full" : undefined}
      />
      {/* Play button overlay on cover art - only shows on cover hover */}
      {onPlay && (
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity",
            "cursor-pointer",
            coverShape === "circle" && "rounded-full"
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlay();
          }}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 text-white" />
          ) : (
            <Play className="w-4 h-4 ml-0.5 text-white" />
          )}
        </button>
      )}
    </div>
  );

  const mainContent = children ?? (
    <div className="min-w-0 flex-1">
      <p
        className={cn(
          "font-medium text-sm truncate",
          isActive && "text-primary"
        )}
      >
        {href ? (
          <Link
            href={href}
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </p>
      {(subtitleContent || subtitle) && (
        <div className="text-xs text-muted-foreground truncate">
          {subtitleContent ?? subtitle}
        </div>
      )}
    </div>
  );

  const rowContent = (
    <div
      className={cn(
        rowContainerStyles,
        "media-row",
        isActive && "bg-accent/30",
        isSelected && "bg-primary/15 border-primary",
        className
      )}
      onDoubleClick={onDoubleClick}
    >
      {/* Index column with checkbox (when onSelect provided) */}
      {indexColumn}
      
      {/* Left content (e.g., custom track number / now playing indicator) */}
      {leftContent}

      {/* Cover art and content */}
      <div className="flex items-center gap-4 flex-1 min-w-0">
        {href ? (
          <Link href={href} onClick={(e) => e.stopPropagation()}>
            {coverArtElement}
          </Link>
        ) : (
          coverArtElement
        )}
        {mainContent}
      </div>

      {/* Actions */}
      {actions}

      {/* Right content (e.g., duration) */}
      {rightContent}
    </div>
  );

  if (contextMenu) {
    return contextMenu(rowContent);
  }

  return rowContent;
}

interface RowActionsProps {
  /** Called when star button is clicked */
  onStar?: (e: React.MouseEvent) => void;
  /** Whether the item is starred */
  isStarred?: boolean;
  /** Dropdown menu component (should accept inline trigger) */
  dropdownMenu?: React.ReactNode;
  /** Additional actions to render before the dropdown */
  children?: React.ReactNode;
}

/**
 * Standard action buttons for media rows.
 * Button order: Dropdown → Custom children → Star (heart on right)
 * Note: Play button is now on cover art overlay, not in actions.
 * The star button is always visible when starred, otherwise shows on hover.
 */
export function RowActions({
  onStar,
  isStarred,
  dropdownMenu,
  children,
}: RowActionsProps) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Actions that only show on hover */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        {dropdownMenu}
        {children}
      </div>
      {/* Star button - always visible when starred, otherwise on hover */}
      {onStar && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={isStarred ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isStarred}
          className={cn(
            rowActionButtonStyles,
            !isStarred && "opacity-0 group-hover:opacity-100 transition-opacity"
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStar(e);
          }}
        >
          <Heart
            className={cn(
              "w-4 h-4",
              isStarred && "fill-red-500 text-red-500"
            )}
          />
        </Button>
      )}
    </div>
  );
}

/**
 * Inline dropdown trigger button for use in RowActions.
 * Use this to pass as the `trigger` prop to dropdown menus in row contexts.
 * Uses forwardRef to work with Radix UI's asChild prop.
 */
export const RowDropdownTrigger = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button>
>(function RowDropdownTrigger(props, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={rowActionButtonStyles}
      onClick={(e) => {
        e.stopPropagation();
      }}
      {...props}
    >
      <MoreHorizontal className="w-4 h-4" />
      <span className="sr-only">More options</span>
    </Button>
  );
});

/**
 * Skeleton loader for MediaRow
 */
export function MediaRowSkeleton({
  coverShape = "square",
  showCover = true,
  showIndex = false,
  showLeftContent = false,
  showRightContent = false,
}: {
  coverShape?: "square" | "circle";
  /** Show cover art skeleton (default: true) */
  showCover?: boolean;
  /** Show skeleton for index/track number column */
  showIndex?: boolean;
  /** Show skeleton for left content (e.g., custom left content) - deprecated, use showIndex */
  showLeftContent?: boolean;
  /** Show skeleton for right content (e.g., duration) */
  showRightContent?: boolean;
}) {
  const showIndexColumn = showIndex || showLeftContent;
  
  return (
    <div className="flex items-center gap-4 px-4 pr-6 py-2">
      {/* Index/track number skeleton */}
      {showIndexColumn && (
        <div className="w-8 text-center shrink-0">
          <Skeleton className="h-4 w-4 mx-auto" />
        </div>
      )}
      {/* Cover art skeleton */}
      {showCover && (
        <Skeleton
          className={cn(
            "w-10 h-10 shrink-0",
            coverShape === "circle" ? "rounded-full" : "rounded"
          )}
        />
      )}
      {/* Title and subtitle skeleton */}
      <div className="min-w-0 flex-1 space-y-1">
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="h-3 w-32 max-w-[80%]" />
      </div>
      {/* Right content skeleton */}
      {showRightContent && (
        <Skeleton className="h-4 w-10 shrink-0" />
      )}
    </div>
  );
}
