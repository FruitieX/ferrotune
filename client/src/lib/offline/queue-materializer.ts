/**
 * Offline queue materialization.
 *
 * Used by `startQueueAtom` when `isOfflineModeAtom === true`. Builds a complete
 * `QueueState` + `QueueWindow` from the persisted downloaded-songs metadata
 * (IndexedDB via `getDownloadedSongs()`) without a network round-trip, then
 * triggers the native-side full-queue reload.
 *
 * Only known container sources are supported — album/artist/playlist — i.e.
 * things we can look up in `downloadedContainersAtom`. For other sources
 * (library/search/history/etc.) we fail gracefully with a toast because we
 * don't have the song list cached locally and can't reach the server.
 */

import type { Getter, Setter } from "jotai/vanilla";
import { toast } from "sonner";
import type {
  QueueSourceInfo,
  QueueWindow,
  QueueSongEntry,
} from "@/lib/api/generated";
import type { Song } from "@/lib/api/types";
import type { RepeatMode } from "@/lib/store/server-queue";
import {
  serverQueueStateAtom,
  queueWindowAtom,
  trackChangeSignalAtom,
  isQueueOperationPendingAtom,
  isRestoringQueueAtom,
} from "@/lib/store/server-queue";
import {
  isOfflineModeAtom,
  downloadedContainersAtom,
  downloadedSongsAtom,
} from "@/lib/store/downloads";
import { getDownloadedSongs } from "@/lib/offline/download-manager";
import { getOfflinePlaylistMembershipForPlaylist } from "@/lib/offline/playlist-membership";

/**
 * Map a (sourceType, sourceId) pair to a container index key.
 * Returns `null` for source types we can't materialize offline.
 */
export function containerKeyForSource(
  sourceType: string,
  sourceId?: string | null,
): string | null {
  if (!sourceId) return null;
  switch (sourceType) {
    case "album":
    case "artist":
    case "playlist":
      return `${sourceType}:${sourceId}`;
    default:
      return null;
  }
}

/**
 * Build the offline queue from cached song metadata when the device is offline
 * but the user is starting a container they previously downloaded.
 *
 * Returns `true` if the offline queue was materialized (the caller should
 * short-circuit); `false` if the caller should fall through to the normal
 * server-side path.
 *
 * Side effects (when returning `true`): writes `serverQueueStateAtom`,
 * `queueWindowAtom`, increments `trackChangeSignalAtom` (or involes the
 * native-side full-queue reload), and shows a toast.
 */
