"use client";

import Link from "next/link";
import {
  Play,
  ListPlus,
  ListEnd,
  Heart,
  Shuffle,
  User,
  FolderPlus,
  MoreHorizontal,
  Info,
} from "lucide-react";
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
import { useAlbumActions } from "@/lib/hooks/use-album-actions";
import type { Album } from "@/lib/api/types";

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

  const menuItems = (
    <>
      <ContextMenuItem onClick={handlePlay}>
        <Play className="w-4 h-4 mr-2" />
        Play
      </ContextMenuItem>
      <ContextMenuItem onClick={handleShuffle}>
        <Shuffle className="w-4 h-4 mr-2" />
        Shuffle
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handlePlayNext}>
        <ListPlus className="w-4 h-4 mr-2" />
        Play Next
      </ContextMenuItem>
      <ContextMenuItem onClick={handleAddToQueue}>
        <ListEnd className="w-4 h-4 mr-2" />
        Add to Queue
      </ContextMenuItem>
      <ContextMenuItem onClick={handleAddToPlaylist}>
        <FolderPlus className="w-4 h-4 mr-2" />
        Add to Playlist
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={toggleStar}>
        <Heart
          className={`w-4 h-4 mr-2 ${isStarred ? "fill-red-500 text-red-500" : ""}`}
        />
        {isStarred ? "Remove from Favorites" : "Add to Favorites"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem asChild>
        <Link href={`/library/artists/details?id=${album.artistId}`}>
          <User className="w-4 h-4 mr-2" />
          Go to Artist
        </Link>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => setDetailsOpen(true)}>
        <Info className="w-4 h-4 mr-2" />
        View Details
      </ContextMenuItem>
    </>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {menuItems}
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
          <DropdownMenuItem onClick={handlePlay}>
            <Play className="w-4 h-4 mr-2" />
            Play
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleShuffle}>
            <Shuffle className="w-4 h-4 mr-2" />
            Shuffle
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handlePlayNext}>
            <ListPlus className="w-4 h-4 mr-2" />
            Play Next
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAddToQueue}>
            <ListEnd className="w-4 h-4 mr-2" />
            Add to Queue
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAddToPlaylist}>
            <FolderPlus className="w-4 h-4 mr-2" />
            Add to Playlist
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleStar}>
            <Heart
              className={`w-4 h-4 mr-2 ${isStarred ? "fill-red-500 text-red-500" : ""}`}
            />
            {isStarred ? "Remove from Favorites" : "Add to Favorites"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/library/artists/details?id=${album.artistId}`}>
              <User className="w-4 h-4 mr-2" />
              Go to Artist
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
            <Info className="w-4 h-4 mr-2" />
            View Details
          </DropdownMenuItem>
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
