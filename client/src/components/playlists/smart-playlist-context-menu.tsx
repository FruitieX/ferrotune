"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  Save,
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
import { SmartPlaylistDialog } from "./smart-playlist-dialog";
import { parsePlaylistPath } from "@/lib/utils/playlist-folders";
import type { SmartPlaylistInfo } from "@/lib/api/generated/SmartPlaylistInfo";

// Get display name for a smart playlist (last part of path)
function getSmartPlaylistDisplayName(smartPlaylist: SmartPlaylistInfo): string {
  return (
    parsePlaylistPath(smartPlaylist.name).displayName || smartPlaylist.name
  );
}

interface SmartPlaylistContextMenuProps {
  smartPlaylist: SmartPlaylistInfo;
  children: React.ReactNode;
}

export function SmartPlaylistContextMenu({
  smartPlaylist,
  children,
}: SmartPlaylistContextMenuProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch playlist folders for the "Move to" menu
  const { data: playlistFoldersData } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
  });

  // Get all folders as a flat list for the menu
  const allFolders = playlistFoldersData?.folders ?? [];

  // Move smart playlist mutation
  const moveSmartPlaylist = useMutation({
    mutationFn: async (targetFolderId: string | null) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      await client.updateSmartPlaylist(smartPlaylist.id, {
        name: null,
        comment: null,
        isPublic: null,
        rules: null,
        sortField: null,
        sortDirection: null,
        maxSongs: undefined,
        folderId: targetFolderId, // Use actual folder ID
      });

      const targetFolder = allFolders.find((f) => f.id === targetFolderId);
      return { targetFolderId, targetFolderName: targetFolder?.name ?? "root" };
    },
    onSuccess: ({ targetFolderId, targetFolderName }) => {
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      if (targetFolderId) {
        toast.success(`Moved "${smartPlaylist.name}" to ${targetFolderName}`);
      } else {
        toast.success(`Moved "${smartPlaylist.name}" to root`);
      }
    },
    onError: (error) => {
      toast.error("Failed to move smart playlist", {
        description: String(error),
      });
    },
  });

  // Materialize (save as regular playlist) mutation
  const materializePlaylist = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.materializeSmartPlaylist(smartPlaylist.id);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      toast.success(
        `Created playlist "${result.name}" with ${result.songCount} songs`,
      );
      router.push(`/playlists/details?id=${result.playlistId}`);
    },
    onError: (error) => {
      toast.error("Failed to save as playlist", {
        description: String(error),
      });
    },
  });

  const handlePlay = () => {
    startQueue({
      sourceType: "smartPlaylist",
      sourceId: smartPlaylist.id,
      sourceName: getSmartPlaylistDisplayName(smartPlaylist),
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${smartPlaylist.name}"`);
  };

  const handleShuffle = () => {
    startQueue({
      sourceType: "smartPlaylist",
      sourceId: smartPlaylist.id,
      sourceName: getSmartPlaylistDisplayName(smartPlaylist),
      startIndex: 0,
      shuffle: true,
    });
    toast.success(`Shuffling "${smartPlaylist.name}"`);
  };

  const handlePlayNext = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getSmartPlaylistSongs(smartPlaylist.id);
      if (response.songs?.length > 0) {
        const result = await addToQueue({
          songIds: response.songs.map((s) => s.id),
          position: "next",
        });
        if (result.success) {
          toast.success(`Added "${smartPlaylist.name}" to play next`);
        } else {
          toast.error("Failed to add to queue");
        }
      } else {
        toast.error("Smart playlist has no matching songs");
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
      const response = await client.getSmartPlaylistSongs(smartPlaylist.id);
      if (response.songs?.length > 0) {
        const result = await addToQueue({
          songIds: response.songs.map((s) => s.id),
          position: "end",
        });
        if (result.success) {
          toast.success(`Added "${smartPlaylist.name}" to queue`);
        } else {
          toast.error("Failed to add to queue");
        }
      } else {
        toast.error("Smart playlist has no matching songs");
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
      await client.deleteSmartPlaylist(smartPlaylist.id);
      toast.success(`Deleted "${smartPlaylist.name}"`);
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      setDeleteDialogOpen(false);
      router.push("/playlists");
    } catch (error) {
      toast.error("Failed to delete smart playlist");
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
            onClick={() => moveSmartPlaylist.mutate(null)}
            disabled={!smartPlaylist.folderId || moveSmartPlaylist.isPending}
          >
            <Home className="w-4 h-4 mr-2" />
            Root
            {!smartPlaylist.folderId && (
              <span className="ml-auto text-xs text-muted-foreground">
                Current
              </span>
            )}
          </ContextMenuItem>
          {allFolders.length > 0 && <ContextMenuSeparator />}
          {/* Folder options */}
          {allFolders.map((folder) => (
            <ContextMenuItem
              key={folder.id}
              onClick={() => moveSmartPlaylist.mutate(folder.id)}
              disabled={
                smartPlaylist.folderId === folder.id ||
                moveSmartPlaylist.isPending
              }
            >
              <Folder className="w-4 h-4 mr-2" />
              <span className="truncate">{folder.name}</span>
              {smartPlaylist.folderId === folder.id && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Current
                </span>
              )}
            </ContextMenuItem>
          ))}
          {allFolders.length === 0 && smartPlaylist.folderId && (
            <ContextMenuItem disabled className="text-muted-foreground text-xs">
              No other folders
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        onClick={() => materializePlaylist.mutate()}
        disabled={materializePlaylist.isPending}
      >
        <Save className="w-4 h-4 mr-2" />
        {materializePlaylist.isPending ? "Saving..." : "Save as Playlist"}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => setEditDialogOpen(true)}>
        <Pencil className="w-4 h-4 mr-2" />
        Edit Playlist
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => setDeleteDialogOpen(true)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Delete
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

      <SmartPlaylistDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editPlaylist={smartPlaylist}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Smart Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{smartPlaylist.name}&quot;?
              This action cannot be undone.
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
export function SmartPlaylistDropdownMenu({
  smartPlaylist,
  inline = false,
}: {
  smartPlaylist: SmartPlaylistInfo;
  inline?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch playlist folders for the "Move to" menu
  const { data: playlistFoldersData } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
  });

  // Get all folders as a flat list for the menu
  const allFolders = playlistFoldersData?.folders ?? [];

  // Move smart playlist mutation
  const moveSmartPlaylist = useMutation({
    mutationFn: async (targetFolderId: string | null) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      await client.updateSmartPlaylist(smartPlaylist.id, {
        name: null,
        comment: null,
        isPublic: null,
        rules: null,
        sortField: null,
        sortDirection: null,
        maxSongs: undefined,
        folderId: targetFolderId, // Use actual folder ID
      });

      const targetFolder = allFolders.find((f) => f.id === targetFolderId);
      return { targetFolderId, targetFolderName: targetFolder?.name ?? "root" };
    },
    onSuccess: ({ targetFolderId, targetFolderName }) => {
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      if (targetFolderId) {
        toast.success(`Moved "${smartPlaylist.name}" to ${targetFolderName}`);
      } else {
        toast.success(`Moved "${smartPlaylist.name}" to root`);
      }
    },
    onError: (error) => {
      toast.error("Failed to move smart playlist", {
        description: String(error),
      });
    },
  });

  // Materialize (save as regular playlist) mutation
  const materializePlaylist = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.materializeSmartPlaylist(smartPlaylist.id);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      toast.success(
        `Created playlist "${result.name}" with ${result.songCount} songs`,
      );
      router.push(`/playlists/details?id=${result.playlistId}`);
    },
    onError: (error) => {
      toast.error("Failed to save as playlist", {
        description: String(error),
      });
    },
  });

  const handlePlay = () => {
    startQueue({
      sourceType: "smartPlaylist",
      sourceId: smartPlaylist.id,
      sourceName: getSmartPlaylistDisplayName(smartPlaylist),
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${smartPlaylist.name}"`);
  };

  const handleShuffle = () => {
    startQueue({
      sourceType: "smartPlaylist",
      sourceId: smartPlaylist.id,
      sourceName: getSmartPlaylistDisplayName(smartPlaylist),
      startIndex: 0,
      shuffle: true,
    });
    toast.success(`Shuffling "${smartPlaylist.name}"`);
  };

  const handlePlayNext = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const response = await client.getSmartPlaylistSongs(smartPlaylist.id);
      if (response.songs?.length > 0) {
        const result = await addToQueue({
          songIds: response.songs.map((s) => s.id),
          position: "next",
        });
        if (result.success) {
          toast.success(`Added "${smartPlaylist.name}" to play next`);
        } else {
          toast.error("Failed to add to queue");
        }
      } else {
        toast.error("Smart playlist has no matching songs");
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
      const response = await client.getSmartPlaylistSongs(smartPlaylist.id);
      if (response.songs?.length > 0) {
        const result = await addToQueue({
          songIds: response.songs.map((s) => s.id),
          position: "end",
        });
        if (result.success) {
          toast.success(`Added "${smartPlaylist.name}" to queue`);
        } else {
          toast.error("Failed to add to queue");
        }
      } else {
        toast.error("Smart playlist has no matching songs");
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
      await client.deleteSmartPlaylist(smartPlaylist.id);
      toast.success(`Deleted "${smartPlaylist.name}"`);
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      setDeleteDialogOpen(false);
      router.push("/playlists");
    } catch (error) {
      toast.error("Failed to delete smart playlist");
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
                ? "h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity mr-3"
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
                onClick={() => moveSmartPlaylist.mutate(null)}
                disabled={
                  !smartPlaylist.folderId || moveSmartPlaylist.isPending
                }
              >
                <Home className="w-4 h-4 mr-2" />
                Root
                {!smartPlaylist.folderId && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Current
                  </span>
                )}
              </DropdownMenuItem>
              {allFolders.length > 0 && <DropdownMenuSeparator />}
              {/* Folder options */}
              {allFolders.map((folder) => (
                <DropdownMenuItem
                  key={folder.id}
                  onClick={() => moveSmartPlaylist.mutate(folder.id)}
                  disabled={
                    smartPlaylist.folderId === folder.id ||
                    moveSmartPlaylist.isPending
                  }
                >
                  <Folder className="w-4 h-4 mr-2" />
                  <span className="truncate">{folder.name}</span>
                  {smartPlaylist.folderId === folder.id && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Current
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              {allFolders.length === 0 && smartPlaylist.folderId && (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground text-xs"
                >
                  No other folders
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onClick={() => materializePlaylist.mutate()}
            disabled={materializePlaylist.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {materializePlaylist.isPending ? "Saving..." : "Save as Playlist"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit Playlist
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setDeleteDialogOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SmartPlaylistDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editPlaylist={smartPlaylist}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Smart Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{smartPlaylist.name}&quot;?
              This action cannot be undone.
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
