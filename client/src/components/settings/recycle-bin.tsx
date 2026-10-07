"use client";

import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { Progress } from "@/components/ui/progress";
import { CoverImage } from "@/components/shared/cover-image";

const PAGE_SIZE = 200;
const ROW_HEIGHT = 60;

interface DeleteProgress {
  current: number;
  total: number;
}

export function RecycleBin() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEmptyDialog, setShowEmptyDialog] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(
    null,
  );

  // Fetch recycle bin contents page by page as the list scrolls
  const {
    data: recycleBinPages,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["recycleBin"],
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getRecycleBin({ offset: pageParam, limit: PAGE_SIZE });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.songs.length, 0);
      return loaded < lastPage.totalCount && lastPage.songs.length > 0
        ? loaded
        : undefined;
    },
    staleTime: 30000,
  });
  const recycleBin = recycleBinPages
    ? {
        songs: recycleBinPages.pages.flatMap((page) => page.songs),
        totalCount: recycleBinPages.pages[0]?.totalCount ?? 0,
      }
    : undefined;
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: recycleBin?.songs.length ?? 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index ?? -1;
  useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      lastVirtualIndex >= (recycleBin?.songs.length ?? 0) - 10
    ) {
      void fetchNextPage();
    }
  }, [
    lastVirtualIndex,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    recycleBin?.songs.length,
  ]);

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

  // Delete permanently mutation - processes items one at a time for progress tracking
  const deleteMutation = useMutation({
    mutationFn: async (songIds: string[]) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const total = songIds.length;
      let deletedCount = 0;
      const errors: string[] = [];
      for (let i = 0; i < total; i++) {
        setDeleteProgress({ current: i + 1, total });
        try {
          const result = await client.deletePermanently([songIds[i]]);
          deletedCount += result.deletedCount;
          if (!result.success) {
            errors.push(...(result.errors ?? []));
          }
        } catch (e) {
          errors.push(
            `Failed to delete song: ${e instanceof Error ? e.message : "Unknown error"}`,
          );
        }
      }
      setDeleteProgress(null);
      return {
        success: errors.length === 0,
        deletedCount,
        message:
          errors.length > 0
            ? `Deleted ${deletedCount} of ${total} songs. ${errors.length} error(s).`
            : `Permanently deleted ${deletedCount} song${deletedCount !== 1 ? "s" : ""}`,
        errors,
      };
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.warning(data.message);
      }
      queryClient.invalidateQueries({ queryKey: ["recycleBin"] });
      invalidateSongQueries(queryClient);
      setSelectedIds(new Set());
      setShowDeleteDialog(false);
    },
    onError: (error: Error) => {
      setDeleteProgress(null);
      toast.error(error.message || "Failed to delete songs");
      setShowDeleteDialog(false);
    },
  });

  // Empty recycle bin mutation - processes items one at a time for progress tracking
  const emptyMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      let bin = await client.getRecycleBin({ limit: PAGE_SIZE });
      if (bin.totalCount === 0) {
        return {
          success: true,
          deletedCount: 0,
          message: "Recycle bin is already empty",
          errors: [] as string[],
        };
      }
      // Deleted songs leave the list, so keep reading the first page;
      // songs that failed to delete stay put and are skipped by offset.
      const total = bin.totalCount;
      let deletedCount = 0;
      let failedCount = 0;
      let processed = 0;
      const errors: string[] = [];
      while (bin.songs.length > 0) {
        for (const song of bin.songs) {
          processed += 1;
          setDeleteProgress({ current: processed, total });
          try {
            const result = await client.deletePermanently([song.id]);
            deletedCount += result.deletedCount;
            if (!result.success || result.deletedCount === 0) {
              failedCount += 1;
              errors.push(...(result.errors ?? []));
            }
          } catch (e) {
            failedCount += 1;
            errors.push(
              `Failed to delete song: ${e instanceof Error ? e.message : "Unknown error"}`,
            );
          }
        }
        bin = await client.getRecycleBin({
          offset: failedCount,
          limit: PAGE_SIZE,
        });
      }
      setDeleteProgress(null);
      return {
        success: errors.length === 0,
        deletedCount,
        message:
          errors.length > 0
            ? `Deleted ${deletedCount} of ${total} songs. ${errors.length} error(s).`
            : `Permanently deleted ${deletedCount} song${deletedCount !== 1 ? "s" : ""}`,
        errors,
      };
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.warning(data.message);
      }
      queryClient.invalidateQueries({ queryKey: ["recycleBin"] });
      invalidateSongQueries(queryClient);
      setSelectedIds(new Set());
      setShowEmptyDialog(false);
    },
    onError: (error: Error) => {
      setDeleteProgress(null);
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
              <div ref={listRef} className="max-h-[400px] overflow-y-auto">
                <div
                  className="relative"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualRows.map(({ index, start }) => {
                    const song = recycleBin.songs[index];
                    return (
                      <div
                        key={song.id}
                        className={`absolute left-0 right-0 flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 active:bg-muted/70 cursor-pointer touch-manipulation active:scale-[0.995] ${
                          selectedIds.has(song.id) ? "bg-muted" : ""
                        }`}
                        style={{
                          height: ROW_HEIGHT,
                          transform: `translateY(${start}px)`,
                        }}
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
                          <span>{formatDuration(song.duration)}</span>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span
                              className={
                                song.daysRemaining <= 7
                                  ? "text-destructive"
                                  : ""
                              }
                            >
                              {song.daysRemaining} day
                              {song.daysRemaining !== 1 && "s"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open) =>
          !deleteMutation.isPending && setShowDeleteDialog(open)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Songs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size} song
              {selectedIds.size !== 1 && "s"} from your disk. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Deleting {deleteProgress.current} of {deleteProgress.total}...
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round(
                    (deleteProgress.current / deleteProgress.total) * 100,
                  )}
                  %
                </span>
              </div>
              <Progress
                value={(deleteProgress.current / deleteProgress.total) * 100}
                className="h-2"
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 active:bg-destructive/80"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting {deleteProgress?.current ?? 0}/
                  {deleteProgress?.total ?? 0}
                </>
              ) : (
                "Delete Permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Empty recycle bin confirmation dialog */}
      <AlertDialog
        open={showEmptyDialog}
        onOpenChange={(open) =>
          !emptyMutation.isPending && setShowEmptyDialog(open)
        }
      >
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
          {deleteProgress && emptyMutation.isPending && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Deleting {deleteProgress.current} of {deleteProgress.total}...
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round(
                    (deleteProgress.current / deleteProgress.total) * 100,
                  )}
                  %
                </span>
              </div>
              <Progress
                value={(deleteProgress.current / deleteProgress.total) * 100}
                className="h-2"
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emptyMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 active:bg-destructive/80"
              onClick={() => emptyMutation.mutate()}
              disabled={emptyMutation.isPending}
            >
              {emptyMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting {deleteProgress?.current ?? 0}/
                  {deleteProgress?.total ?? 0}
                </>
              ) : (
                "Empty Recycle Bin"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
