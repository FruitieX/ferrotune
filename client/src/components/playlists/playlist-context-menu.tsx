"use client";

import { useState } from "react";
import { useSetAtom } from "jotai";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Play,
  ListPlus,
  ListEnd,
  Pencil,
  Trash2,
  MoreHorizontal,
  Shuffle,
  FolderInput,
  Folder,
  Home,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { startQueueAtom, addToQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { EditPlaylistDialog } from "./edit-playlist-dialog";
import {
  getPlaylistDisplayName,
  getUniqueFolderPaths,
  parsePlaylistPath,
} from "@/lib/utils/playlist-folders";
import type { Playlist } from "@/lib/api/types";

interface PlaylistContextMenuProps {
  playlist: Playlist;
  children: React.ReactNode;
}

export function PlaylistContextMenu({
  playlist,
  children,
}: PlaylistContextMenuProps) {
  const queryClient = useQueryClient();
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Get current folder path for this playlist
  const { folderPath: currentFolderPath } = parsePlaylistPath(playlist.name);
  const currentFolder = currentFolderPath.join("/");

  // Fetch all playlists to get available folders
  const { data: allPlaylists } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
  });

  // Get unique folder paths from all playlists
  const folderPaths = allPlaylists ? getUniqueFolderPaths(allPlaylists) : [];

  // Move playlist mutation
  const movePlaylist = useMutation({
    mutationFn: async (targetFolder: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const displayName = getPlaylistDisplayName(playlist);
      const newName = targetFolder
        ? `${targetFolder}/${displayName}`
        : displayName;

      await client.updatePlaylist({ playlistId: playlist.id, name: newName });
      return { displayName, targetFolder };
    },
    onSuccess: ({ displayName, targetFolder }) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      if (targetFolder) {
        toast.success(`Moved "${displayName}" to ${targetFolder}`);
      } else {
        toast.success(`Moved "${displayName}" to root`);
      }
    },
    onError: (error) => {
      toast.error("Failed to move playlist", { description: String(error) });
    },
  });

  const handlePlay = () => {
    startQueue({
      sourceType: "playlist",
      sourceId: playlist.id,
      sourceName: getPlaylistDisplayName(playlist),
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${playlist.name}"`);
  };

  const handleShuffle = () => {
    startQueue({
      sourceType: "playlist",
      sourceId: playlist.id,
      sourceName: getPlaylistDisplayName(playlist),
      startIndex: 0,
      shuffle: true,
    });
    toast.success(`Shuffling "${playlist.name}"`);
  };

  const handlePlayNext = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        addToQueue({
          songIds: response.playlist.entry.map((s) => s.id),
          position: "next",
        });
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
        addToQueue({
          songIds: response.playlist.entry.map((s) => s.id),
          position: "end",
        });
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
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <FolderInput className="w-4 h-4 mr-2" />
          Move to
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-48">
          {/* Move to root option */}
          <ContextMenuItem
            onClick={() => movePlaylist.mutate("")}
            disabled={currentFolder === "" || movePlaylist.isPending}
          >
            <Home className="w-4 h-4 mr-2" />
            Root
            {currentFolder === "" && (
              <span className="ml-auto text-xs text-muted-foreground">
                Current
              </span>
            )}
          </ContextMenuItem>
          {folderPaths.length > 0 && <ContextMenuSeparator />}
          {/* Folder options */}
          {folderPaths.map((folderPath) => (
            <ContextMenuItem
              key={folderPath}
              onClick={() => movePlaylist.mutate(folderPath)}
              disabled={currentFolder === folderPath || movePlaylist.isPending}
            >
              <Folder className="w-4 h-4 mr-2" />
              <span className="truncate">{folderPath}</span>
              {currentFolder === folderPath && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Current
                </span>
              )}
            </ContextMenuItem>
          ))}
          {folderPaths.length === 0 && currentFolder !== "" && (
            <ContextMenuItem disabled className="text-muted-foreground text-xs">
              No other folders
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
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
        <ContextMenuContent
          className="w-56"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {menuItems}
        </ContextMenuContent>
      </ContextMenu>

      <EditPlaylistDialog
        playlist={{ ...playlist, comment: playlist.comment ?? undefined }}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{playlist.name}&quot;? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
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
export function PlaylistDropdownMenu({
  playlist,
  inline = false,
}: {
  playlist: Playlist;
  inline?: boolean;
}) {
  const queryClient = useQueryClient();
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Get current folder path for this playlist
  const { folderPath: currentFolderPath } = parsePlaylistPath(playlist.name);
  const currentFolder = currentFolderPath.join("/");

  // Fetch all playlists to get available folders
  const { data: allPlaylists } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
  });

  // Get unique folder paths from all playlists
  const folderPaths = allPlaylists ? getUniqueFolderPaths(allPlaylists) : [];

  // Move playlist mutation
  const movePlaylist = useMutation({
    mutationFn: async (targetFolder: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const displayName = getPlaylistDisplayName(playlist);
      const newName = targetFolder
        ? `${targetFolder}/${displayName}`
        : displayName;

      await client.updatePlaylist({ playlistId: playlist.id, name: newName });
      return { displayName, targetFolder };
    },
    onSuccess: ({ displayName, targetFolder }) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      if (targetFolder) {
        toast.success(`Moved "${displayName}" to ${targetFolder}`);
      } else {
        toast.success(`Moved "${displayName}" to root`);
      }
    },
    onError: (error) => {
      toast.error("Failed to move playlist", { description: String(error) });
    },
  });

  const handlePlay = () => {
    startQueue({
      sourceType: "playlist",
      sourceId: playlist.id,
      sourceName: getPlaylistDisplayName(playlist),
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${playlist.name}"`);
  };

  const handleShuffle = () => {
    startQueue({
      sourceType: "playlist",
      sourceId: playlist.id,
      sourceName: getPlaylistDisplayName(playlist),
      startIndex: 0,
      shuffle: true,
    });
    toast.success(`Shuffling "${playlist.name}"`);
  };

  const handlePlayNext = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getPlaylist(playlist.id);
      if (response.playlist.entry?.length > 0) {
        addToQueue({
          songIds: response.playlist.entry.map((s) => s.id),
          position: "next",
        });
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
        addToQueue({
          songIds: response.playlist.entry.map((s) => s.id),
          position: "end",
        });
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
            className={
              inline
                ? "h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                : "h-8 w-8 absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <MoreHorizontal className="w-4 h-4" />
            <span className="sr-only">More options</span>
          </Button>
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
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="w-4 h-4 mr-2" />
              Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              {/* Move to root option */}
              <DropdownMenuItem
                onClick={() => movePlaylist.mutate("")}
                disabled={currentFolder === "" || movePlaylist.isPending}
              >
                <Home className="w-4 h-4 mr-2" />
                Root
                {currentFolder === "" && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Current
                  </span>
                )}
              </DropdownMenuItem>
              {folderPaths.length > 0 && <DropdownMenuSeparator />}
              {/* Folder options */}
              {folderPaths.map((folderPath) => (
                <DropdownMenuItem
                  key={folderPath}
                  onClick={() => movePlaylist.mutate(folderPath)}
                  disabled={
                    currentFolder === folderPath || movePlaylist.isPending
                  }
                >
                  <Folder className="w-4 h-4 mr-2" />
                  <span className="truncate">{folderPath}</span>
                  {currentFolder === folderPath && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Current
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              {folderPaths.length === 0 && currentFolder !== "" && (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground text-xs"
                >
                  No other folders
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
        playlist={{ ...playlist, comment: playlist.comment ?? undefined }}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{playlist.name}&quot;? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
