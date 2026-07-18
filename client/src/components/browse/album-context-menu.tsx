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

type AlbumLike = Omit<Album, "played"> & { played?: string | null };

interface AlbumContextMenuProps {
  album: AlbumLike;
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
    albumSongIds,
    detailsOpen,
    setDetailsOpen,
    handleDownload,
    handleRemoveDownload,
    isDownloaded,
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
        handleDownload,
        handleRemoveDownload,
      }}
      state={{ isStarred, isDownloaded }}
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
      {albumSongIds && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songIds={albumSongIds}
        />
      )}
      <DetailsDialog
        item={{ type: "album", data: album as Album }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

// Dropdown variant for album cards
interface AlbumDropdownMenuProps {
  album: AlbumLike;
  onPlay?: () => void;
  trigger?: React.ReactNode;
  /** Extra content only shown in the mobile drawer (e.g., sort/view settings) */
  drawerExtraContent?: React.ReactNode;
}

export function AlbumDropdownMenu({
  album,
  onPlay,
  trigger,
  drawerExtraContent,
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
    albumSongIds,
    detailsOpen,
    setDetailsOpen,
    handleDownload,
    handleRemoveDownload,
    isDownloaded,
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
      className="h-8 w-8 bg-background/80 hover:bg-background active:bg-background"
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
        handleDownload,
        handleRemoveDownload,
      }}
      state={{ isStarred, isDownloaded }}
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
        drawerExtraContent={drawerExtraContent}
      />
      {albumSongIds && (
        <AddToPlaylistDialog
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          songIds={albumSongIds}
        />
      )}
      <DetailsDialog
        item={{ type: "album", data: album as Album }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}
