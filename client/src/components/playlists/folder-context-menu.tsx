"use client";

import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Pencil,
  Trash2,
  MoreHorizontal,
  FolderPlus,
  ListPlus,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getClient } from "@/lib/api/client";
import {
  organizePlaylistsIntoFolders,
  type PlaylistFolder,
} from "@/lib/utils/playlist-folders";
import type { Playlist } from "@/lib/api/types";

interface FolderContextMenuProps {
  folder: PlaylistFolder;
  children: React.ReactNode;
  onCreateSubfolder?: (parentPath: string) => void;
  onCreatePlaylist?: (folderPath: string) => void;
}

// Get all playlists in a folder and its subfolders recursively
function getPlaylistsInFolder(folder: PlaylistFolder): Playlist[] {
  const playlists: Playlist[] = [...folder.playlists];
  for (const subfolder of folder.subfolders) {
    playlists.push(...getPlaylistsInFolder(subfolder));
  }
  return playlists;
}

export function FolderContextMenu({
  folder,
  children,
  onCreateSubfolder,
  onCreatePlaylist,
}: FolderContextMenuProps) {
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState(folder.name);

  // Get all playlists in this folder (for deletion/rename)
  const playlistsInFolder = getPlaylistsInFolder(folder);

  // Rename folder mutation (renames all playlists in the folder)
  const renameFolderMutation = useMutation({
    mutationFn: async (newName: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Calculate old and new prefixes
      const oldPrefix = folder.path;
      const pathParts = folder.path.split("/");
      pathParts[pathParts.length - 1] = newName;
      const newPrefix = pathParts.join("/");

      // Rename all playlists in the folder
      const renamePromises = playlistsInFolder.map(async (playlist) => {
        const newPlaylistName = playlist.name.replace(oldPrefix, newPrefix);
        await client.updatePlaylist({
          playlistId: playlist.id,
          name: newPlaylistName,
        });
      });

      await Promise.all(renamePromises);
      return newName;
    },
    onSuccess: (newName) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success(`Renamed folder to "${newName}"`);
      setRenameDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to rename folder", { description: String(error) });
    },
  });

  // Delete folder mutation (deletes all playlists in the folder)
  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Delete all playlists in the folder
      const deletePromises = playlistsInFolder.map(async (playlist) => {
        await client.deletePlaylist(playlist.id);
      });

      await Promise.all(deletePromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success(
        `Deleted folder "${folder.name}" and ${playlistsInFolder.length} playlist(s)`,
      );
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to delete folder", { description: String(error) });
    },
  });

  const handleRename = () => {
    if (!newFolderName.trim()) {
      toast.error("Folder name cannot be empty");
      return;
    }
    if (newFolderName.includes("/")) {
      toast.error("Folder name cannot contain /");
      return;
    }
    if (newFolderName === folder.name) {
      setRenameDialogOpen(false);
      return;
    }
    renameFolderMutation.mutate(newFolderName.trim());
  };

  const menuItems = (
    <>
      <ContextMenuItem onClick={() => onCreatePlaylist?.(folder.path)}>
        <ListPlus className="w-4 h-4 mr-2" />
        New Playlist
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onCreateSubfolder?.(folder.path)}>
        <FolderPlus className="w-4 h-4 mr-2" />
        New Subfolder
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => {
          setNewFolderName(folder.name);
          setRenameDialogOpen(true);
        }}
      >
        <Pencil className="w-4 h-4 mr-2" />
        Rename Folder
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => setDeleteDialogOpen(true)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Delete Folder
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

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              This will rename the folder and update all{" "}
              {playlistsInFolder.length} playlist(s) inside.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder Name</Label>
              <Input
                id="folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleRename();
                  }
                }}
                placeholder="Folder name"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={renameFolderMutation.isPending}
            >
              {renameFolderMutation.isPending ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{folder.name}&quot;?
              {playlistsInFolder.length > 0 && (
                <>
                  {" "}
                  This will permanently delete {playlistsInFolder.length}{" "}
                  playlist(s) and all their songs.
                </>
              )}{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteFolderMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
              disabled={deleteFolderMutation.isPending}
            >
              {deleteFolderMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Dropdown variant for mobile and click-triggered menu
interface FolderDropdownMenuProps {
  folder: PlaylistFolder;
  inline?: boolean;
  onCreateSubfolder?: (parentPath: string) => void;
  onCreatePlaylist?: (folderPath: string) => void;
}

export function FolderDropdownMenu({
  folder,
  inline = false,
  onCreateSubfolder,
  onCreatePlaylist,
}: FolderDropdownMenuProps) {
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState(folder.name);

  // Get all playlists in this folder (for deletion/rename)
  const playlistsInFolder = getPlaylistsInFolder(folder);

  // Rename folder mutation (renames all playlists in the folder)
  const renameFolderMutation = useMutation({
    mutationFn: async (newName: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Calculate old and new prefixes
      const oldPrefix = folder.path;
      const pathParts = folder.path.split("/");
      pathParts[pathParts.length - 1] = newName;
      const newPrefix = pathParts.join("/");

      // Rename all playlists in the folder
      const renamePromises = playlistsInFolder.map(async (playlist) => {
        const newPlaylistName = playlist.name.replace(oldPrefix, newPrefix);
        await client.updatePlaylist({
          playlistId: playlist.id,
          name: newPlaylistName,
        });
      });

      await Promise.all(renamePromises);
      return newName;
    },
    onSuccess: (newName) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success(`Renamed folder to "${newName}"`);
      setRenameDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to rename folder", { description: String(error) });
    },
  });

  // Delete folder mutation (deletes all playlists in the folder)
  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Delete all playlists in the folder
      const deletePromises = playlistsInFolder.map(async (playlist) => {
        await client.deletePlaylist(playlist.id);
      });

      await Promise.all(deletePromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success(
        `Deleted folder "${folder.name}" and ${playlistsInFolder.length} playlist(s)`,
      );
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to delete folder", { description: String(error) });
    },
  });

  const handleRename = () => {
    if (!newFolderName.trim()) {
      toast.error("Folder name cannot be empty");
      return;
    }
    if (newFolderName.includes("/")) {
      toast.error("Folder name cannot contain /");
      return;
    }
    if (newFolderName === folder.name) {
      setRenameDialogOpen(false);
      return;
    }
    renameFolderMutation.mutate(newFolderName.trim());
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
                : "h-8 w-8 absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
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
          <DropdownMenuItem onClick={() => onCreatePlaylist?.(folder.path)}>
            <ListPlus className="w-4 h-4 mr-2" />
            New Playlist
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCreateSubfolder?.(folder.path)}>
            <FolderPlus className="w-4 h-4 mr-2" />
            New Subfolder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setNewFolderName(folder.name);
              setRenameDialogOpen(true);
            }}
          >
            <Pencil className="w-4 h-4 mr-2" />
            Rename Folder
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setDeleteDialogOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              This will rename the folder and update all{" "}
              {playlistsInFolder.length} playlist(s) inside.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name-dropdown">Folder Name</Label>
              <Input
                id="folder-name-dropdown"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleRename();
                  }
                }}
                placeholder="Folder name"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={renameFolderMutation.isPending}
            >
              {renameFolderMutation.isPending ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{folder.name}&quot;?
              {playlistsInFolder.length > 0 && (
                <>
                  {" "}
                  This will permanently delete {playlistsInFolder.length}{" "}
                  playlist(s) and all their songs.
                </>
              )}{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteFolderMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
              disabled={deleteFolderMutation.isPending}
            >
              {deleteFolderMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
