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
import { ResponsiveContextMenu } from "@/components/shared/responsive-context-menu";
import type { MenuComponents } from "@/components/shared/media-menu-items";
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
import { useHasFinePointer } from "@/lib/hooks/use-media-query";
import { EditPlaylistDialog } from "./edit-playlist-dialog";
import { getPlaylistDisplayName } from "@/lib/utils/playlist-folders";
import type { Playlist } from "@/lib/api/types";

interface PlaylistContextMenuProps {
  playlist: Playlist;
  /** Current folder ID (from API), or pass undefined to auto-detect from foldersData */
  currentFolderId?: string | null;
  /** Whether this playlist was shared with the current user (not owned) */
  sharedWithMe?: boolean;
  /** Whether the current user can edit this shared playlist */
  canEdit?: boolean;
  children: React.ReactNode;
}

export function PlaylistContextMenu({
  playlist,
  currentFolderId: externalFolderId,
  sharedWithMe = false,
  canEdit = false,
  children,
}: PlaylistContextMenuProps) {
  const isOwner = !sharedWithMe;
  const canModify = isOwner || canEdit;
  const queryClient = useQueryClient();
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch folder structure from API
  const { data: foldersData } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
  });

  const folders = foldersData?.folders ?? [];

  // Determine current folder ID - either from prop or by looking up in API data
  const currentFolderId =
    externalFolderId !== undefined
      ? externalFolderId
      : (foldersData?.playlists.find((p) => p.id === playlist.id)?.folderId ??
        null);

  // Move playlist to folder mutation using new API
  const movePlaylist = useMutation({
    mutationFn: async (targetFolderId: string | null) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.movePlaylistToFolder(playlist.id, targetFolderId);
      return { targetFolderId };
    },
    onSuccess: ({ targetFolderId }) => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      const displayName = getPlaylistDisplayName(playlist);
      const targetFolder = folders.find((f) => f.id === targetFolderId);
      if (targetFolderId && targetFolder) {
        toast.success(`Moved "${displayName}" to ${targetFolder.name}`);
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
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlist.id],
      });
      setDeleteDialogOpen(false);
    } catch (error) {
      toast.error("Failed to delete playlist");
      console.error(error);
    }
  };

  const renderMenuContent = (components: MenuComponents) => {
    const { Item, Separator, Sub, SubTrigger, SubContent } = components;
    return (
      <>
        <Item onClick={handlePlay}>
          <Play className="w-4 h-4 mr-2" />
          Play
        </Item>
        <Item onClick={handleShuffle}>
          <Shuffle className="w-4 h-4 mr-2" />
          Shuffle
        </Item>
        <Separator />
        <Item onClick={handlePlayNext}>
          <ListPlus className="w-4 h-4 mr-2" />
          Play Next
        </Item>
        <Item onClick={handleAddToQueue}>
          <ListEnd className="w-4 h-4 mr-2" />
          Add to Queue
        </Item>
        {(canModify || isOwner) && <Separator />}
        {isOwner && Sub && SubTrigger && SubContent && (
          <Sub>
            <SubTrigger>
              <FolderInput className="w-4 h-4 mr-2" />
              Move to
            </SubTrigger>
            <SubContent>
              <Item
                onClick={() => movePlaylist.mutate(null)}
                disabled={
                  currentFolderId === null ||
                  currentFolderId === undefined ||
                  movePlaylist.isPending
                }
              >
                <Home className="w-4 h-4 mr-2" />
                Root
                {(currentFolderId === null ||
                  currentFolderId === undefined) && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Current
                  </span>
                )}
              </Item>
              {folders.length > 0 && <Separator />}
              {folders.map((folder) => (
                <Item
                  key={folder.id}
                  onClick={() => movePlaylist.mutate(folder.id)}
                  disabled={
                    currentFolderId === folder.id || movePlaylist.isPending
                  }
                >
                  <Folder className="w-4 h-4 mr-2" />
                  <span className="truncate">{folder.name}</span>
                  {currentFolderId === folder.id && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Current
                    </span>
                  )}
                </Item>
              ))}
              {folders.length === 0 && currentFolderId != null && (
                <Item disabled className="text-muted-foreground text-xs">
                  No other folders
                </Item>
              )}
            </SubContent>
          </Sub>
        )}
        {canModify && (
          <Item onClick={() => setEditDialogOpen(true)}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit Playlist
          </Item>
        )}
        {isOwner && (
          <Item
            onClick={() => setDeleteDialogOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Playlist
          </Item>
        )}
      </>
    );
  };

  const displayName = getPlaylistDisplayName(playlist);
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, "small")
    : undefined;

  return (
    <>
      <ResponsiveContextMenu
        renderMenuContent={renderMenuContent}
        drawerTitle={displayName}
        drawerThumbnail={coverArtUrl ?? undefined}
      >
        {children}
      </ResponsiveContextMenu>

      {canModify && (
        <EditPlaylistDialog
          playlist={{ ...playlist, comment: playlist.comment ?? undefined }}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          isOwner={isOwner}
        />
      )}

      {isOwner && (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{playlist.name}&quot;?
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
      )}
    </>
  );
}

