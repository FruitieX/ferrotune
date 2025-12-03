"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Artist } from "@/lib/api/types";
import { getClient } from "@/lib/api/client";
import { formatCount } from "@/lib/utils/format";
import { MediaCard, MediaCardSkeleton } from "@/components/shared/media-card";
import { MediaRow, RowActions, RowDropdownTrigger } from "@/components/shared/media-row";
import { ArtistContextMenu, ArtistDropdownMenu } from "./artist-context-menu";

interface ArtistCardProps {
  artist: Artist;
  onPlay?: () => void;
  className?: string;
}

export function ArtistCard({ artist, onPlay, className }: ArtistCardProps) {
  const [isStarred, setIsStarred] = useState(!!artist.starred);
  
  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, 300)
    : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ artistId: artist.id });
        setIsStarred(false);
        toast.success(`Removed from favorites`);
      } else {
        await client.star({ artistId: artist.id });
        setIsStarred(true);
        toast.success(`Added to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  return (
    <MediaCard
      coverArt={coverArtUrl}
      title={artist.name}
      subtitle={formatCount(artist.albumCount, "album")}
      href={`/library/artists/details?id=${artist.id}`}
      coverShape="circle"
      colorSeed={artist.name}
      coverType="artist"
      onPlay={onPlay}
      onStar={handleStar}
      isStarred={isStarred}
      dropdownMenu={<ArtistDropdownMenu artist={artist} onPlay={onPlay} />}
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
  onPlay?: () => void;
  className?: string;
}

export function ArtistCardCompact({ artist, onPlay, className }: ArtistCardCompactProps) {
  const [isStarred, setIsStarred] = useState(!!artist.starred);
  
  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, 80)
    : undefined;

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ artistId: artist.id });
        setIsStarred(false);
        toast.success(`Removed from favorites`);
      } else {
        await client.star({ artistId: artist.id });
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
      title={artist.name}
      subtitle={formatCount(artist.albumCount, "album")}
      href={`/library/artists/details?id=${artist.id}`}
      coverShape="circle"
      colorSeed={artist.name}
      coverType="artist"
      onPlay={() => onPlay?.()}
      onDoubleClick={() => onPlay?.()}
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
