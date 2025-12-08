"use client";

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

  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, 300)
    : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleStar();
  };

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={artist.name}
      subtitle={formatCount(artist.albumCount ?? 0, "album")}
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
}: ArtistCardCompactProps) {
  const { isStarred, toggleStar } = useStarredArtist(
    artist.id,
    !!artist.starred,
  );

  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, 80)
    : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleStar();
  };

  return (
    <MediaRow
      coverArt={coverArtUrl}
      title={artist.name}
      subtitle={
        showAlbumCount
          ? formatCount(artist.albumCount ?? 0, "album")
          : undefined
      }
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
        showAlbumCount ? (
          <span className="text-sm text-muted-foreground tabular-nums w-12 text-right shrink-0">
            {artist.albumCount}
          </span>
        ) : undefined
      }
      className={className}
    />
  );
}
