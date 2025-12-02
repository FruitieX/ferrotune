"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Play,
  ListPlus,
  ListEnd,
  Pencil,
  Trash2,
  MoreHorizontal,
  Shuffle,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { playNowAtom, addToQueueAtom } from "@/lib/store/queue";
import { getClient } from "@/lib/api/client";
import { EditPlaylistDialog } from "./edit-playlist-dialog";
import type { Playlist } from "@/lib/api/types";

interface PlaylistContextMenuProps {
  playlist: Playlist;
  children: React.ReactNode;
}

export function PlaylistContextMenu({ playlist, children }: PlaylistContextMenuProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handlePlay = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        playNow(response.playlist.entry);
        toast.success(`Playing "${playlist.name}"`);
      } else {
        toast.error("Playlist is empty");
      }
    } catch (error) {
      toast.error("Failed to play playlist");
      console.error(error);
    }
  };

  const handleShuffle = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        const shuffled = [...response.playlist.entry].sort(() => Math.random() - 0.5);
        playNow(shuffled);
        toast.success(`Shuffling "${playlist.name}"`);
      } else {
        toast.error("Playlist is empty");
      }
    } catch (error) {
      toast.error("Failed to shuffle playlist");
      console.error(error);
    }
  };

  const handlePlayNext = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        addToQueue(response.playlist.entry, "next");
        toast.success(`Added "${playlist.name}" to play next`);
      } else {
        toast.error("Playlist is empty");
      }
    } catch (error) {
      toast.error("Failed to add to queue");
      console.error(error);
    }
  };

  const handleAddToQueue = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        addToQueue(response.playlist.entry, "last");
        toast.success(`Added "${playlist.name}" to queue`);
      } else {
        toast.error("Playlist is empty");
      }
    } catch (error) {
      toast.error("Failed to add to queue");
      console.error(error);
    }
  };

  const handleDelete = async () => {
    const client = getClient();
    if (!client) return;

    try {
      await client.deletePlaylist(playlist.id);
      toast.success(`Deleted "${playlist.name}"`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      setDeleteDialogOpen(false);
    } catch (error) {
      toast.error("Failed to delete playlist");
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
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => setEditDialogOpen(true)}>
        <Pencil className="w-4 h-4 mr-2" />
        Edit Playlist
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => setDeleteDialogOpen(true)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Delete Playlist
      </ContextMenuItem>
    </>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56" onDoubleClick={(e) => e.stopPropagation()}>{menuItems}</ContextMenuContent>
      </ContextMenu>

      <EditPlaylistDialog
        playlist={playlist}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{playlist.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Dropdown variant for mobile and click-triggered menu
export function PlaylistDropdownMenu({ playlist }: { playlist: Playlist }) {
  const queryClient = useQueryClient();
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handlePlay = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        playNow(response.playlist.entry);
        toast.success(`Playing "${playlist.name}"`);
      } else {
        toast.error("Playlist is empty");
      }
    } catch (error) {
      toast.error("Failed to play playlist");
      console.error(error);
    }
  };

  const handleShuffle = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        const shuffled = [...response.playlist.entry].sort(() => Math.random() - 0.5);
        playNow(shuffled);
        toast.success(`Shuffling "${playlist.name}"`);
      } else {
        toast.error("Playlist is empty");
      }
    } catch (error) {
      toast.error("Failed to shuffle playlist");
      console.error(error);
    }
  };

  const handlePlayNext = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        addToQueue(response.playlist.entry, "next");
        toast.success(`Added "${playlist.name}" to play next`);
      } else {
        toast.error("Playlist is empty");
      }
    } catch (error) {
      toast.error("Failed to add to queue");
      console.error(error);
    }
  };

  const handleAddToQueue = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        addToQueue(response.playlist.entry, "last");
        toast.success(`Added "${playlist.name}" to queue`);
      } else {
        toast.error("Playlist is empty");
      }
    } catch (error) {
      toast.error("Failed to add to queue");
      console.error(error);
    }
  };

  const handleDelete = async () => {
    const client = getClient();
    if (!client) return;

    try {
      await client.deletePlaylist(playlist.id);
      toast.success(`Deleted "${playlist.name}"`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      setDeleteDialogOpen(false);
    } catch (error) {
      toast.error("Failed to delete playlist");
      console.error(error);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <MoreHorizontal className="w-4 h-4" />
            <span className="sr-only">More options</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onDoubleClick={(e) => e.stopPropagation()}>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit Playlist
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setDeleteDialogOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Playlist
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditPlaylistDialog
        playlist={playlist}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{playlist.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
