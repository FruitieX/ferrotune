"use client";

import Link from "next/link";
import { Play, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CoverImage } from "@/components/shared/cover-image";

interface MediaCardProps {
  /** Cover art URL */
  coverArt?: string;
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
  /** Cover art type for placeholder icon */
  coverType?: "album" | "artist" | "song" | "playlist";
  /** Called when play button is clicked */
  onPlay?: () => void;
  /** Called when star button is clicked */
  onStar?: (e: React.MouseEvent) => void;
  /** Whether the item is starred */
  isStarred?: boolean;
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
  dropdownMenu,
  contextMenu,
  withGlow = false,
  className,
}: MediaCardProps) {
  const cardContent = (
    <article
      data-testid="media-card"
      className={cn(
        "group relative p-4 rounded-lg bg-card",
        "hover:bg-accent/70 transition-all cursor-pointer",
        "hover:shadow-lg hover:shadow-black/20",
        className
      )}
    >
      {/* Dropdown menu (absolute positioned in top-right corner) */}
      {dropdownMenu && (
        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          {dropdownMenu}
        </div>
      )}

      {/* Star button (absolute positioned in bottom-right corner of cover) */}
      {onStar && (
        <div 
          className={cn(
            "absolute z-10 transition-opacity",
            // Position differently based on cover shape
            coverShape === "circle" 
              ? "bottom-16 right-4" // Above the centered text for circle
              : "bottom-16 right-4", // Bottom right of cover for square
            !isStarred && "opacity-0 group-hover:opacity-100"
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
                isStarred && "fill-red-500 text-red-500"
              )}
            />
          </Button>
        </div>
      )}

      {/* Cover art with play overlay - wrapped in Link */}
      <Link href={href} className="block group/cover">
        <div
          className={cn(
            "relative aspect-square overflow-hidden mb-4",
            "transform-gpu transition-transform duration-200 group-hover:scale-[1.05]",
            coverShape === "circle" ? "rounded-full" : "rounded-md",
            withGlow && "album-glow"
          )}
        >
          <CoverImage
            src={coverArt}
            alt={title}
            colorSeed={colorSeed ?? title}
            type={coverType}
            size="full"
            className={coverShape === "circle" ? "rounded-full" : undefined}
          />

          {/* Play button overlay - only shows on cover hover */}
          {onPlay && (
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center",
                "bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity",
                coverShape === "circle" && "rounded-full"
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

      {/* Title and subtitle - separate from cover link to avoid nested anchors */}
      <div
        className={cn(
          "space-y-1",
          coverShape === "circle" && "text-center"
        )}
      >
        <Link href={href}>
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
          coverShape === "circle" ? "rounded-full" : "rounded-md"
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
