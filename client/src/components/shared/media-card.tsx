"use client";

import Link from "next/link";
import { Play, Heart, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CoverImage } from "@/components/shared/cover-image";

interface MediaCardProps {
  /** Cover art URL */
  coverArt?: string;
  /** Inline base64 thumbnail data (pre-fetched from API response) - takes priority over coverArt */
  coverArtData?: string | null;
  /** Primary text (title) */
  title: string;
  /** Secondary text (subtitle) - simple string */
  subtitle?: string;
  /** Custom subtitle content (overrides subtitle) - for complex subtitles with links */
  subtitleContent?: React.ReactNode;
  /** Navigation link */
  href: string;
  /** Cover art shape */
  coverShape?: "square" | "circle";
  /** Cover art color seed for placeholder */
  colorSeed?: string;
  coverType?: "album" | "artist" | "song" | "playlist" | "smartPlaylist";
  /** Called when play button is clicked */
  onPlay?: () => void;
  /** Called when star button is clicked */
  onStar?: (e: React.MouseEvent) => void;
  /** Whether the item is starred */
  isStarred?: boolean;
  /** Whether this card is selected in multi-select mode */
  isSelected?: boolean;
  /** Whether any items are selected (enables selection mode UI) */
  isSelectionMode?: boolean;
  /** Called when checkbox is clicked for selection */
  onSelect?: (e: React.MouseEvent) => void;
  /** Dropdown menu component (will be positioned absolutely in top-right) */
  dropdownMenu?: React.ReactNode;
  /** Context menu wrapper */
  contextMenu?: (children: React.ReactNode) => React.ReactNode;
  /** Whether to apply album glow effect */
  withGlow?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * Base component for media grid cards (albums, artists in card view).
 * Provides consistent layout, hover states, play overlay, and navigation behavior.
 */
export function MediaCard({
  coverArt,
  coverArtData,
  title,
  subtitle,
  subtitleContent,
  href,
  coverShape = "square",
  colorSeed,
  coverType = "album",
  onPlay,
  onStar,
  isStarred,
  isSelected,
  isSelectionMode,
  onSelect,
  dropdownMenu,
  contextMenu,
  withGlow = false,
  className,
}: MediaCardProps) {
  const cardContent = (
    <article
      data-testid="media-card"
      className={cn(
        "group relative p-4 rounded-lg bg-card media-card",
        "hover:bg-accent/70 transition-all cursor-pointer",
        "hover:shadow-lg hover:shadow-black/20",
        isSelected && "ring-2 ring-primary bg-primary/10",
        className,
      )}
    >
      {/* Cover art container - relative positioning for buttons outside overflow-hidden */}
      <div className="relative mb-4">
        {/* Selection checkbox (top-left corner of cover art) - outside overflow-hidden */}
        {onSelect && (
          <div
            className={cn(
              "absolute top-1 left-1 z-20 transition-opacity",
              isSelected || isSelectionMode
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
            )}
          >
            <button
              type="button"
              className={cn(
                "w-6 h-6 rounded border-2 flex items-center justify-center transition-all",
                "bg-black/50 hover:bg-black/70",
                isSelected
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-white/80 hover:border-primary/80",
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(e);
              }}
            >
              {isSelected && <Check className="w-4 h-4" />}
            </button>
          </div>
        )}

        {/* Dropdown menu (top-right corner of cover art) - outside overflow-hidden */}
        {dropdownMenu && (
          <div className="absolute top-1 right-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
            {dropdownMenu}
          </div>
        )}

        {/* Star button (bottom-right corner of cover art) - outside overflow-hidden */}
        {onStar && (
          <div
            className={cn(
              "absolute bottom-1 right-1 z-20 transition-opacity",
              !isStarred && "opacity-0 group-hover:opacity-100",
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-black/50 hover:bg-black/70 text-white"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onStar(e);
              }}
            >
              <Heart
                className={cn(
                  "w-4 h-4",
                  isStarred && "fill-red-500 text-red-500",
                )}
              />
            </Button>
          </div>
        )}

        {/* Cover art with play overlay - wrapped in Link */}
        <Link href={href} prefetch={false} className="block group/cover">
          <div
            className={cn(
              "relative aspect-square overflow-hidden",
              "transform-gpu transition-transform duration-200 group-hover:scale-[1.05]",
              coverShape === "circle" ? "rounded-full" : "rounded-md",
              withGlow && "album-glow",
            )}
          >
            <CoverImage
              src={coverArt}
              inlineData={coverArtData}
              alt={title}
              colorSeed={colorSeed ?? title}
              type={coverType}
              size="full"
              className={coverShape === "circle" ? "rounded-full" : undefined}
              showTypeOverlay={coverType === "smartPlaylist"}
            />

            {/* Play button overlay - only shows on cover hover */}
            {onPlay && (
              <div
                className={cn(
                  "absolute inset-0 flex items-center justify-center",
                  "bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity",
                  coverShape === "circle" && "rounded-full",
                )}
              >
                <Button
                  size="icon"
                  className="h-12 w-12 rounded-full shadow-lg"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPlay();
                  }}
                >
                  <Play className="w-6 h-6 ml-0.5" />
                </Button>
              </div>
            )}
          </div>
        </Link>
      </div>

      {/* Title and subtitle - separate from cover link to avoid nested anchors */}
      <div
        className={cn("space-y-1", coverShape === "circle" && "text-center")}
      >
        <Link href={href} prefetch={false}>
          <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {title}
          </h3>
        </Link>
        {(subtitleContent || subtitle) && (
          <div className="text-sm text-muted-foreground truncate">
            {subtitleContent ?? subtitle}
          </div>
        )}
      </div>
    </article>
  );

  if (contextMenu) {
    return contextMenu(cardContent);
  }

  return cardContent;
}

/**
 * Skeleton loader for MediaCard
 */
export function MediaCardSkeleton({
  coverShape = "square",
}: {
  coverShape?: "square" | "circle";
}) {
  return (
    <div className="p-4 rounded-lg bg-card">
      <Skeleton
        className={cn(
          "aspect-square mb-4",
          coverShape === "circle" ? "rounded-full" : "rounded-md",
        )}
      />
      <div
        className={cn("space-y-2", coverShape === "circle" && "text-center")}
      >
        <Skeleton
          className={cn("h-5 w-3/4", coverShape === "circle" && "mx-auto")}
        />
        <Skeleton
          className={cn("h-4 w-1/2", coverShape === "circle" && "mx-auto")}
        />
      </div>
    </div>
  );
}
