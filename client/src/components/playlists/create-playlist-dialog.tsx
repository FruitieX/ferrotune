"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
        // Creating a folder: the "folder" is actually a placeholder playlist
        // The folder name IS the path, so append this name to the current path
        fullName = folderPath 
          ? `${folderPath}/${playlistName}` 
          : playlistName;
      } else {
        // Creating a regular playlist in a folder
        fullName = folderPath 
          ? `${folderPath}/${playlistName}` 
          : playlistName;
      }
      
      return client.createPlaylist({ name: fullName });
    },
    onSuccess: async () => {
      const displayName = name.trim();
      if (createFolder) {
        toast.success(`Folder "${displayName}" created successfully`);
      } else {
        toast.success(`Playlist "${displayName}" created successfully`);
      }
      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
      setName("");
      onOpenChange(false);
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
            <DialogDescription>
              {description}
            </DialogDescription>
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
