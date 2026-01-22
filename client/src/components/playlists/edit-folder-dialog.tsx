"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Folder, Upload, Trash2, Image as ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getClient } from "@/lib/api/client";
import { type PlaylistFolder } from "@/lib/utils/playlist-folders";
import { cn } from "@/lib/utils";

interface EditFolderDialogProps {
  folder: PlaylistFolder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditFolderDialog({
  folder,
  open,
  onOpenChange,
}: EditFolderDialogProps) {
  // Use a key to reset form state when folder changes - rendered in inner component
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <EditFolderDialogContent
          key={folder.id ?? folder.path}
          folder={folder}
          onOpenChange={onOpenChange}
        />
      )}
    </Dialog>
  );
}

interface EditFolderDialogContentProps {
  folder: PlaylistFolder;
  onOpenChange: (open: boolean) => void;
}

function EditFolderDialogContent({
  folder,
  onOpenChange,
}: EditFolderDialogContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  // Initialize with folder.name - this will be fresh each time component mounts due to key
  const [folderName, setFolderName] = useState(folder.name);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Check if this folder has a database ID (is a real folder entity)
  const hasFolderId = !!folder.id;

  // Get current folder path from URL
  const currentFolderPath = searchParams.get("folder") || "";

  // Process file for cover art
  const processFile = (file: File) => {
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
  };

  // Handle paste event for clipboard images
  useEffect(() => {
    // This component is only rendered when open is true, so no need to check open
    if (!hasFolderId) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            processFile(file);
          }
          break;
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [hasFolderId]);

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the drop zone entirely
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      processFile(file);
    }
  };

  // Rename folder mutation - uses new API if folder has ID, otherwise legacy approach
  const renameFolderMutation = useMutation({
    mutationFn: async (newName: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      if (hasFolderId) {
        // Use new folder API
        await client.updatePlaylistFolder(folder.id!, { name: newName });
      } else {
        // Legacy: rename all playlists in the folder
        throw new Error(
          "Cannot edit folder without folder ID - folder entity not found",
        );
      }

      return newName;
    },
    onSuccess: (newName) => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      toast.success(`Renamed folder to "${newName}"`);
    },
    onError: (error) => {
      toast.error("Failed to rename folder", { description: String(error) });
    },
  });

  // Upload cover art mutation
  const uploadCoverMutation = useMutation({
    mutationFn: async (file: File) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      if (!folder.id) throw new Error("Folder has no ID");

      await client.uploadPlaylistFolderCover(folder.id, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      toast.success("Cover art updated");
      setCoverPreview(null);
      setSelectedFile(null);
    },
    onError: (error) => {
      toast.error("Failed to upload cover", { description: String(error) });
    },
  });

  // Delete cover art mutation
  const deleteCoverMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      if (!folder.id) throw new Error("Folder has no ID");

      await client.deletePlaylistFolderCover(folder.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      toast.success("Cover art removed");
    },
    onError: (error) => {
      toast.error("Failed to remove cover", { description: String(error) });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleSave = async () => {
    // Validate name
    if (!folderName.trim()) {
      toast.error("Folder name cannot be empty");
      return;
    }
    if (folderName.includes("/")) {
      toast.error("Folder name cannot contain /");
      return;
    }

    const newName = folderName.trim();
    const isRenaming = newName !== folder.name;

    const promises: Promise<unknown>[] = [];

    // Rename if name changed
    if (isRenaming) {
      promises.push(renameFolderMutation.mutateAsync(newName));
    }

    // Upload cover if file selected
    if (selectedFile) {
      promises.push(uploadCoverMutation.mutateAsync(selectedFile));
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }

    onOpenChange(false);

    // Navigate to new folder path if we renamed the currently viewed folder
    if (isRenaming && currentFolderPath === folder.path) {
      // Compute new path by replacing the last segment (folder name) with the new name
      const pathParts = folder.path.split("/");
      pathParts[pathParts.length - 1] = newName;
      const newPath = pathParts.join("/");
      router.push(`/playlists?folder=${encodeURIComponent(newPath)}`);
    }
  };

  const handleDeleteCover = () => {
    deleteCoverMutation.mutate();
  };

  const isPending =
    renameFolderMutation.isPending ||
    uploadCoverMutation.isPending ||
    deleteCoverMutation.isPending;

  // Get current cover URL if folder has cover art
  const currentCoverUrl =
    folder.id && folder.hasCoverArt
      ? getClient()?.getPlaylistFolderCoverUrl(folder.id)
      : null;

  // What to show in the preview
  const displayCoverUrl = coverPreview || currentCoverUrl;

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Folder className="w-5 h-5" />
          Edit Folder
        </DialogTitle>
        <DialogDescription>
          Rename the folder or change its cover art.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6 py-4">
        {/* Folder Name */}
        <div className="space-y-2">
          <Label htmlFor="folder-name">Folder Name</Label>
          <Input
            id="folder-name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Enter folder name"
            disabled={!hasFolderId}
          />
          {!hasFolderId && (
            <p className="text-sm text-muted-foreground">
              This folder was created from playlist names and cannot be renamed
              directly.
            </p>
          )}
        </div>

        {/* Cover Art */}
        {hasFolderId && (
          <div className="space-y-2">
            <Label>Cover Art</Label>
            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "flex items-start gap-4 p-3 -m-3 rounded-lg transition-colors",
                isDragging && "bg-primary/10 ring-2 ring-primary ring-dashed",
              )}
            >
              {/* Cover Preview / Drop Zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "relative w-24 h-24 rounded-lg overflow-hidden cursor-pointer",
                  "bg-muted flex items-center justify-center",
                  "border border-border hover:border-primary/50 transition-colors",
                  isDragging && "border-primary",
                )}
              >
                {displayCoverUrl ? (
                  <Image
                    src={displayCoverUrl}
                    alt="Folder cover"
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : isDragging ? (
                  <ImageIcon className="w-8 h-8 text-primary" />
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
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isPending}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {folder.hasCoverArt || coverPreview ? "Change" : "Upload"}
                </Button>
                {(folder.hasCoverArt || coverPreview) && !selectedFile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteCover}
                    disabled={isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Remove
                  </Button>
                )}
                {selectedFile && (
                  <p className="text-xs text-muted-foreground">
                    Selected: {selectedFile.name}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Drag & drop or paste from clipboard
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isPending || !hasFolderId}>
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
