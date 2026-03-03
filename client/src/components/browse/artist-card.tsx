"use client";

import { Users, Heart, HeartOff } from "lucide-react";
import type { Artist } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { useStarredArtist } from "@/lib/store/starred";
import { formatCount } from "@/lib/utils/format";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import {
  MediaRow,
  RowActions,
  RowDropdownTrigger,
} from "@/components/shared/media-row";
import { ArtistContextMenu, ArtistDropdownMenu } from "./artist-context-menu";

interface ArtistCardProps {
  artist: Artist;
  onPlay?: (id: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
  className?: string;
}

const defaultArtistIcon = (
  <Users className="w-4 h-4 shrink-0 text-muted-foreground" />
);

export function ArtistCard({
  artist,
  onPlay,
  isSelected,
  isSelectionMode,
  onSelect,
  className,
}: ArtistCardProps) {
  const { isStarred, toggleStar } = useStarredArtist(
    artist.id,
    !!artist.starred,
  );

  // Use inline thumbnail if available, otherwise construct URL for fetching
  const coverArtUrl =
    artist.coverArt && !artist.coverArtData
      ? getClient()?.getCoverArtUrl(artist.coverArt, "medium")
      : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleStar();
  };

  return (
    <MediaCard
      coverArt={coverArtUrl}
      coverArtData={artist.coverArtData}
      title={artist.name}
      titleIcon={defaultArtistIcon}
      subtitle={`${formatCount(artist.albumCount ?? 0, "album")} · ${formatCount(artist.songCount ?? 0, "song")}`}
      href={`/library/artists/details?id=${artist.id}`}
      coverShape="circle"
      colorSeed={artist.name}
      coverType="artist"
      onPlay={onPlay ? () => onPlay(artist.id) : undefined}
      onStar={handleStar}
      isStarred={isStarred}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect ? (e) => onSelect(artist.id, e) : undefined}
      dropdownMenu={
        <ArtistDropdownMenu
          artist={artist}
          onPlay={onPlay ? () => onPlay(artist.id) : undefined}
        />
      }
      contextMenu={(children) => (
        <ArtistContextMenu artist={artist}>{children}</ArtistContextMenu>
      )}
      className={className}
    />
  );
}

export function ArtistCardSkeleton() {
  return <MediaCardSkeleton coverShape="circle" />;
}

// Compact artist card for lists
interface ArtistCardCompactProps {
  artist: Artist;
  index?: number;
  onPlay?: (id: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
  className?: string;
  /** Column visibility settings */
  showAlbumCount?: boolean;
  showSongCount?: boolean;
  showStarred?: boolean;
  showRating?: boolean;
}

export function ArtistCardCompact({
  artist,
  index,
  onPlay,
  isSelected,
  isSelectionMode,
  onSelect,
  className,
  showAlbumCount = true,
  showSongCount = false,
  showStarred = false,
  showRating = false,
}: ArtistCardCompactProps) {
  const { isStarred, toggleStar } = useStarredArtist(
    artist.id,
    !!artist.starred,
  );

  // Use inline thumbnail if available, otherwise construct URL for fetching
  const coverArtUrl =
    artist.coverArt && !artist.coverArtData
      ? getClient()?.getCoverArtUrl(artist.coverArt, "small")
      : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleStar();
  };

  return (
    <MediaRow
      coverArt={coverArtUrl}
      coverArtData={artist.coverArtData}
      title={artist.name}
      subtitle={(() => {
        const parts: string[] = [];
        if (!showAlbumCount)
          parts.push(formatCount(artist.albumCount ?? 0, "album"));
        if (!showSongCount)
          parts.push(formatCount(artist.songCount ?? 0, "song"));
        return parts.length > 0 ? parts.join(" · ") : undefined;
      })()}
      href={`/library/artists/details?id=${artist.id}`}
      coverShape="circle"
      colorSeed={artist.name}
      coverType="artist"
      onPlay={onPlay ? () => onPlay(artist.id) : undefined}
      onDoubleClick={onPlay ? () => onPlay(artist.id) : undefined}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      index={index}
      onSelect={onSelect ? (e) => onSelect(artist.id, e) : undefined}
      contextMenu={(children) => (
        <ArtistContextMenu artist={artist}>{children}</ArtistContextMenu>
      )}
      actions={
        <RowActions
          onStar={handleStar}
          isStarred={isStarred}
          dropdownMenu={
            <ArtistDropdownMenu
              artist={artist}
              onPlay={onPlay ? () => onPlay(artist.id) : undefined}
              trigger={<RowDropdownTrigger />}
            />
          }
        />
      }
      rightContent={
        showAlbumCount || showSongCount || showStarred || showRating ? (
          <div className="flex items-center gap-4">
            {showStarred && (
              <span className="w-8 text-center shrink-0">
                {isStarred ? (
                  <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 inline" />
                ) : (
                  <HeartOff className="w-3.5 h-3.5 text-muted-foreground/40 inline" />
                )}
              </span>
            )}
            {showRating && (
              <span className="text-sm text-muted-foreground w-12 text-right shrink-0">
                {artist.userRating ? "★".repeat(artist.userRating) : "—"}
              </span>
            )}
            {showSongCount && (
              <span className="text-sm text-muted-foreground tabular-nums w-12 text-right shrink-0">
                {artist.songCount ?? "—"}
              </span>
            )}
            {showAlbumCount && (
              <span className="text-sm text-muted-foreground tabular-nums w-12 text-right shrink-0">
                {artist.albumCount ?? "—"}
              </span>
            )}
          </div>
        ) : undefined
      }
      className={className}
    />
  );
}
