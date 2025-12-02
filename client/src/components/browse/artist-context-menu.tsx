"use client";

import { useState } from "react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
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
import { playNowAtom, addToQueueAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import type { Artist, Song } from "@/lib/api/types";

interface ArtistContextMenuProps {
  artist: Artist;
  children: React.ReactNode;
}

// Helper function to fetch all songs from an artist
async function fetchArtistSongs(artistId: string): Promise<Song[]> {
  const client = getClient();
  if (!client) return [];
  
  try {
    const artistData = await client.getArtist(artistId);
    if (!artistData.artist.album?.length) return [];
    
    // Get songs from all albums
    const allSongs: Song[] = [];
    for (const album of artistData.artist.album) {
      const albumData = await client.getAlbum(album.id);
      if (albumData.album.song) {
        allSongs.push(...albumData.album.song);
      }
    }
    return allSongs;
  } catch (error) {
    console.error("Failed to fetch artist songs:", error);
    return [];
  }
}

export function ArtistContextMenu({ artist, children }: ArtistContextMenuProps) {
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [isStarred, setIsStarred] = useState(!!artist.starred);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [artistSongs, setArtistSongs] = useState<Song[] | null>(null);

  const handlePlay = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      playNow(songs);
      toast.success(`Playing "${artist.name}"`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleShuffle = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      toast.success(`Shuffling "${artist.name}"`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handlePlayNext = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      addToQueue(songs, "next");
      toast.success(`Added "${artist.name}" songs to play next`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      addToQueue(songs, "last");
      toast.success(`Added "${artist.name}" songs to queue`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleAddToPlaylist = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      setArtistSongs(songs);
      setAddToPlaylistOpen(true);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ artistId: artist.id });
        setIsStarred(false);
        toast.success(`Removed "${artist.name}" from favorites`);
      } else {
        await client.star({ artistId: artist.id });
        setIsStarred(true);
        toast.success(`Added "${artist.name}" to favorites`);
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

export function ArtistDropdownMenu({ artist, onPlay, onShuffle, trigger }: ArtistDropdownMenuProps) {
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [isStarred, setIsStarred] = useState(!!artist.starred);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [artistSongs, setArtistSongs] = useState<Song[] | null>(null);

  const handlePlay = async () => {
    if (onPlay) {
      onPlay();
    } else {
      const songs = await fetchArtistSongs(artist.id);
      if (songs.length > 0) {
        playNow(songs);
        toast.success(`Playing "${artist.name}"`);
      } else {
        toast.error("No songs found for this artist");
      }
    }
  };

  const handleShuffle = async () => {
    if (onShuffle) {
      onShuffle();
    } else {
      const songs = await fetchArtistSongs(artist.id);
      if (songs.length > 0) {
        const shuffled = [...songs].sort(() => Math.random() - 0.5);
        playNow(shuffled);
        toast.success(`Shuffling "${artist.name}"`);
      } else {
        toast.error("No songs found for this artist");
      }
    }
  };

  const handlePlayNext = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      addToQueue(songs, "next");
      toast.success(`Added "${artist.name}" songs to play next`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      addToQueue(songs, "last");
      toast.success(`Added "${artist.name}" songs to queue`);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleAddToPlaylist = async () => {
    const songs = await fetchArtistSongs(artist.id);
    if (songs.length > 0) {
      setArtistSongs(songs);
      setAddToPlaylistOpen(true);
    } else {
      toast.error("No songs found for this artist");
    }
  };

  const handleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ artistId: artist.id });
        setIsStarred(false);
        toast.success(`Removed "${artist.name}" from favorites`);
      } else {
        await client.star({ artistId: artist.id });
        setIsStarred(true);
        toast.success(`Added "${artist.name}" to favorites`);
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
export function useArtistStar(initialStarred: boolean, artistId: string, artistName: string) {
  const [isStarred, setIsStarred] = useState(initialStarred);

  const handleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ artistId });
        setIsStarred(false);
        toast.success(`Removed "${artistName}" from favorites`);
      } else {
        await client.star({ artistId });
        setIsStarred(true);
        toast.success(`Added "${artistName}" to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  return { isStarred, handleStar, setIsStarred };
}
