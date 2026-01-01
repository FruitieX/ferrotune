"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSetAtom, useAtomValue } from "jotai";
import {
  FolderOpen,
  Plus,
  MoreVertical,
  Trash2,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Clock,
  Music2,
  Disc,
  Users,
  HardDrive,
  RefreshCw,
  FolderSync,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import type { MusicFolderInfo } from "@/lib/api/types";
import { formatFileSize } from "@/lib/utils/format";
import {
  scanDialogOpenAtom,
  scanFolderIdAtom,
  scanFolderNameAtom,
  isScanningAtom,
} from "@/lib/store/scan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DirectoryBrowser } from "@/components/admin/directory-browser";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

interface MusicFolderCardProps {
  folder: MusicFolderInfo;
  onScan: (id: number) => void;
  onToggleEnabled: (id: number, enabled: boolean) => void;
  onToggleWatchEnabled: (id: number, watchEnabled: boolean) => void;
  onDelete: (id: number) => void;
  isScanning: boolean;
  isDeleting: boolean;
  deletingFolderId: number | null;
}

function MusicFolderCard({
  folder,
  onScan,
  onToggleEnabled,
  onToggleWatchEnabled,
  onDelete,
  isScanning,
  isDeleting,
  deletingFolderId,
}: MusicFolderCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isThisFolderDeleting = isDeleting && deletingFolderId === folder.id;

  return (
    <div
      className={`p-4 rounded-lg border transition-colors ${
        folder.enabled
          ? "bg-card border-border"
          : "bg-muted/30 border-border/50 opacity-60"
      } ${isThisFolderDeleting ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
              folder.enabled ? "bg-primary/10" : "bg-muted"
            }`}
          >
            <FolderOpen
              className={`w-5 h-5 ${
                folder.enabled ? "text-primary" : "text-muted-foreground"
              }`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium truncate">{folder.name}</h4>
              {!folder.enabled && (
                <Badge variant="secondary" className="shrink-0">
                  Disabled
                </Badge>
              )}
              {folder.watchEnabled && folder.enabled && (
                <Badge variant="outline" className="shrink-0 gap-1">
                  <FolderSync className="w-3 h-3" />
                  Auto-scan
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate mt-0.5">
              {folder.path}
            </p>

            {/* Status indicator */}
            <div className="flex items-center gap-2 mt-2">
              {folder.scanError ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 text-destructive">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span className="text-xs">Scan error</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{folder.scanError}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : folder.lastScannedAt ? (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-xs">
                    Scanned {formatRelativeTime(folder.lastScannedAt)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-xs">Never scanned</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onScan(folder.id)}
              disabled={isScanning || !folder.enabled}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Scan folder
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onToggleEnabled(folder.id, !folder.enabled)}
            >
              {folder.enabled ? (
                <>
                  <EyeOff className="w-4 h-4 mr-2" />
                  Disable
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 mr-2" />
                  Enable
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                onToggleWatchEnabled(folder.id, !folder.watchEnabled)
              }
              disabled={!folder.enabled}
            >
              <FolderSync className="w-4 h-4 mr-2" />
              {folder.watchEnabled ? "Disable Auto-scan" : "Enable Auto-scan"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Stats row */}
      {folder.enabled && (
        <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-border/50">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
              <Music2 className="w-3 h-3" />
            </div>
            <p className="text-sm font-medium">
              {folder.stats.songCount.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">songs</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
              <Disc className="w-3 h-3" />
            </div>
            <p className="text-sm font-medium">
              {folder.stats.albumCount.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">albums</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
              <Users className="w-3 h-3" />
            </div>
            <p className="text-sm font-medium">
              {folder.stats.artistCount.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">artists</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
              <HardDrive className="w-3 h-3" />
            </div>
            <p className="text-sm font-medium">
              {formatFileSize(folder.stats.totalSizeBytes)}
            </p>
            <p className="text-xs text-muted-foreground">size</p>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete music folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{folder.name}&quot; and all{" "}
              {folder.stats.songCount.toLocaleString()} songs from the database.
              The actual files on disk will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(folder.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface AddFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, path: string, watchEnabled: boolean) => void;
  isLoading: boolean;
}

function AddFolderDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: AddFolderDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [watchEnabled, setWatchEnabled] = useState(false);
  // Track if user has manually edited the folder name (vs auto-filled from path)
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && path.trim()) {
      onSubmit(name.trim(), path.trim(), watchEnabled);
    }
  };

  // Handle path change with auto-fill logic
  const handlePathChange = (newPath: string) => {
    setPath(newPath);
    // Auto-fill folder name from last path segment if not manually edited
    if (!nameManuallyEdited && newPath.trim()) {
      const lastSegment = newPath.trim().split("/").filter(Boolean).pop();
      if (lastSegment) {
        setName(lastSegment);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Music Folder</DialogTitle>
          <DialogDescription>
            Add a new folder to scan for music files. The path must be a valid
            directory on the server.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="My Music"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameManuallyEdited(true);
                }}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label>Path</Label>
              <DirectoryBrowser
                value={path}
                onChange={handlePathChange}
                placeholder="/path/to/music"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                The absolute path to the music directory on the server
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="watchEnabled"
                checked={watchEnabled}
                onChange={(e) => setWatchEnabled(e.target.checked)}
                disabled={isLoading}
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="watchEnabled" className="font-normal">
                Enable auto-scan (watch for file changes)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !path.trim() || isLoading}
            >
              {isLoading ? "Adding..." : "Add Folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MusicLibraries() {
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogKey, setAddDialogKey] = useState(0);
  const [deletingFolderId, setDeletingFolderId] = useState<number | null>(null);

  // Wrapper to reset dialog state by incrementing key when opening
  const openAddDialog = () => {
    setAddDialogKey((k) => k + 1);
    setAddDialogOpen(true);
  };

  // Scan dialog atoms
  const setScanDialogOpen = useSetAtom(scanDialogOpenAtom);
  const setScanFolderId = useSetAtom(scanFolderIdAtom);
  const setScanFolderName = useSetAtom(scanFolderNameAtom);

  // Fetch music folders
  const { data, isLoading, error } = useQuery({
    queryKey: ["adminMusicFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getAdminMusicFolders();
    },
  });

  // Get scanning state from global store (managed by useScanProgressStream)
  const isScanning = useAtomValue(isScanningAtom);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async ({
      name,
      path,
      watchEnabled,
    }: {
      name: string;
      path: string;
      watchEnabled: boolean;
    }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.createMusicFolder(name, path, watchEnabled);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminMusicFolders"] });
      setAddDialogOpen(false);
      toast.success("Music folder added");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add music folder");
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: number;
      updates: { name?: string; enabled?: boolean; watchEnabled?: boolean };
    }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.updateMusicFolder(id, updates);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["adminMusicFolders"] });

      // When enabled status changes, many queries might return different data
      if (variables.updates.enabled !== undefined) {
        // Stats will show different counts
        queryClient.invalidateQueries({ queryKey: ["serverStats"] });
        // Library data may include/exclude artists/albums/songs from this folder
        queryClient.invalidateQueries({ queryKey: ["albums"] });
        queryClient.invalidateQueries({ queryKey: ["album"] });
        queryClient.invalidateQueries({ queryKey: ["artists"] });
        queryClient.invalidateQueries({ queryKey: ["artist"] });
        queryClient.invalidateQueries({ queryKey: ["songs"] });
        queryClient.invalidateQueries({ queryKey: ["genres"] });
        queryClient.invalidateQueries({ queryKey: ["starred"] });
        // Playlists may now have not-found entries
        queryClient.invalidateQueries({ queryKey: ["playlists"] });
        queryClient.invalidateQueries({ queryKey: ["playlistDetail"] });
        queryClient.invalidateQueries({ queryKey: ["playlistSongs"] });
        // Smart playlists filter by enabled folders
        queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
        queryClient.invalidateQueries({ queryKey: ["smartPlaylistSongs"] });
        // Home page data (random albums, recently added, etc.)
        queryClient.invalidateQueries({ queryKey: ["randomAlbums"] });
        queryClient.invalidateQueries({ queryKey: ["recentAlbums"] });
        queryClient.invalidateQueries({ queryKey: ["frequentAlbums"] });
        queryClient.invalidateQueries({ queryKey: ["randomSongs"] });
        // Search results
        queryClient.invalidateQueries({ queryKey: ["search"] });
        // Music folder list (for folder selector in various views)
        queryClient.invalidateQueries({ queryKey: ["musicFolders"] });
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update music folder");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.deleteMusicFolder(id);
    },
    onSuccess: () => {
      // Invalidate all queries that might have data from the deleted folder
      queryClient.invalidateQueries({ queryKey: ["adminMusicFolders"] });
      queryClient.invalidateQueries({ queryKey: ["serverStats"] });
      // Library data
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      queryClient.invalidateQueries({ queryKey: ["songs"] });
      queryClient.invalidateQueries({ queryKey: ["genres"] });
      queryClient.invalidateQueries({ queryKey: ["starred"] });
      // Playlists may now have missing entries
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistDetail"] });
      // Home page data (random albums, recently added, etc.)
      queryClient.invalidateQueries({ queryKey: ["randomAlbums"] });
      queryClient.invalidateQueries({ queryKey: ["recentAlbums"] });
      queryClient.invalidateQueries({ queryKey: ["frequentAlbums"] });
      queryClient.invalidateQueries({ queryKey: ["randomSongs"] });
      toast.success("Music folder deleted");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete music folder");
    },
  });

  const handleScan = (id: number) => {
    // Find the folder name
    const folder = folders.find((f) => f.id === id);
    setScanFolderId(id);
    setScanFolderName(folder?.name ?? null);
    setScanDialogOpen(true);
  };

  const handleToggleEnabled = (id: number, enabled: boolean) => {
    updateMutation.mutate({ id, updates: { enabled } });
    toast.success(enabled ? "Folder enabled" : "Folder disabled");
  };

  const handleToggleWatchEnabled = (id: number, watchEnabled: boolean) => {
    updateMutation.mutate({ id, updates: { watchEnabled } });
    toast.success(watchEnabled ? "Auto-scan enabled" : "Auto-scan disabled");
  };

  const handleDelete = (id: number) => {
    setDeletingFolderId(id);
    deleteMutation.mutate(id, {
      onSettled: () => {
        setDeletingFolderId(null);
      },
    });
  };

  const handleAddFolder = (
    name: string,
    path: string,
    watchEnabled: boolean,
  ) => {
    createMutation.mutate({ name, path, watchEnabled });
  };

  const folders = data?.musicFolders ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              Music Libraries
            </CardTitle>
            <CardDescription>
              Manage your music folders and scan settings
            </CardDescription>
          </div>
          <Button onClick={openAddDialog} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add Folder
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[120px] w-full" />
            <Skeleton className="h-[120px] w-full" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p>Failed to load music folders</p>
          </div>
        ) : folders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No music folders configured</p>
            <p className="text-sm mt-1">
              Add a folder to start scanning your music library
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {folders.map((folder) => (
              <MusicFolderCard
                key={folder.id}
                folder={folder}
                onScan={handleScan}
                onToggleEnabled={handleToggleEnabled}
                onToggleWatchEnabled={handleToggleWatchEnabled}
                onDelete={handleDelete}
                isScanning={isScanning}
                isDeleting={deleteMutation.isPending}
                deletingFolderId={deletingFolderId}
              />
            ))}
          </div>
        )}

        {/* Summary stats */}
        {folders.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {folders.length} folder{folders.length !== 1 ? "s" : ""},{" "}
                {folders.filter((f) => f.enabled).length} enabled
              </span>
              <span>
                {folders
                  .reduce((sum, f) => sum + f.stats.songCount, 0)
                  .toLocaleString()}{" "}
                total songs
              </span>
            </div>
          </div>
        )}
      </CardContent>

      {/* Add folder dialog */}
      <AddFolderDialog
        key={addDialogKey}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSubmit={handleAddFolder}
        isLoading={createMutation.isPending}
      />

      {/* Delete progress dialog */}
      <Dialog open={deleteMutation.isPending}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Deleting Library
            </DialogTitle>
            <DialogDescription>
              Removing &quot;
              {folders.find((f) => f.id === deletingFolderId)?.name ??
                "library"}
              &quot; and updating playlists...
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full animate-pulse w-full" />
            </div>
            <p className="text-sm text-muted-foreground mt-3 text-center">
              This may take a while for large libraries. Please wait...
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
