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

import { getDefaultStore } from "jotai";
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
} from "@/lib/store/downloads";
import { getDownloadedSongs } from "@/lib/offline/download-manager";
import { hasNativeAudio } from "@/lib/tauri";
import { nativeInvalidateQueue } from "@/lib/audio/native-engine";

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
export async function materializeOfflineQueueIfPossible(params: {
  sourceType: string;
  sourceId?: string | null;
  sourceName?: string | null;
  startIndex?: number;
  startSongId?: string;
  shuffle?: boolean;
}): Promise<boolean> {
  const store = getDefaultStore();
  if (!store.get(isOfflineModeAtom)) return false;

  const containerKey = containerKeyForSource(
    params.sourceType,
    params.sourceId,
  );
  if (!containerKey) {
    toast.error(
      "You're offline — only downloaded albums, artists, and playlists are playable.",
    );
    return true;
  }

  const songIds = store.get(downloadedContainersAtom).get(containerKey);
  if (!songIds || songIds.length === 0) {
    toast.error(
      "This album hasn't been downloaded — you can't play it offline.",
    );
    return true;
  }

  // Build the queue synchronously from the persisted IndexedDB song metadata.
  const songsById = await getDownloadedSongs();
  const songs: Song[] = [];
  for (const id of songIds) {
    const song = songsById[id];
    if (song) songs.push(song);
  }
  if (songs.length === 0) {
    toast.error("No downloaded songs found for this album.");
    return true;
  }

  const startIndex = Math.min(
    Math.max(params.startIndex ?? 0, 0),
    songs.length - 1,
  );

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
    name: params.sourceName ?? null,
    filters: null,
    sort: null,
    instanceId: crypto.randomUUID(),
  };

  const REPEAT_OFF: RepeatMode = "off";

  store.set(isQueueOperationPendingAtom, true);
  store.set(isRestoringQueueAtom, false);

  try {
    store.set(serverQueueStateAtom, {
      totalCount: ordered.length,
      currentIndex: startIndex,
      positionMs: 0,
      isShuffled,
      repeatMode: REPEAT_OFF,
      source,
    });
    store.set(queueWindowAtom, queueWindow);

    if (hasNativeAudio()) {
      void nativeInvalidateQueue(true).catch((err) => {
        console.error("[offline] nativeInvalidateQueue failed", err);
      });
    } else {
      store.set(trackChangeSignalAtom, store.get(trackChangeSignalAtom) + 1);
    }
    return true;
  } catch (err) {
    console.error("[offline] materializeOfflineQueue failed", err);
    toast.error("Couldn't start offline playback");
    return true;
  } finally {
    store.set(isQueueOperationPendingAtom, false);
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
