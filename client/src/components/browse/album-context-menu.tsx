"use client";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { DetailsDialog } from "@/components/shared/details-dialog";
import {
  AlbumMenuItems,
  MenuComponents,
} from "@/components/shared/media-menu-items";
import { useAlbumActions } from "@/lib/hooks/use-album-actions";
import type { Album } from "@/lib/api/types";
import { MoreHorizontal } from "lucide-react";

// Component adapters for ContextMenu
const contextMenuComponents: MenuComponents = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
};

// Component adapters for DropdownMenu
const dropdownMenuComponents: MenuComponents = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
};

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

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <AlbumMenuItems
            components={contextMenuComponents}
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
        </ContextMenuContent>
      </ContextMenu>
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {trigger ?? defaultTrigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <AlbumMenuItems
            components={dropdownMenuComponents}
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
        </DropdownMenuContent>
      </DropdownMenu>
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
