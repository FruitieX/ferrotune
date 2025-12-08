"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListMusic, Folder, Loader2 } from "lucide-react";
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
import { findFolderPlaceholder } from "@/lib/utils/playlist-folders";

interface CreatePlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional folder path to create the playlist in */
  folderPath?: string;
  /** If true, creates a folder (by creating an empty playlist with folder name) */
  createFolder?: boolean;
}

export function CreatePlaylistDialog({
  open,
  onOpenChange,
  folderPath = "",
  createFolder = false,
}: CreatePlaylistDialogProps) {
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const router = useRouter();

  // Fetch playlists to check for folder placeholders
  const { data: playlists } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
    enabled: open && !createFolder, // Only need this when creating a playlist (not a folder)
  });

  // Reset name when dialog opens
  useEffect(() => {
    if (open) {
      setName("");
    }
  }, [open]);

  const createPlaylist = useMutation({
    mutationFn: async (playlistName: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Build the full playlist name with folder path prefix
      let fullName: string;
      if (createFolder) {
        // Creating a folder: create a placeholder with trailing /
        // e.g., "Rock/" or "Music/Rock/" to indicate an empty folder
        // This placeholder will be deleted when the first real playlist is added
        const folderFullPath = folderPath
          ? `${folderPath}/${playlistName}`
          : playlistName;
        fullName = `${folderFullPath}/`;
      } else {
        // Creating a regular playlist in a folder
        fullName = folderPath ? `${folderPath}/${playlistName}` : playlistName;
      }

      // Create the new playlist
      const result = await client.createPlaylist({ name: fullName });

      // If creating a real playlist in a folder, delete the folder placeholder if it exists
      if (!createFolder && folderPath && playlists) {
        const placeholder = findFolderPlaceholder(playlists, folderPath);
        if (placeholder) {
          try {
            await client.deletePlaylist(placeholder.id);
          } catch (err) {
            // Ignore errors deleting placeholder - the folder will still work
            console.warn("Failed to delete folder placeholder:", err);
          }
        }
      }

      return result;
    },
    onSuccess: async (result) => {
      const displayName = name.trim();
      if (createFolder) {
        toast.success(`Folder "${displayName}" created successfully`);
      } else {
        toast.success(`Playlist "${displayName}" created successfully`);
      }
      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
      setName("");
      onOpenChange(false);

      // Navigate to the new playlist (only for regular playlists, not folders)
      if (!createFolder && result.playlist?.id) {
        router.push(`/playlists/details?id=${result.playlist.id}`);
      }
    },
    onError: (error) => {
      const entityType = createFolder ? "folder" : "playlist";
      toast.error(`Failed to create ${entityType}`);
      console.error(`Create ${entityType} error:`, error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      createPlaylist.mutate(name.trim());
    }
  };

  const Icon = createFolder ? Folder : ListMusic;
  const title = createFolder ? "Create Folder" : "Create Playlist";
  const description = createFolder
    ? "Create a new folder to organize your playlists. This will create a playlist in the folder to establish it."
    : folderPath
      ? `Create a new playlist in "${folderPath}".`
      : "Give your playlist a name to get started.";
  const placeholder = createFolder ? "New Folder" : "My Playlist";
  const buttonText = createFolder ? "Create Folder" : "Create";
  const loadingText = "Creating...";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className="w-5 h-5" />
              {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="playlist-name">Name</Label>
              <Input
                id="playlist-name"
                placeholder={placeholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createPlaylist.isPending}
            >
              {createPlaylist.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {loadingText}
                </>
              ) : (
                buttonText
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
