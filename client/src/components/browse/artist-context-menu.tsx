"use client";

import {
  ResponsiveContextMenu,
  ResponsiveDropdownMenu,
} from "@/components/shared/responsive-context-menu";
import { Button } from "@/components/ui/button";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { DetailsDialog } from "@/components/shared/details-dialog";
import {
  ArtistMenuItems,
  type MenuComponents,
} from "@/components/shared/media-menu-items";
import { useArtistActions } from "@/lib/hooks/use-artist-actions";
import { useStar } from "@/lib/hooks/use-star";
import type { Artist } from "@/lib/api/types";
import { MoreHorizontal } from "lucide-react";
import { getClient } from "@/lib/api/client";

interface ArtistContextMenuProps {
  artist: Artist;
  children: React.ReactNode;
}

export function ArtistContextMenu({
  artist,
  children,
}: ArtistContextMenuProps) {
  const {
    isStarred,
    toggleStar,
    handlePlay,
    handleShuffle,
    handlePlayNext,
    handleAddToQueue,
    handleAddToPlaylist,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    artistSongs,
    detailsOpen,
    setDetailsOpen,
  } = useArtistActions(artist);

  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, "small")
    : undefined;

  const renderMenuContent = (components: MenuComponents) => (
    <ArtistMenuItems
      components={components}
      handlers={{
        handlePlay,
        handleShuffle,
        handlePlayNext,
        handleAddToQueue,
        handleAddToPlaylist,
        toggleStar,
        setDetailsOpen,
      }}
      state={{ isStarred }}
    />
  );

  return (
    <>
      <ResponsiveContextMenu
        renderMenuContent={renderMenuContent}
        drawerTitle={artist.name}
        drawerThumbnail={coverArtUrl ?? undefined}
      >
        {children}
      </ResponsiveContextMenu>
      {artistSongs && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songs={artistSongs}
        />
      )}
      <DetailsDialog
        item={{ type: "artist", data: artist }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

// Dropdown variant for artist cards and header buttons
interface ArtistDropdownMenuProps {
  artist: Artist;
  onPlay?: () => void;
  onShuffle?: () => void;
  trigger?: React.ReactNode;
}

export function ArtistDropdownMenu({
  artist,
  onPlay,
  onShuffle,
  trigger,
}: ArtistDropdownMenuProps) {
  const {
    isStarred,
    toggleStar,
    handlePlay: hookHandlePlay,
    handleShuffle: hookHandleShuffle,
    handlePlayNext,
    handleAddToQueue,
    handleAddToPlaylist,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    artistSongs,
    detailsOpen,
    setDetailsOpen,
  } = useArtistActions(artist);

  // Use custom callbacks if provided, otherwise use hook's handlers
  const handlePlay = onPlay ?? hookHandlePlay;
  const handleShuffle = onShuffle ?? hookHandleShuffle;

  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, "small")
    : undefined;

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 bg-background/80 hover:bg-background"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <MoreHorizontal className="w-4 h-4" />
      <span className="sr-only">More options</span>
    </Button>
  );

  const renderMenuContent = (components: MenuComponents) => (
    <ArtistMenuItems
      components={components}
      handlers={{
        handlePlay,
        handleShuffle,
        handlePlayNext,
        handleAddToQueue,
        handleAddToPlaylist,
        toggleStar,
        setDetailsOpen,
      }}
      state={{ isStarred }}
    />
  );

  return (
    <>
      <ResponsiveDropdownMenu
        trigger={trigger ?? defaultTrigger}
        renderMenuContent={renderMenuContent}
        drawerTitle={artist.name}
        drawerThumbnail={coverArtUrl ?? undefined}
      />
      {artistSongs && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songs={artistSongs}
        />
      )}
      <DetailsDialog
        item={{ type: "artist", data: artist }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

// Hook to manage artist star state (for use in pages where we need external control)
// Re-exported for backward compatibility
export function useArtistStar(
  initialStarred: boolean,
  artistId: string,
  artistName: string,
) {
  const { isStarred, toggleStar, setIsStarred } = useStar({
    itemType: "artist",
    itemId: artistId,
    itemName: artistName,
    initialStarred,
  });

  return { isStarred, handleStar: toggleStar, setIsStarred };
}
