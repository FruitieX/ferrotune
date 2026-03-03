"use client";

import Link from "next/link";
import { Disc, Heart, HeartOff } from "lucide-react";
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
import { formatDuration, formatDate } from "@/lib/utils/format";

interface AlbumCardProps {
  album: Album;
  onPlay?: (id: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
  className?: string;
  titleIcon?: React.ReactNode;
}

const defaultAlbumIcon = (
  <Disc className="w-4 h-4 shrink-0 text-muted-foreground" />
);

export function AlbumCard({
  album,
  onPlay,
  isSelected,
  isSelectionMode,
  onSelect,
  className,
  titleIcon = defaultAlbumIcon,
}: AlbumCardProps) {
  const { isStarred, toggleStar } = useStarredAlbum(album.id, !!album.starred);

  // Use inline thumbnail if available, otherwise construct URL for fetching
  const coverArtUrl =
    album.coverArt && !album.coverArtData
      ? getClient()?.getCoverArtUrl(album.coverArt, "medium")
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
        prefetch={false}
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
      coverArtData={album.coverArtData}
      title={album.name}
      titleIcon={titleIcon}
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
  showGenre?: boolean;
  showStarred?: boolean;
  showRating?: boolean;
  showDateAdded?: boolean;
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
  showGenre = false,
  showStarred = false,
  showRating = false,
  showDateAdded = false,
}: AlbumCardCompactProps) {
  const { isStarred, toggleStar } = useStarredAlbum(album.id, !!album.starred);

  // Use inline thumbnail if available, otherwise construct URL for fetching
  const coverArtUrl =
    album.coverArt && !album.coverArtData
      ? getClient()?.getCoverArtUrl(album.coverArt, "small")
      : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleStar();
  };

  // Build metadata columns
  const metadataColumns = [];
  if (showStarred) {
    metadataColumns.push(
      <span key="starred" className="w-8 text-center shrink-0">
        {isStarred ? (
          <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 inline" />
        ) : (
          <HeartOff className="w-3.5 h-3.5 text-muted-foreground/40 inline" />
        )}
      </span>,
    );
  }
  if (showGenre) {
    metadataColumns.push(
      <span
        key="genre"
        className="text-sm text-muted-foreground w-24 text-right truncate shrink-0"
        title={album.genre ?? undefined}
      >
        {album.genre ?? "—"}
      </span>,
    );
  }
  if (showYear) {
    metadataColumns.push(
      <span
        key="year"
        className="text-sm text-muted-foreground tabular-nums w-12 text-right shrink-0"
      >
        {album.year ?? "\u2014"}
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
        className="text-sm text-muted-foreground tabular-nums w-16 text-right shrink-0"
      >
        {formatDuration(album.duration)}
      </span>,
    );
  }
  if (showRating) {
    metadataColumns.push(
      <span
        key="rating"
        className="text-sm text-muted-foreground w-12 text-right shrink-0"
      >
        {album.userRating ? "★".repeat(album.userRating) : "—"}
      </span>,
    );
  }
  if (showDateAdded) {
    metadataColumns.push(
      <span
        key="dateAdded"
        className="text-sm text-muted-foreground w-24 text-right shrink-0"
      >
        {album.created ? formatDate(album.created) : "—"}
      </span>,
    );
  }

  return (
    <MediaRow
      coverArt={coverArtUrl}
      coverArtData={album.coverArtData}
      title={album.name}
      subtitleContent={
        showArtist ? (
          <Link
            href={`/library/artists/details?id=${album.artistId}`}
            prefetch={false}
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
