"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Album } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import { MediaRow, RowActions, RowDropdownTrigger } from "@/components/shared/media-row";
import { AlbumContextMenu, AlbumDropdownMenu } from "./album-context-menu";

interface AlbumCardProps {
  album: Album;
  onPlay?: () => void;
  className?: string;
}

export function AlbumCard({ album, onPlay, className }: AlbumCardProps) {
  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 300)
    : undefined;

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={album.name}
      subtitle={album.year ? `${album.year} • ${album.artist}` : album.artist}
      href={`/library/albums/details?id=${album.id}`}
      colorSeed={album.name}
      coverType="album"
      onPlay={onPlay}
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
  onPlay?: () => void;
  className?: string;
}

export function AlbumCardCompact({ album, onPlay, className }: AlbumCardCompactProps) {
  const [isStarred, setIsStarred] = useState(!!album.starred);
  
  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 80)
    : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ albumId: album.id });
        setIsStarred(false);
        toast.success(`Removed from favorites`);
      } else {
        await client.star({ albumId: album.id });
        setIsStarred(true);
        toast.success(`Added to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  return (
    <MediaRow
      coverArt={coverArtUrl}
      title={album.name}
      subtitle={album.artist}
      href={`/library/albums/details?id=${album.id}`}
      colorSeed={album.name}
      coverType="album"
      onPlay={() => onPlay?.()}
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
