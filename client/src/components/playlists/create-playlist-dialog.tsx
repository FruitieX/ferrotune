"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ListMusic,
  Folder,
  Loader2,
  ChevronDown,
  Home,
  Upload,
  X,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getClient } from "@/lib/api/client";
import { buildFolderPathMap } from "@/lib/utils/playlist-folders";
import { cn } from "@/lib/utils";

interface CreatePlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional folder ID to create the playlist in (new API) */
  folderId?: string | null;
  /** Optional folder path for display purposes */
  folderPath?: string;
  /** If true, creates a folder using the new folder API */
  createFolder?: boolean;
}

export function CreatePlaylistDialog({
  open,
  onOpenChange,
  folderId: initialFolderId = null,
  folderPath: initialFolderPath = "",
  createFolder = false,
}: CreatePlaylistDialogProps) {
  const [name, setName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    initialFolderId,
  );
  const [prevOpen, setPrevOpen] = useState(open);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  // Fetch folders for the folder picker
  const { data: foldersData } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
    enabled: open,
  });

  const folders = foldersData?.folders ?? [];
  const folderPathMap = buildFolderPathMap(folders);

  // Reset state when dialog opens
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setSelectedFolderId(initialFolderId);
      setCoverPreview(null);
      setSelectedFile(null);
    }
  }

  // Get the selected folder full path for display
  const selectedFolderPath = selectedFolderId
    ? (folderPathMap.get(selectedFolderId) ?? initialFolderPath ?? "Root")
    : "Root";

  // Handle file selection for folder cover
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Image too large (max 10MB)");
        return;
      }
      setSelectedFile(file);
      // Create preview URL
      const url = URL.createObjectURL(file);
      setCoverPreview(url);
    }
  };

  const clearCoverSelection = () => {
    if (coverPreview) {
      URL.revokeObjectURL(coverPreview);
    }
    setCoverPreview(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const createPlaylist = useMutation({
    mutationFn: async ({
      playlistName,
      coverFile,
    }: {
      playlistName: string;
      coverFile: File | null;
    }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      if (createFolder) {
        // Create folder using new API
        const folder = await client.createPlaylistFolder(
          playlistName,
          selectedFolderId,
        );

        // Upload cover art if selected
        if (coverFile && folder.id) {
          await client.uploadPlaylistFolderCover(folder.id, coverFile);
        }

        return { type: "folder" as const, folder };
      } else {
        // Create playlist directly in the selected folder
        const result = await client.createPlaylist({
          name: playlistName,
          folderId: selectedFolderId,
        });

        return { type: "playlist" as const, playlist: result };
      }
    },
    onSuccess: async (result) => {
      const displayName = name.trim();
      if (result.type === "folder") {
        toast.success(`Folder "${displayName}" created successfully`);
        await queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      } else {
        toast.success(`Playlist "${displayName}" created successfully`);
        await queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
        await queryClient.invalidateQueries({ queryKey: ["playlists"] });

        // Navigate to the new playlist
        if (result.playlist.playlist?.id) {
          router.push(`/playlists/details?id=${result.playlist.playlist.id}`);
        }
      }
      setName("");
      clearCoverSelection();
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
      createPlaylist.mutate({
        playlistName: name.trim(),
        coverFile: selectedFile,
      });
    }
  };

  const Icon = createFolder ? Folder : ListMusic;
  const title = createFolder ? "Create Folder" : "Create Playlist";
  const description = createFolder
    ? "Create a new folder to organize your playlists."
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

            {/* Folder picker */}
            <div className="grid gap-2">
              <Label>Location</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-between">
                    <span className="flex items-center gap-2">
                      {selectedFolderId ? (
                        <Folder className="w-4 h-4" />
                      ) : (
                        <Home className="w-4 h-4" />
                      )}
                      {selectedFolderPath}
                    </span>
                    <ChevronDown className="w-4 h-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[200px]">
                  <DropdownMenuItem onClick={() => setSelectedFolderId(null)}>
                    <Home className="w-4 h-4 mr-2" />
                    Root
                    {!selectedFolderId && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        Current
                      </span>
                    )}
                  </DropdownMenuItem>
                  {folders.length > 0 && <DropdownMenuSeparator />}
                  {folders.map((folder) => {
                    const fullPath = folderPathMap.get(folder.id) ?? folder.name;
                    return (
                      <DropdownMenuItem
                        key={folder.id}
                        onClick={() => setSelectedFolderId(folder.id)}
                      >
                        <Folder className="w-4 h-4 mr-2" />
                        <span className="truncate">{fullPath}</span>
                        {selectedFolderId === folder.id && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            Current
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Cover art picker - only for folders */}
            {createFolder && (
              <div className="grid gap-2">
                <Label>Cover Art (Optional)</Label>
                <div className="flex items-start gap-4">
                  {/* Cover Preview */}
                  <div
                    className={cn(
                      "relative w-20 h-20 rounded-lg overflow-hidden",
                      "bg-muted flex items-center justify-center",
                      "border border-border",
                    )}
                  >
                    {coverPreview ? (
                      <Image
                        src={coverPreview}
                        alt="Folder cover preview"
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <Folder className="w-8 h-8 text-muted-foreground" />
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {coverPreview ? "Change" : "Upload"}
                    </Button>
                    {coverPreview && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clearCoverSelection}
                        className="text-destructive hover:text-destructive"
                      >
                        <X className="w-4 h-4 mr-2" />
                        Remove
                      </Button>
                    )}
                    {selectedFile && (
                      <p className="text-xs text-muted-foreground max-w-[140px] truncate">
                        {selectedFile.name}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
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
