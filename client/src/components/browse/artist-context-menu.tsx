"use client";

import {
  Play,
  ListPlus,
  ListEnd,
  Heart,
  Shuffle,
  MoreHorizontal,
  FolderPlus,
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
import { useArtistActions } from "@/lib/hooks/use-artist-actions";
import { useStar } from "@/lib/hooks/use-star";
import type { Artist } from "@/lib/api/types";

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
          <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
            <Info className="w-4 h-4 mr-2" />
            View Details
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
