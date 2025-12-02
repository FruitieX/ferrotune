"use client";

import Link from "next/link";
import { Play, Pause, Heart, MoreHorizontal } from "lucide-react";
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
  coverType?: "album" | "artist" | "song" | "playlist";
  /** Whether this row is currently active/selected */
  isActive?: boolean;
  /** Whether this row is currently playing (shows pause icon) */
  isPlaying?: boolean;
  /** Content to show on the left side before cover art (e.g., track number) */
  leftContent?: React.ReactNode;
  /** Called when play button on cover art is clicked */
  onPlay?: () => void;
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
  leftContent,
  onPlay,
  actions,
  rightContent,
  contextMenu,
  onDoubleClick,
  className,
  children,
}: MediaRowProps) {
  const coverArtElement = (
    <div
      className={cn(
        "relative w-10 h-10 overflow-hidden shrink-0",
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
      {/* Play button overlay on cover art - entire area is clickable */}
      {onPlay && (
        <button
          type="button"
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity",
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
      {href ? (
        <Link href={href} className="block" onClick={(e) => e.stopPropagation()}>
          <p
            className={cn(
              "font-medium text-sm truncate hover:underline",
              isActive && "text-primary"
            )}
          >
            {title}
          </p>
        </Link>
      ) : (
        <p
          className={cn(
            "font-medium text-sm truncate",
            isActive && "text-primary"
          )}
        >
          {title}
        </p>
      )}
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
        isActive && "bg-accent/30",
        className
      )}
      onDoubleClick={onDoubleClick}
    >
      {/* Left content (e.g., track number) */}
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
 * Button order: Star → Custom children → Dropdown
 * Note: Play button is now on cover art overlay, not in actions.
 */
export function RowActions({
  onStar,
  isStarred,
  dropdownMenu,
  children,
}: RowActionsProps) {
  return (
    <div className={rowActionsContainerStyles}>
      {onStar && (
        <Button
          variant="ghost"
          size="icon"
          className={rowActionButtonStyles}
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
      {children}
      {dropdownMenu}
    </div>
  );
}

/**
 * Inline dropdown trigger button for use in RowActions.
 * Use this to pass as the `trigger` prop to dropdown menus in row contexts.
 */
export function RowDropdownTrigger() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={rowActionButtonStyles}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <MoreHorizontal className="w-4 h-4" />
      <span className="sr-only">More options</span>
    </Button>
  );
}

/**
 * Skeleton loader for MediaRow
 */
export function MediaRowSkeleton({
  coverShape = "square",
  showCover = true,
  showLeftContent = false,
  showRightContent = false,
}: {
  coverShape?: "square" | "circle";
  /** Show cover art skeleton (default: true) */
  showCover?: boolean;
  /** Show skeleton for left content (e.g., track number) */
  showLeftContent?: boolean;
  /** Show skeleton for right content (e.g., duration) */
  showRightContent?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 px-4 pr-6 py-2">
      {/* Left content skeleton */}
      {showLeftContent && (
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
