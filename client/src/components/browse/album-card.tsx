"use client";

import Link from "next/link";
import type { Album } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { useStarredAlbum } from "@/lib/store/starred";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import { MediaRow, RowActions, RowDropdownTrigger } from "@/components/shared/media-row";
import { AlbumContextMenu, AlbumDropdownMenu } from "./album-context-menu";

interface AlbumCardProps {
  album: Album;
  onPlay?: () => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  className?: string;
}

export function AlbumCard({ album, onPlay, isSelected, isSelectionMode, onSelect, className }: AlbumCardProps) {
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
      onPlay={onPlay}
      onStar={handleStar}
      isStarred={isStarred}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect}
      dropdownMenu={<AlbumDropdownMenu album={album} onPlay={onPlay} />}
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
  onPlay?: () => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  className?: string;
}

export function AlbumCardCompact({ album, index, onPlay, isSelected, isSelectionMode, onSelect, className }: AlbumCardCompactProps) {
  const { isStarred, toggleStar } = useStarredAlbum(album.id, !!album.starred);
  
  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 80)
    : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleStar();
  };

  return (
    <MediaRow
      coverArt={coverArtUrl}
      title={album.name}
      subtitleContent={
        <Link
          href={`/library/artists/details?id=${album.artistId}`}
          className="hover:underline hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          {album.artist}
        </Link>
      }
      href={`/library/albums/details?id=${album.id}`}
      colorSeed={album.name}
      coverType="album"
      onPlay={() => onPlay?.()}
      onDoubleClick={() => onPlay?.()}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      index={index}
      onSelect={onSelect}
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
              onPlay={onPlay}
              trigger={<RowDropdownTrigger />}
            />
          }
        />
      }
      className={className}
    />
  );
}
