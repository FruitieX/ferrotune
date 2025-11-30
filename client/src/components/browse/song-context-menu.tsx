"use client";

import { useState } from "react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  Play,
  ListPlus,
  ListEnd,
  Heart,
  Star,
  Download,
  MoreHorizontal,
  User,
  Disc,
  FolderPlus,
  Info,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AddToPlaylistDialog } from "@/components/playlists/add-to-playlist-dialog";
import { DetailsDialog } from "@/components/shared/details-dialog";
import { playNowAtom, addToQueueAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import Link from "next/link";

interface SongContextMenuProps {
  song: Song;
  children: React.ReactNode;
  queueSongs?: Song[];
}

export function SongContextMenu({ song, children, queueSongs }: SongContextMenuProps) {
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [isStarred, setIsStarred] = useState(!!song.starred);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handlePlay = () => {
    if (queueSongs && queueSongs.length > 0) {
      const index = queueSongs.findIndex((s) => s.id === song.id);
      playNow(queueSongs, index >= 0 ? index : 0);
    } else {
      playNow(song);
    }
  };

  const handlePlayNext = () => {
    addToQueue(song, "next");
    toast.success(`Added "${song.title}" to play next`);
  };

  const handleAddToQueue = () => {
    addToQueue(song, "last");
    toast.success(`Added "${song.title}" to queue`);
  };

  const handleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ id: song.id });
        setIsStarred(false);
        toast.success(`Removed "${song.title}" from favorites`);
      } else {
        await client.star({ id: song.id });
        setIsStarred(true);
        toast.success(`Added "${song.title}" to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  const handleRate = async (rating: number) => {
    const client = getClient();
    if (!client) return;

    try {
      await client.setRating(song.id, rating);
      toast.success(rating > 0 ? `Rated "${song.title}" ${rating} stars` : `Removed rating from "${song.title}"`);
    } catch (error) {
      toast.error("Failed to set rating");
      console.error(error);
    }
  };

  const handleDownload = () => {
    const client = getClient();
    if (!client) return;

    const downloadUrl = client.getDownloadUrl(song.id);
    window.open(downloadUrl, "_blank");
  };

  const menuItems = (
    <>
      <ContextMenuItem onClick={handlePlay}>
        <Play className="w-4 h-4 mr-2" />
        Play
      </ContextMenuItem>
      <ContextMenuItem onClick={handlePlayNext}>
        <ListPlus className="w-4 h-4 mr-2" />
        Play Next
      </ContextMenuItem>
      <ContextMenuItem onClick={handleAddToQueue}>
        <ListEnd className="w-4 h-4 mr-2" />
        Add to Queue
      </ContextMenuItem>
      <ContextMenuItem onClick={() => setAddToPlaylistOpen(true)}>
        <FolderPlus className="w-4 h-4 mr-2" />
        Add to Playlist
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={handleStar}>
        <Heart className={`w-4 h-4 mr-2 ${isStarred ? "fill-red-500 text-red-500" : ""}`} />
        {isStarred ? "Remove from Favorites" : "Add to Favorites"}
      </ContextMenuItem>

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Star className="w-4 h-4 mr-2" />
          Rate
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {[5, 4, 3, 2, 1].map((rating) => (
            <ContextMenuItem key={rating} onClick={() => handleRate(rating)}>
              {Array.from({ length: rating }).map((_, i) => (
                <Star key={i} className="w-3 h-3 fill-yellow-500 text-yellow-500" />
              ))}
              {Array.from({ length: 5 - rating }).map((_, i) => (
                <Star key={i} className="w-3 h-3 text-muted-foreground" />
              ))}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handleRate(0)}>
            Remove Rating
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />

      <ContextMenuItem asChild>
        <Link href={`/library/artists/${song.artistId}`}>
          <User className="w-4 h-4 mr-2" />
          Go to Artist
        </Link>
      </ContextMenuItem>
      <ContextMenuItem asChild>
        <Link href={`/library/albums/${song.albumId}`}>
          <Disc className="w-4 h-4 mr-2" />
          Go to Album
        </Link>
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={handleDownload}>
        <Download className="w-4 h-4 mr-2" />
        Download
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
      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={[song]}
      />
      <DetailsDialog
        item={{ type: "song", data: song }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

// Dropdown variant for mobile and click-triggered menu
export function SongDropdownMenu({ song, queueSongs }: Omit<SongContextMenuProps, "children">) {
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [isStarred, setIsStarred] = useState(!!song.starred);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handlePlay = () => {
    if (queueSongs && queueSongs.length > 0) {
      const index = queueSongs.findIndex((s) => s.id === song.id);
      playNow(queueSongs, index >= 0 ? index : 0);
    } else {
      playNow(song);
    }
  };

  const handlePlayNext = () => {
    addToQueue(song, "next");
    toast.success(`Added "${song.title}" to play next`);
  };

  const handleAddToQueue = () => {
    addToQueue(song, "last");
    toast.success(`Added "${song.title}" to queue`);
  };

  const handleStar = async () => {
    const client = getClient();
    if (!client) return;

    try {
      if (isStarred) {
        await client.unstar({ id: song.id });
        setIsStarred(false);
        toast.success(`Removed "${song.title}" from favorites`);
      } else {
        await client.star({ id: song.id });
        setIsStarred(true);
        toast.success(`Added "${song.title}" to favorites`);
      }
    } catch (error) {
      toast.error("Failed to update favorites");
      console.error(error);
    }
  };

  const handleRate = async (rating: number) => {
    const client = getClient();
    if (!client) return;

    try {
      await client.setRating(song.id, rating);
      toast.success(rating > 0 ? `Rated "${song.title}" ${rating} stars` : `Removed rating from "${song.title}"`);
    } catch (error) {
      toast.error("Failed to set rating");
      console.error(error);
    }
  };

  const handleDownload = () => {
    const client = getClient();
    if (!client) return;

    const downloadUrl = client.getDownloadUrl(song.id);
    window.open(downloadUrl, "_blank");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="w-4 h-4" />
            <span className="sr-only">More options</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={handlePlay}>
            <Play className="w-4 h-4 mr-2" />
            Play
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePlayNext}>
            <ListPlus className="w-4 h-4 mr-2" />
            Play Next
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAddToQueue}>
            <ListEnd className="w-4 h-4 mr-2" />
            Add to Queue
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAddToPlaylistOpen(true)}>
            <FolderPlus className="w-4 h-4 mr-2" />
            Add to Playlist
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleStar}>
            <Heart className={`w-4 h-4 mr-2 ${isStarred ? "fill-red-500 text-red-500" : ""}`} />
            {isStarred ? "Remove from Favorites" : "Add to Favorites"}
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Star className="w-4 h-4 mr-2" />
              Rate
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {[5, 4, 3, 2, 1].map((rating) => (
                <DropdownMenuItem key={rating} onClick={() => handleRate(rating)}>
                  {Array.from({ length: rating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                  ))}
                  {Array.from({ length: 5 - rating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 text-muted-foreground" />
                  ))}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleRate(0)}>
                Remove Rating
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <Link href={`/library/artists/${song.artistId}`}>
              <User className="w-4 h-4 mr-2" />
              Go to Artist
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/library/albums/${song.albumId}`}>
              <Disc className="w-4 h-4 mr-2" />
              Go to Album
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
            <Info className="w-4 h-4 mr-2" />
            View Details
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onOpenChange={setAddToPlaylistOpen}
        songs={[song]}
      />
      <DetailsDialog
        item={{ type: "song", data: song }}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}