export async function materializeOfflineQueueIfPossible(
  params: {
    sourceType: string;
    sourceId?: string | null;
    sourceName?: string | null;
    startIndex?: number;
    startSongId?: string;
    shuffle?: boolean;
    songIds?: string[];
    filters?: Record<string, unknown>;
    sort?: { field: string; direction: string };
    offlineSongIds?: string[];
  },
  get: Getter,
  set: Setter,
): Promise<boolean> {
  if (!get(isOfflineModeAtom)) return false;

  const containerKey = containerKeyForSource(
    params.sourceType,
    params.sourceId,
  );
  const songsById = await getDownloadedSongs();
  const downloadedIds = get(downloadedSongsAtom);
  const containers = get(downloadedContainersAtom);
  const explicitSongIds = params.songIds ?? [];
  const offlineSongIds = params.offlineSongIds ?? [];
  const containerSongIds = containerKey
    ? containers.get(containerKey)
    : undefined;
  let sourceSongIds: string[] = [];
  let offlineSourceName: string | null = null;

  if (offlineSongIds.length > 0) {
    sourceSongIds = offlineSongIds;
  } else if (explicitSongIds.length > 0) {
    sourceSongIds = explicitSongIds;
  } else if (containerSongIds && containerSongIds.length > 0) {
    sourceSongIds = containerSongIds;
  } else if (params.sourceType === "playlist" && params.sourceId) {
    const playlist = await getOfflinePlaylistMembershipForPlaylist(
      params.sourceId,
    );
    if (playlist) {
      offlineSourceName = playlist.name;
      sourceSongIds = playlist.entries
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((entry) => entry.songId);
    }
  } else if (params.sourceType === "album" && params.sourceId) {
    sourceSongIds = Object.values(songsById)
      .filter((song) => song.albumId === params.sourceId)
      .map((song) => song.id);
  } else if (params.sourceType === "artist" && params.sourceId) {
    sourceSongIds = Object.values(songsById)
      .filter((song) => song.artistId === params.sourceId)
      .map((song) => song.id);
  }

  if (sourceSongIds.length === 0) {
    toast.error(offlineUnavailableMessage(params.sourceType));
    return true;
  }

  const songs: Song[] = [];
  for (const id of sourceSongIds) {
    if (!downloadedIds.has(id)) continue;
    const song = songsById[id];
    if (song) songs.push(song);
  }
  if (songs.length === 0) {
    toast.error(offlineUnavailableMessage(params.sourceType));
    return true;
  }

  const requestedStartId =
    params.startSongId ?? sourceSongIds[params.startIndex ?? 0];
  const startIndexFromSongId = requestedStartId
    ? songs.findIndex((song) => song.id === requestedStartId)
    : -1;
  const startIndex =
    startIndexFromSongId >= 0
      ? startIndexFromSongId
      : Math.min(Math.max(params.startIndex ?? 0, 0), songs.length - 1);

  // Apply shuffle if requested (Fisher-Yates — stable enough for the offline
  // case, serverside shuffling isn't reachable).
  let ordered = songs;
  const isShuffled = params.shuffle ?? false;
  if (isShuffled) {
    ordered = shuffleArray(songs);
    if (params.startSongId) {
      // Move the seed song to position 0 — matches the serverside behavior
      // where startSongId wins regardless of shuffle.
      const idx = ordered.findIndex((s) => s.id === params.startSongId);
      if (idx > 0) {
        const [moved] = ordered.splice(idx, 1);
        ordered.unshift(moved);
      }
    }
  }

  const queueWindow: QueueWindow = {
    offset: 0,
    songs: ordered.map<QueueSongEntry>((song, i) => ({
      entryId: `${song.id}-${i}`,
      sourceEntryId: null,
      position: i,
      song,
    })),
  };

  const source: QueueSourceInfo = {
    type: params.sourceType,
    id: params.sourceId ?? null,
    name: params.sourceName ?? offlineSourceName,
    filters: { ...(params.filters ?? {}), offline: true },
    sort: params.sort ?? null,
    instanceId: crypto.randomUUID(),
  };

  const REPEAT_OFF: RepeatMode = "off";

  set(isQueueOperationPendingAtom, true);
  set(isRestoringQueueAtom, false);

  try {
    set(serverQueueStateAtom, {
      totalCount: ordered.length,
      currentIndex: startIndex,
      positionMs: 0,
      isShuffled,
      repeatMode: REPEAT_OFF,
      source,
    });
    set(queueWindowAtom, queueWindow);
    set(trackChangeSignalAtom, get(trackChangeSignalAtom) + 1);
    return true;
  } catch (err) {
    console.error("[offline] materializeOfflineQueue failed", err);
    toast.error("Couldn't start offline playback");
    return true;
  } finally {
    set(isQueueOperationPendingAtom, false);
  }
}

function offlineUnavailableMessage(sourceType: string): string {
  switch (sourceType) {
    case "album":
      return "No downloaded songs found for this album.";
    case "artist":
      return "No downloaded songs found for this artist.";
    case "playlist":
      return "No downloaded songs found for this playlist. Refresh offline playlist metadata while online if this looks wrong.";
    default:
      return "You're offline — only downloaded songs are playable.";
  }
}

/** In-place Fisher-Yates shuffle that returns a new array. */
function shuffleArray<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