// Dropdown variant for mobile and click-triggered menu
export function PlaylistDropdownMenu({
  playlist,
  currentFolderId: externalFolderId,
  sharedWithMe = false,
  canEdit = false,
  inline = false,
}: {
  playlist: Playlist;
  /** Current folder ID (from API), or pass undefined to auto-detect from foldersData */
  currentFolderId?: string | null;
  /** Whether this playlist was shared with the current user (not owned) */
  sharedWithMe?: boolean;
  /** Whether the current user can edit this shared playlist */
  canEdit?: boolean;
  inline?: boolean;
}) {
  const isOwner = !sharedWithMe;
  const canModify = isOwner || canEdit;
  const queryClient = useQueryClient();
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const hasFinePointer = useHasFinePointer();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch folder structure from API
  const { data: foldersData } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
  });

  const folders = foldersData?.folders ?? [];

  // Determine current folder ID - either from prop or by looking up in API data
  const currentFolderId =
    externalFolderId !== undefined
      ? externalFolderId
      : (foldersData?.playlists.find((p) => p.id === playlist.id)?.folderId ??
        null);

  // Move playlist to folder mutation using new API
  const movePlaylist = useMutation({
    mutationFn: async (targetFolderId: string | null) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.movePlaylistToFolder(playlist.id, targetFolderId);
      return { targetFolderId };
    },
    onSuccess: ({ targetFolderId }) => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      const displayName = getPlaylistDisplayName(playlist);
      const targetFolder = folders.find((f) => f.id === targetFolderId);
      if (targetFolderId && targetFolder) {
        toast.success(`Moved "${displayName}" to ${targetFolder.name}`);
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
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlist.id],
      });
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
                ? hasFinePointer
                  ? "h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  : "hidden"
                : hasFinePointer
                  ? "h-8 w-8 absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  : "hidden"
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
          {(canModify || isOwner) && <DropdownMenuSeparator />}
          {isOwner && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="w-4 h-4 mr-2" />
                Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {/* Move to root option */}
                <DropdownMenuItem
                  onClick={() => movePlaylist.mutate(null)}
                  disabled={
                    currentFolderId === null ||
                    currentFolderId === undefined ||
                    movePlaylist.isPending
                  }
                >
                  <Home className="w-4 h-4 mr-2" />
                  Root
                  {(currentFolderId === null ||
                    currentFolderId === undefined) && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Current
                    </span>
                  )}
                </DropdownMenuItem>
                {folders.length > 0 && <DropdownMenuSeparator />}
                {/* Folder options */}
                {folders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onClick={() => movePlaylist.mutate(folder.id)}
                    disabled={
                      currentFolderId === folder.id || movePlaylist.isPending
                    }
                  >
                    <Folder className="w-4 h-4 mr-2" />
                    <span className="truncate">{folder.name}</span>
                    {currentFolderId === folder.id && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        Current
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
                {folders.length === 0 && currentFolderId != null && (
                  <DropdownMenuItem
                    disabled
                    className="text-muted-foreground text-xs"
                  >
                    No other folders
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {canModify && (
            <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit Playlist
            </DropdownMenuItem>
          )}
          {isOwner && (
            <DropdownMenuItem
              onClick={() => setDeleteDialogOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Playlist
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canModify && (
        <EditPlaylistDialog
          playlist={{ ...playlist, comment: playlist.comment ?? undefined }}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          isOwner={isOwner}
        />
      )}

      {isOwner && (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{playlist.name}&quot;?
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
      )}
    </>
  );
}
