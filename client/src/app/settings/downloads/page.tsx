"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtomValue } from "jotai";
import {
  Album,
  ChevronLeft,
  Download,
  HardDrive,
  ListMusic,
  Loader2,
  Music2,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
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
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { CoverImage } from "@/components/shared/cover-image";
import {
  downloadedContainersAtom,
  downloadStateMapAtom,
} from "@/lib/store/downloads";
import { useDownloadActions } from "@/lib/hooks/use-download-actions";
import { getDownloadedSongs } from "@/lib/offline/download-manager";
import {
  getOfflinePlaylistMembershipCache,
  syncOfflinePlaylistMembership,
  type OfflinePlaylistMembershipCache,
} from "@/lib/offline/playlist-membership";
import type { Song } from "@/lib/api/types";
import { formatDuration, formatFileSize } from "@/lib/utils/format";
import {
  hapticConfirm,
  hapticDestructive,
  hapticSelection,
} from "@/lib/utils/haptic";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 76;

type DownloadedSongRow = {
  id: string;
  bytes: number;
  song: Song | null;
};

type DownloadedCollectionType = "album" | "artist" | "playlist";

type DownloadedCollectionRow = {
  id: string;
  sourceId: string;
  type: DownloadedCollectionType;
  title: string;
  songIds: string[];
  completedCount: number;
  bytes: number;
};

export default function DownloadedSongsSettingsPage() {
  const stateMap = useAtomValue(downloadStateMapAtom);
  const containers = useAtomValue(downloadedContainersAtom);
  const { removeSongDownloads, removeContainerDownload } = useDownloadActions();
  const [songsById, setSongsById] = useState<Record<string, Song>>({});
  const [membershipCache, setMembershipCache] =
    useState<OfflinePlaylistMembershipCache | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);
  const [isSyncingPlaylistMembership, setIsSyncingPlaylistMembership] =
    useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmSelectedOpen, setConfirmSelectedOpen] = useState(false);
  const [confirmSingleId, setConfirmSingleId] = useState<string | null>(null);
  const [confirmCollection, setConfirmCollection] =
    useState<DownloadedCollectionRow | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingMetadata(true);
    getDownloadedSongs()
      .then((songs) => {
        if (!cancelled) setSongsById(songs);
      })
      .catch((err) => {
        console.warn(
          "[downloads] failed to load downloaded song metadata",
          err,
        );
        if (!cancelled) setSongsById({});
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMetadata(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getOfflinePlaylistMembershipCache()
      .then((cache) => {
        if (!cancelled) setMembershipCache(cache);
      })
      .catch((err) => {
        console.warn(
          "[downloads] failed to load playlist membership cache",
          err,
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const rows: DownloadedSongRow[] = [];
  for (const [id, state] of stateMap) {
    if (state.status !== "completed") continue;
    rows.push({
      id,
      bytes: state.bytesDownloaded,
      song: songsById[id] ?? null,
    });
  }

  const rowIdsKey = rows.map((row) => row.id).join("\n");
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const selectedBytes = selectedRows.reduce((sum, row) => sum + row.bytes, 0);
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const selectedCount = selectedRows.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const collectionRows = buildCollectionRows(
    containers,
    stateMap,
    songsById,
    membershipCache,
  );
  const syncedPlaylistCount = membershipCache
    ? Object.keys(membershipCache.playlists).length
    : 0;

  useEffect(() => {
    const rowIds = new Set(rowIdsKey ? rowIdsKey.split("\n") : []);
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (rowIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rowIdsKey]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  function toggleSelected(id: string, checked: boolean) {
    hapticSelection();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    hapticSelection();
    setSelectedIds(checked ? new Set(rows.map((row) => row.id)) : new Set());
  }

  async function removeSingle(id: string) {
    setConfirmSingleId(null);
    setIsRemoving(true);
    try {
      const removed = await removeSongDownloads([id]);
      if (!removed) return;
      setSongsById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setIsRemoving(false);
    }
  }

  async function removeSelected() {
    const ids = selectedRows.map((row) => row.id);
    setConfirmSelectedOpen(false);
    setIsRemoving(true);
    try {
      const removed = await removeSongDownloads(ids);
      if (!removed) return;
      setSongsById((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setSelectedIds(new Set());
    } finally {
      setIsRemoving(false);
    }
  }

  async function syncPlaylistMembership() {
    const songIds = rows.map((row) => row.id);
    if (songIds.length === 0) {
      toast.error("Download songs before syncing playlist metadata.");
      return;
    }

    setIsSyncingPlaylistMembership(true);
    try {
      const cache = await syncOfflinePlaylistMembership(songIds);
      setMembershipCache(cache);
      hapticConfirm();
      const count = Object.keys(cache.playlists).length;
      toast.success(
        `Synced ${count} playlist${count === 1 ? "" : "s"} for offline use`,
      );
    } catch (err) {
      console.error("[downloads] playlist membership sync failed", err);
      toast.error(
        "Connect to the server to refresh offline playlist metadata.",
      );
    } finally {
      setIsSyncingPlaylistMembership(false);
    }
  }

  async function removeCollection(row: DownloadedCollectionRow) {
    setConfirmCollection(null);
    setIsRemoving(true);
    try {
      await removeContainerDownload(row.id, row.songIds);
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="px-4 pb-4 pt-safe-4 lg:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link
                to="/settings#settings-downloads"
                aria-label="Back to settings"
              >
                <ChevronLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
              <HardDrive className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Downloaded Songs</h1>
              <p className="text-sm text-muted-foreground">
                Manage music stored on this device
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 px-4 lg:px-6 py-6 pb-24 space-y-4">
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {rows.length} downloaded song{rows.length === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(totalBytes)} stored locally
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedCount === 0 || isRemoving}
              onClick={() => {
                hapticDestructive();
                setConfirmSelectedOpen(true);
              }}
            >
              {isRemoving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Remove selected
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Offline playlist metadata</p>
              <p className="text-xs text-muted-foreground">
                {membershipCache
                  ? `${syncedPlaylistCount} playlist${syncedPlaylistCount === 1 ? "" : "s"} indexed. Last synced ${new Date(
                      membershipCache.syncedAt,
                    ).toLocaleString()}.`
                  : "Not synced yet. Refresh while online to play downloaded songs from playlists offline."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length === 0 || isSyncingPlaylistMembership}
              onClick={() => {
                hapticSelection();
                void syncPlaylistMembership();
              }}
            >
              {isSyncingPlaylistMembership ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Refresh playlists
            </Button>
          </CardContent>
        </Card>

        {collectionRows.length > 0 && (
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30">
              <p className="text-sm font-medium">Downloaded collections</p>
              <p className="text-xs text-muted-foreground">
                Remove album, artist, or playlist downloads as a group
              </p>
            </div>
            <div>
              {collectionRows.map((row, index) => (
                <div key={row.id}>
                  <DownloadedCollectionListRow
                    row={row}
                    disabled={isRemoving}
                    onRemove={() => {
                      hapticDestructive();
                      setConfirmCollection(row);
                    }}
                  />
                  {index < collectionRows.length - 1 && (
                    <Separator className="ml-14" />
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="flex-1 min-h-[420px] overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              disabled={rows.length === 0}
              onCheckedChange={(checked) => toggleAll(checked === true)}
              aria-label={allSelected ? "Deselect all" : "Select all"}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : "Stored offline"}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedCount > 0
                  ? `${formatFileSize(selectedBytes)} selected for removal`
                  : "Select songs to remove their offline copies"}
              </p>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="min-h-[320px] flex flex-col items-center justify-center text-center px-6 py-12 text-muted-foreground">
              <Download className="w-10 h-10 mb-3 opacity-60" />
              <p className="font-medium text-foreground">
                {isLoadingMetadata
                  ? "Loading downloads"
                  : "No downloaded songs"}
              </p>
              <p className="text-sm mt-1 max-w-sm">
                {isLoadingMetadata
                  ? "Checking the local download index on this device."
                  : "Songs you save for offline playback will appear here."}
              </p>
            </div>
          ) : (
            <div
              ref={parentRef}
              className="h-[60dvh] min-h-[360px] overflow-auto"
            >
              <div
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const row = rows[virtualItem.index];
                  return (
                    <div
                      key={virtualItem.key}
                      className="absolute left-0 right-0"
                      style={{
                        height: virtualItem.size,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <DownloadedSongListRow
                        row={row}
                        selected={selectedIds.has(row.id)}
                        disabled={isRemoving}
                        onSelectedChange={(checked) =>
                          toggleSelected(row.id, checked)
                        }
                        onRemove={() => {
                          hapticDestructive();
                          setConfirmSingleId(row.id);
                        }}
                      />
                      {virtualItem.index < rows.length - 1 && (
                        <Separator className="ml-20" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </main>

      <AlertDialog
        open={confirmSelectedOpen}
        onOpenChange={setConfirmSelectedOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove selected downloads?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {selectedCount} offline song
              {selectedCount === 1 ? "" : "s"} from this device and frees up{" "}
              {formatFileSize(selectedBytes)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeSelected}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmSingleId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmSingleId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this download?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the offline copy from this device. You can download
              the song again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmSingleId) void removeSingle(confirmSingleId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmCollection !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmCollection(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove this collection download?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes {confirmCollection?.completedCount ?? 0} offline song
              {(confirmCollection?.completedCount ?? 0) === 1
                ? ""
                : "s"} from {confirmCollection?.title ?? "this collection"} and
              frees up {formatFileSize(confirmCollection?.bytes ?? 0)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmCollection) void removeCollection(confirmCollection);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove collection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function buildCollectionRows(
  containers: ReadonlyMap<string, string[]>,
  stateMap: ReadonlyMap<string, { status: string; bytesDownloaded: number }>,
  songsById: Record<string, Song>,
  membershipCache: OfflinePlaylistMembershipCache | null,
): DownloadedCollectionRow[] {
  return Array.from(containers.entries())
    .map(([containerId, songIds]) => {
      const parsed = parseContainerId(containerId);
      if (!parsed) return null;

      const uniqueSongIds = Array.from(new Set(songIds));
      const completedIds = uniqueSongIds.filter(
        (id) => stateMap.get(id)?.status === "completed",
      );
      const bytes = uniqueSongIds.reduce(
        (sum, id) => sum + (stateMap.get(id)?.bytesDownloaded ?? 0),
        0,
      );

      return {
        id: containerId,
        sourceId: parsed.sourceId,
        type: parsed.type,
        title: collectionTitle(
          parsed.type,
          parsed.sourceId,
          uniqueSongIds,
          songsById,
          membershipCache,
        ),
        songIds: uniqueSongIds,
        completedCount: completedIds.length,
        bytes,
      } satisfies DownloadedCollectionRow;
    })
    .filter((row): row is DownloadedCollectionRow => row !== null)
    .sort((a, b) =>
      a.type === b.type
        ? a.title.localeCompare(b.title)
        : collectionTypeOrder(a.type) - collectionTypeOrder(b.type),
    );
}

function parseContainerId(
  containerId: string,
): { type: DownloadedCollectionType; sourceId: string } | null {
  const separator = containerId.indexOf(":");
  if (separator <= 0) return null;
  const type = containerId.slice(0, separator);
  const sourceId = containerId.slice(separator + 1);
  if (type !== "album" && type !== "artist" && type !== "playlist") {
    return null;
  }
  return { type, sourceId };
}

function collectionTitle(
  type: DownloadedCollectionType,
  sourceId: string,
  songIds: string[],
  songsById: Record<string, Song>,
  membershipCache: OfflinePlaylistMembershipCache | null,
): string {
  if (type === "playlist") {
    return membershipCache?.playlists[sourceId]?.name ?? `Playlist ${sourceId}`;
  }

  const songs = songIds
    .map((id) => songsById[id])
    .filter((song): song is Song => song !== undefined);
  if (type === "album") {
    return songs.find((song) => song.album)?.album ?? `Album ${sourceId}`;
  }

  return songs.find((song) => song.artist)?.artist ?? `Artist ${sourceId}`;
}

function collectionTypeOrder(type: DownloadedCollectionType): number {
  switch (type) {
    case "album":
      return 0;
    case "artist":
      return 1;
    case "playlist":
      return 2;
  }
}

function DownloadedCollectionListRow({
  row,
  disabled,
  onRemove,
}: {
  row: DownloadedCollectionRow;
  disabled: boolean;
  onRemove: () => void;
}) {
  const Icon =
    row.type === "album"
      ? Album
      : row.type === "artist"
        ? UserRound
        : ListMusic;
  const typeLabel =
    row.type === "album"
      ? "Album"
      : row.type === "artist"
        ? "Artist"
        : "Playlist";

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{row.title}</p>
        <p className="text-xs text-muted-foreground truncate">
          {typeLabel} • {row.completedCount} downloaded song
          {row.completedCount === 1 ? "" : "s"} • {formatFileSize(row.bytes)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remove ${row.title} download`}
      >
        <Trash2 className="w-4 h-4 text-destructive" />
      </Button>
    </div>
  );
}

function DownloadedSongListRow({
  row,
  selected,
  disabled,
  onSelectedChange,
  onRemove,
}: {
  row: DownloadedSongRow;
  selected: boolean;
  disabled: boolean;
  onSelectedChange: (checked: boolean) => void;
  onRemove: () => void;
}) {
  const { song } = row;
  const title = song?.title ?? row.id;
  const subtitle = song
    ? [song.artist, song.album].filter(Boolean).join(" • ")
    : "Downloaded song metadata is unavailable offline";

  return (
    <div
      className={cn(
        "h-full flex items-center gap-3 px-4 py-2 transition-colors",
        selected && "bg-primary/5",
      )}
    >
      <Checkbox
        checked={selected}
        disabled={disabled}
        onCheckedChange={(checked) => onSelectedChange(checked === true)}
        aria-label={`Select ${title}`}
      />
      <CoverImage
        src={null}
        inlineData={song?.coverArtData ?? null}
        alt={title}
        colorSeed={song?.album ?? title}
        type="song"
        size="sm"
        priority={false}
        lazy={false}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          {song ? (
            <>
              <span>{formatDuration(song.duration)}</span>
              <span aria-hidden="true">•</span>
            </>
          ) : (
            <Music2 className="w-3 h-3" />
          )}
          <span>{formatFileSize(row.bytes)}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remove ${title} download`}
      >
        <Trash2 className="w-4 h-4 text-destructive" />
      </Button>
    </div>
  );
}
