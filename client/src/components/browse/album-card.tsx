"use client";

import Link from "next/link";
import type { Album } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { useStarredAlbum } from "@/lib/store/starred";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import {
  MediaRow,
  RowActions,
  RowDropdownTrigger,
} from "@/components/shared/media-row";
import { AlbumContextMenu, AlbumDropdownMenu } from "./album-context-menu";
import { formatDuration } from "@/lib/utils/format";
import type { AlbumColumnVisibility } from "@/lib/store/ui";

interface AlbumCardProps {
  album: Album;
  onPlay?: (id: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
  className?: string;
}

export function AlbumCard({
  album,
  onPlay,
  isSelected,
  isSelectionMode,
  onSelect,
  className,
}: AlbumCardProps) {
  const { isStarred, toggleStar } = useStarredAlbum(album.id, !!album.starred);

  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 300)
    : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleStar();
  };

  const subtitleContent = (
    <>
      {album.year && <span>{album.year} • </span>}
      <Link
        href={`/library/artists/details?id=${album.artistId}`}
        className="hover:underline hover:text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {album.artist}
      </Link>
    </>
  );

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={album.name}
      subtitleContent={subtitleContent}
      href={`/library/albums/details?id=${album.id}`}
      colorSeed={album.name}
      coverType="album"
      onPlay={onPlay ? () => onPlay(album.id) : undefined}
      onStar={handleStar}
      isStarred={isStarred}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect ? (e) => onSelect(album.id, e) : undefined}
      dropdownMenu={
        <AlbumDropdownMenu
          album={album}
          onPlay={onPlay ? () => onPlay(album.id) : undefined}
        />
      }
      contextMenu={(children) => (
        <AlbumContextMenu album={album}>{children}</AlbumContextMenu>
      )}
      withGlow
      className={className}
    />
  );
}

export function AlbumCardSkeleton() {
  return <MediaCardSkeleton coverShape="square" />;
}

// Compact album card for lists
interface AlbumCardCompactProps {
  album: Album;
  index?: number;
  onPlay?: (id: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
  className?: string;
  /** Column visibility settings */
  showArtist?: boolean;
  showYear?: boolean;
  showSongCount?: boolean;
  showDuration?: boolean;
}

export function AlbumCardCompact({
  album,
  index,
  onPlay,
  isSelected,
  isSelectionMode,
  onSelect,
  className,
  showArtist = true,
  showYear = false,
  showSongCount = false,
  showDuration = false,
}: AlbumCardCompactProps) {
  const { isStarred, toggleStar } = useStarredAlbum(album.id, !!album.starred);

  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 80)
    : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleStar();
  };

  // Build metadata columns
  const metadataColumns = [];
  if (showYear && album.year) {
    metadataColumns.push(
      <span
        key="year"
        className="text-sm text-muted-foreground tabular-nums w-12 text-right shrink-0"
      >
        {album.year}
      </span>,
    );
  }
  if (showSongCount) {
    metadataColumns.push(
      <span
        key="songs"
        className="text-sm text-muted-foreground tabular-nums w-12 text-right shrink-0"
      >
        {album.songCount}
      </span>,
    );
  }
  if (showDuration) {
    metadataColumns.push(
      <span
        key="duration"
        className="text-sm text-muted-foreground tabular-nums w-14 text-right shrink-0"
      >
        {formatDuration(album.duration)}
      </span>,
    );
  }

  return (
    <MediaRow
      coverArt={coverArtUrl}
      title={album.name}
      subtitleContent={
        showArtist ? (
          <Link
            href={`/library/artists/details?id=${album.artistId}`}
            className="hover:underline hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            {album.artist}
          </Link>
        ) : undefined
      }
      href={`/library/albums/details?id=${album.id}`}
      colorSeed={album.name}
      coverType="album"
      onPlay={onPlay ? () => onPlay(album.id) : undefined}
      onDoubleClick={onPlay ? () => onPlay(album.id) : undefined}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      index={index}
      onSelect={onSelect ? (e) => onSelect(album.id, e) : undefined}
      contextMenu={(children) => (
        <AlbumContextMenu album={album}>{children}</AlbumContextMenu>
      )}
      actions={
        <RowActions
          onStar={handleStar}
          isStarred={isStarred}
          dropdownMenu={
            <AlbumDropdownMenu
              album={album}
              onPlay={onPlay ? () => onPlay(album.id) : undefined}
              trigger={<RowDropdownTrigger />}
            />
          }
        />
      }
      rightContent={
        metadataColumns.length > 0 ? (
          <div className="flex items-center gap-4">{metadataColumns}</div>
        ) : undefined
      }
      className={className}
    />
  );
}
