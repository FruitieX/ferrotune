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
import { getClient } from "@/lib/api/client";
import { EditFolderDialog } from "@/components/playlists/edit-folder-dialog";
import { type PlaylistFolder } from "@/lib/utils/playlist-folders";
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

// Get all descendant folder IDs (including the folder itself)
function getDescendantFolderIds(folder: PlaylistFolder): Set<string> {
  const ids = new Set<string>();
  if (folder.id) {
    ids.add(folder.id);
  }
  for (const subfolder of folder.subfolders) {
    for (const id of getDescendantFolderIds(subfolder)) {
      ids.add(id);
    }
  }
  return ids;
}

export function FolderContextMenu({
  folder,
  children,
  onCreateSubfolder,
  onCreatePlaylist,
}: FolderContextMenuProps) {
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Get all playlists in this folder (for deletion)
  const playlistsInFolder = getPlaylistsInFolder(folder);

  // Get all descendant folder IDs (folders that cannot be move targets)
  const descendantIds = getDescendantFolderIds(folder);

  // Fetch folder structure from API for "Move to" menu
  const { data: foldersData } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
  });

  const allFolders = foldersData?.folders ?? [];

  // Filter out folders that cannot be move targets (self and descendants)
  const availableFolders = allFolders.filter((f) => !descendantIds.has(f.id));

  // Move folder mutation
  const moveFolderMutation = useMutation({
    mutationFn: async (targetParentId: string | null) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      if (!folder.id) throw new Error("Cannot move folder without ID");
      await client.movePlaylistFolder(folder.id, targetParentId);
      return { targetParentId };
    },
    onSuccess: ({ targetParentId }) => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      const targetFolder = allFolders.find((f) => f.id === targetParentId);
      if (targetParentId && targetFolder) {
        toast.success(`Moved "${folder.name}" to ${targetFolder.name}`);
      } else {
        toast.success(`Moved "${folder.name}" to root`);
      }
    },
    onError: (error) => {
      toast.error("Failed to move folder", { description: String(error) });
    },
  });

  // Delete folder mutation (deletes folder and all playlists in it)
  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // If folder has a database ID, delete it via API
      if (folder.id) {
        await client.deletePlaylistFolder(folder.id);
      } else {
        // Legacy: delete all playlists in the folder
        const deletePromises = playlistsInFolder.map(async (playlist) => {
          await client.deletePlaylist(playlist.id);
        });
        await Promise.all(deletePromises);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      toast.success(
        `Deleted folder "${folder.name}" and ${playlistsInFolder.length} playlist(s)`,
      );
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to delete folder", { description: String(error) });
    },
  });

  // Current parent folder ID
  const currentParentId = folder.parentId ?? null;

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
      {folder.id && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="w-4 h-4 mr-2" />
            Move to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            {/* Move to root option */}
            <ContextMenuItem
              onClick={() => moveFolderMutation.mutate(null)}
              disabled={
                currentParentId === null || moveFolderMutation.isPending
              }
            >
              <Home className="w-4 h-4 mr-2" />
              Root
              {currentParentId === null && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Current
                </span>
              )}
            </ContextMenuItem>
            {availableFolders.length > 0 && <ContextMenuSeparator />}
            {/* Folder options */}
            {availableFolders.map((targetFolder) => (
              <ContextMenuItem
                key={targetFolder.id}
                onClick={() => moveFolderMutation.mutate(targetFolder.id)}
                disabled={
                  currentParentId === targetFolder.id ||
                  moveFolderMutation.isPending
                }
              >
                <Folder className="w-4 h-4 mr-2" />
                <span className="truncate">{targetFolder.name}</span>
                {currentParentId === targetFolder.id && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Current
                  </span>
                )}
              </ContextMenuItem>
            ))}
            {availableFolders.length === 0 && currentParentId != null && (
              <ContextMenuItem
                disabled
                className="text-muted-foreground text-xs"
              >
                No available folders
              </ContextMenuItem>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuItem onClick={() => setEditDialogOpen(true)}>
        <Pencil className="w-4 h-4 mr-2" />
        Edit Folder
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

      {/* Edit Folder Dialog */}
      <EditFolderDialog
        folder={folder}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

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
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Get all playlists in this folder (for deletion)
  const playlistsInFolder = getPlaylistsInFolder(folder);

  // Get all descendant folder IDs (folders that cannot be move targets)
  const descendantIds = getDescendantFolderIds(folder);

  // Fetch folder structure from API for "Move to" menu
  const { data: foldersData } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
  });

  const allFolders = foldersData?.folders ?? [];

  // Filter out folders that cannot be move targets (self and descendants)
  const availableFolders = allFolders.filter((f) => !descendantIds.has(f.id));

  // Move folder mutation
  const moveFolderMutation = useMutation({
    mutationFn: async (targetParentId: string | null) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      if (!folder.id) throw new Error("Cannot move folder without ID");
      await client.movePlaylistFolder(folder.id, targetParentId);
      return { targetParentId };
    },
    onSuccess: ({ targetParentId }) => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      const targetFolder = allFolders.find((f) => f.id === targetParentId);
      if (targetParentId && targetFolder) {
        toast.success(`Moved "${folder.name}" to ${targetFolder.name}`);
      } else {
        toast.success(`Moved "${folder.name}" to root`);
      }
    },
    onError: (error) => {
      toast.error("Failed to move folder", { description: String(error) });
    },
  });

  // Delete folder mutation (deletes folder and all playlists in it)
  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // If folder has a database ID, delete it via API
      if (folder.id) {
        await client.deletePlaylistFolder(folder.id);
      } else {
        // Legacy: delete all playlists in the folder
        const deletePromises = playlistsInFolder.map(async (playlist) => {
          await client.deletePlaylist(playlist.id);
        });
        await Promise.all(deletePromises);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      toast.success(
        `Deleted folder "${folder.name}" and ${playlistsInFolder.length} playlist(s)`,
      );
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to delete folder", { description: String(error) });
    },
  });

  // Current parent folder ID
  const currentParentId = folder.parentId ?? null;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={
              inline
                ? "h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                : "h-8 w-8 absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity"
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
          onClick={(e) => e.stopPropagation()}
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
          {folder.id && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="w-4 h-4 mr-2" />
                Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {/* Move to root option */}
                <DropdownMenuItem
                  onClick={() => moveFolderMutation.mutate(null)}
                  disabled={
                    currentParentId === null || moveFolderMutation.isPending
                  }
                >
                  <Home className="w-4 h-4 mr-2" />
                  Root
                  {currentParentId === null && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Current
                    </span>
                  )}
                </DropdownMenuItem>
                {availableFolders.length > 0 && <DropdownMenuSeparator />}
                {/* Folder options */}
                {availableFolders.map((targetFolder) => (
                  <DropdownMenuItem
                    key={targetFolder.id}
                    onClick={() => moveFolderMutation.mutate(targetFolder.id)}
                    disabled={
                      currentParentId === targetFolder.id ||
                      moveFolderMutation.isPending
                    }
                  >
                    <Folder className="w-4 h-4 mr-2" />
                    <span className="truncate">{targetFolder.name}</span>
                    {currentParentId === targetFolder.id && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        Current
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
                {availableFolders.length === 0 && currentParentId != null && (
                  <DropdownMenuItem
                    disabled
                    className="text-muted-foreground text-xs"
                  >
                    No available folders
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit Folder
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

      {/* Edit Folder Dialog */}
      <EditFolderDialog
        folder={folder}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
}
