"use client";

import {
  ResponsiveContextMenu,
  ResponsiveDropdownMenu,
} from "@/components/shared/responsive-context-menu";
import { Button } from "@/components/ui/button";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { DetailsDialog } from "@/components/shared/details-dialog";
import {
  AlbumMenuItems,
  type MenuComponents,
} from "@/components/shared/media-menu-items";
import { useAlbumActions } from "@/lib/hooks/use-album-actions";
import type { Album } from "@/lib/api/types";
import { MoreHorizontal } from "lucide-react";
import { getClient } from "@/lib/api/client";

interface AlbumContextMenuProps {
  album: Album;
  children: React.ReactNode;
}

export function AlbumContextMenu({ album, children }: AlbumContextMenuProps) {
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
    albumSongs,
    detailsOpen,
    setDetailsOpen,
  } = useAlbumActions(album);

  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, "small")
    : undefined;

  const renderMenuContent = (components: MenuComponents) => (
    <AlbumMenuItems
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
      album={{ artistId: album.artistId }}
    />
  );

  return (
    <>
      <ResponsiveContextMenu
        renderMenuContent={renderMenuContent}
        drawerTitle={album.name}
        drawerSubtitle={album.artist}
        drawerThumbnail={coverArtUrl ?? undefined}
      >
        {children}
      </ResponsiveContextMenu>
      {albumSongs && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songs={albumSongs}
        />
      )}
      <DetailsDialog
        item={{ type: "album", data: album }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

// Dropdown variant for album cards
interface AlbumDropdownMenuProps {
  album: Album;
  onPlay?: () => void;
  trigger?: React.ReactNode;
}

export function AlbumDropdownMenu({
  album,
  onPlay,
  trigger,
}: AlbumDropdownMenuProps) {
  const {
    isStarred,
    toggleStar,
    handlePlay: hookHandlePlay,
    handleShuffle,
    handlePlayNext,
    handleAddToQueue,
    handleAddToPlaylist,
    addToPlaylistOpen,
    setAddToPlaylistOpen,
    albumSongs,
    detailsOpen,
    setDetailsOpen,
  } = useAlbumActions(album);

  // Use custom onPlay if provided, otherwise use hook's handlePlay
  const handlePlay = onPlay ?? hookHandlePlay;

  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, "small")
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
    <AlbumMenuItems
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
      album={{ artistId: album.artistId }}
    />
  );

  return (
    <>
      <ResponsiveDropdownMenu
        trigger={trigger ?? defaultTrigger}
        renderMenuContent={renderMenuContent}
        drawerTitle={album.name}
        drawerSubtitle={album.artist}
        drawerThumbnail={coverArtUrl ?? undefined}
      />
      {albumSongs && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songs={albumSongs}
        />
      )}
      <DetailsDialog
        item={{ type: "album", data: album }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}
