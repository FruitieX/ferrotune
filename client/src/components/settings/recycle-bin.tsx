"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  RotateCcw,
  Clock,
  Loader2,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import {
  invalidateSongQueries,
  invalidateRecycleBinQueries,
} from "@/lib/api/cache-invalidation";
import { formatDuration } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { CoverImage } from "@/components/shared/cover-image";

export function RecycleBin() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEmptyDialog, setShowEmptyDialog] = useState(false);

  // Fetch recycle bin contents
  const {
    data: recycleBin,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["recycleBin"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getRecycleBin({ limit: 500 });
    },
    staleTime: 30000,
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: async (songIds: string[]) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.restoreSongs(songIds);
    },
    onSuccess: (data) => {
      toast.success(data.message);
      invalidateRecycleBinQueries(queryClient);
      invalidateSongQueries(queryClient);
      setSelectedIds(new Set());
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to restore songs");
    },
  });

  // Delete permanently mutation
  const deleteMutation = useMutation({
    mutationFn: async (songIds: string[]) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.deletePermanently(songIds);
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.warning(data.message);
      }
      queryClient.invalidateQueries({ queryKey: ["recycleBin"] });
      setSelectedIds(new Set());
      setShowDeleteDialog(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete songs");
      setShowDeleteDialog(false);
    },
  });

  // Empty recycle bin mutation
  const emptyMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.emptyRecycleBin();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.warning(data.message);
      }
      queryClient.invalidateQueries({ queryKey: ["recycleBin"] });
      setSelectedIds(new Set());
      setShowEmptyDialog(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to empty recycle bin");
      setShowEmptyDialog(false);
    },
  });

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    if (!recycleBin) return;
    if (selectedIds.size === recycleBin.songs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(recycleBin.songs.map((s) => s.id)));
    }
  };

  const handleRestore = () => {
    if (selectedIds.size === 0) return;
    restoreMutation.mutate(Array.from(selectedIds));
  };

  const handleDelete = () => {
    if (selectedIds.size === 0) return;
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    deleteMutation.mutate(Array.from(selectedIds));
  };

  const isEmpty = !recycleBin || recycleBin.songs.length === 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5" />
            Recycle Bin
          </CardTitle>
          <CardDescription>Songs marked for deletion</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5" />
            Recycle Bin
          </CardTitle>
          <CardDescription>Songs marked for deletion</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="w-5 h-5" />
            <span>Failed to load recycle bin</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="w-5 h-5" />
                Recycle Bin
              </CardTitle>
              <CardDescription>
                Songs are automatically deleted after 30 days
              </CardDescription>
            </div>
            {!isEmpty && (
              <Badge variant="secondary">
                {recycleBin.totalCount} song{recycleBin.totalCount !== 1 && "s"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isEmpty ? (
            <div className="text-center py-8 text-muted-foreground">
              <Trash2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Recycle bin is empty</p>
              <p className="text-sm mt-1">
                Songs you mark for deletion will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Action bar */}
              <div className="flex items-center justify-between gap-2 pb-2 border-b">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={
                      selectedIds.size > 0 &&
                      selectedIds.size === recycleBin.songs.length
                    }
                    onCheckedChange={selectAll}
                  />
                  <span className="text-sm text-muted-foreground">
                    {selectedIds.size > 0
                      ? `${selectedIds.size} selected`
                      : "Select all"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      selectedIds.size === 0 || restoreMutation.isPending
                    }
                    onClick={handleRestore}
                  >
                    {restoreMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4 mr-2" />
                    )}
                    Restore
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={
                      selectedIds.size === 0 || deleteMutation.isPending
                    }
                    onClick={handleDelete}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <XCircle className="w-4 h-4 mr-2" />
                    )}
                    Delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={emptyMutation.isPending}
                    onClick={() => setShowEmptyDialog(true)}
                  >
                    {emptyMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Empty All
                  </Button>
                </div>
              </div>

              {/* Song list */}
              <div className="max-h-[400px] overflow-y-auto space-y-1">
                {recycleBin.songs.map((song) => (
                  <div
                    key={song.id}
                    className={`flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer ${
                      selectedIds.has(song.id) ? "bg-muted" : ""
                    }`}
                    onClick={() => toggleSelection(song.id)}
                  >
                    <Checkbox
                      checked={selectedIds.has(song.id)}
                      onCheckedChange={() => toggleSelection(song.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <CoverImage
                        src={getClient()?.getCoverArtUrl(
                          song.id,
                          "small",
                          song.coverArtHash ?? undefined,
                        )}
                        alt={song.title}
                        type="song"
                        size="sm"
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{song.title}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {song.artistName}
                          {song.albumName && ` · ${song.albumName}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
                      <span>{formatDuration(song.duration / 1000)}</span>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span
                          className={
                            song.daysRemaining <= 7 ? "text-destructive" : ""
                          }
                        >
                          {song.daysRemaining} day
                          {song.daysRemaining !== 1 && "s"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Songs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size} song
              {selectedIds.size !== 1 && "s"} from your disk. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Empty recycle bin confirmation dialog */}
      <AlertDialog open={showEmptyDialog} onOpenChange={setShowEmptyDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Recycle Bin?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {recycleBin?.totalCount || 0}{" "}
              song
              {(recycleBin?.totalCount || 0) !== 1 && "s"} from your disk. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => emptyMutation.mutate()}
              disabled={emptyMutation.isPending}
            >
              {emptyMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Empty Recycle Bin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
