"use client";

import { useState } from "react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
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
import { playNowAtom, addToQueueAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import type { Album, Song } from "@/lib/api/types";

interface AlbumContextMenuProps {
  album: Album;
  children: React.ReactNode;
}

export function AlbumContextMenu({ album, children }: AlbumContextMenuProps) {
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [isStarred, setIsStarred] = useState(!!album.starred);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [albumSongs, setAlbumSongs] = useState<Song[] | null>(null);

  const fetchSongs = async () => {
    const client = getClient();
    if (!client) return null;
    try {
      const response = await client.getAlbum(album.id);
      return response.album.song ?? [];
    } catch (error) {
      console.error("Failed to fetch album songs:", error);
      return null;
    }
  };

  const handlePlay = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      playNow(songs);
      toast.success(`Playing "${album.name}"`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleShuffle = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      toast.success(`Shuffling "${album.name}"`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handlePlayNext = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      addToQueue(songs, "next");
      toast.success(`Added "${album.name}" to play next`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      addToQueue(songs, "last");
      toast.success(`Added "${album.name}" to queue`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleAddToPlaylist = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      setAlbumSongs(songs);
      setAddToPlaylistOpen(true);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ albumId: album.id });
        setIsStarred(false);
        toast.success(`Removed "${album.name}" from favorites`);
      } else {
        await client.star({ albumId: album.id });
        setIsStarred(true);
        toast.success(`Added "${album.name}" to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

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
      <ContextMenuItem onClick={handleStar}>
        <Heart className={`w-4 h-4 mr-2 ${isStarred ? "fill-red-500 text-red-500" : ""}`} />
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
        <ContextMenuContent className="w-56">{menuItems}</ContextMenuContent>
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

export function AlbumDropdownMenu({ album, onPlay, trigger }: AlbumDropdownMenuProps) {
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [isStarred, setIsStarred] = useState(!!album.starred);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [albumSongs, setAlbumSongs] = useState<Song[] | null>(null);

  const fetchSongs = async () => {
    const client = getClient();
    if (!client) return null;
    try {
      const response = await client.getAlbum(album.id);
      return response.album.song ?? [];
    } catch (error) {
      console.error("Failed to fetch album songs:", error);
      return null;
    }
  };

  const handlePlay = async () => {
    if (onPlay) {
      onPlay();
    } else {
      const songs = await fetchSongs();
      if (songs && songs.length > 0) {
        playNow(songs);
        toast.success(`Playing "${album.name}"`);
      } else {
        toast.error("No songs in this album");
      }
    }
  };

  const handleShuffle = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      toast.success(`Shuffling "${album.name}"`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handlePlayNext = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      addToQueue(songs, "next");
      toast.success(`Added "${album.name}" to play next`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      addToQueue(songs, "last");
      toast.success(`Added "${album.name}" to queue`);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleAddToPlaylist = async () => {
    const songs = await fetchSongs();
    if (songs && songs.length > 0) {
      setAlbumSongs(songs);
      setAddToPlaylistOpen(true);
    } else {
      toast.error("No songs in this album");
    }
  };

  const handleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ albumId: album.id });
        setIsStarred(false);
        toast.success(`Removed "${album.name}" from favorites`);
      } else {
        await client.star({ albumId: album.id });
        setIsStarred(true);
        toast.success(`Added "${album.name}" to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 bg-background/80 hover:bg-background"
      onClick={(e) => {
        e.preventDefault();
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
        <DropdownMenuContent align="end" className="w-56">
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
          <DropdownMenuItem onClick={handleStar}>
            <Heart className={`w-4 h-4 mr-2 ${isStarred ? "fill-red-500 text-red-500" : ""}`} />
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
