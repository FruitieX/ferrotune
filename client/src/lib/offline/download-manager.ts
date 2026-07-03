/**
 * Download manager: subscribes to native `download-state-changed` events
 * (emitted by FerrotuneDownloadService via the ferrotune:native-audio-event
 * CustomEvent channel) and mirrors them into the Jotai store.
 *
 * Also persists downloaded song metadata + container membership to the
 * per-account IndexedDB cache store so the offline UI (queue filtering,
 * downloaded library views) survives relaunch.
 *
 * The native side is the single source of truth for download state and
 * byte-level progress. This module only translates native events into JS
 * atoms and persists metadata so the JS side can render offline UI without
 * a fresh native snapshot.
 */

import type {
  DownloadInfo,
  DownloadStateEventPayload,
} from "tauri-plugin-native-audio-api";
import {
  onDownloadStateChanged,
  getDownloads,
} from "tauri-plugin-native-audio-api";
import { isTauriMobile } from "@/lib/tauri";
import { cacheGet, cacheSet, cacheDelByPrefix } from "@/lib/cache-store";
import { clearOfflinePlaylistMembership } from "@/lib/offline/playlist-membership";
import type { SongDownloadState, DownloadStatus } from "@/lib/store/downloads";
import {
  setDownloadStateMapAtom,
  downloadStateMapAtom,
  downloadsPausedAtom,
  setDownloadedContainersAtom,
  downloadedContainersAtom,
} from "@/lib/store/downloads";
import type { Song } from "@/lib/api/types";
import type { Store } from "jotai/vanilla/store";

const DOWNLOADED_SONGS_KEY = "offline:downloader:songs";
const CONTAINER_PREFIX = "offline:downloaded-container:";

interface PersistedDownloadState {
  /** Map of songId → minimal metadata, used for offline UI rehydration. */
  songs: Record<string, Song>;
  /** Map of contentId → songIds, for container download tracking. */
  containers: Record<string, string[]>;
}

let unsubscribeNative: (() => void) | null = null;
let activeStore: Store | null = null;

function statusFromNative(s: DownloadInfo["status"]): DownloadStatus {
  switch (s) {
    case "queued":
      return "queued";
    case "downloading":
      return "downloading";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "removing":
      return "removing";
    case "paused":
      return "paused";
    default:
      return "none";
  }
}

function downloadInfoToState(info: DownloadInfo): SongDownloadState {
  return {
    status: statusFromNative(info.status),
    percent: info.percent,
    bytesDownloaded: info.bytesDownloaded,
    bytesTotal: info.bytesTotal,
    failureReason: info.failureReason,
  };
}

function replaceSnapshot(
  store: Store,
  downloads: DownloadInfo[],
  paused: boolean,
) {
  const next = new Map<string, SongDownloadState>();
  for (const d of downloads) {
    if (d.kind !== "audio") continue;
    next.set(d.songId, downloadInfoToState(d));
  }
  store.set(setDownloadStateMapAtom, next);
  store.set(downloadsPausedAtom, paused);
}

function applyDownloadUpdates(
  store: Store,
  downloads: DownloadInfo[],
  paused: boolean,
) {
  const next = new Map(store.get(downloadStateMapAtom));
  for (const d of downloads) {
    if (d.kind !== "audio") continue;
    const state = downloadInfoToState(d);
    if (state.status === "removing") {
      next.delete(d.songId);
    } else {
      next.set(d.songId, state);
    }
  }
  store.set(setDownloadStateMapAtom, next);
  store.set(downloadsPausedAtom, paused);
}

/**
 * Rehydrate the container index (album:/artist:/playlist: → songIds) from
 * the persisted IndexedDB store into a reactive atom so menu UI can render
 * "Downloaded" vs "Download" without an async lookup on every render.
 */
async function rehydrateContainerIndex(store: Store): Promise<void> {
  try {
    const state = await cacheGet<PersistedDownloadState>(DOWNLOADED_SONGS_KEY);
    const containers = state?.containers ?? {};
    const next = new Map<string, string[]>();
    for (const [containerId, songIds] of Object.entries(containers)) {
      next.set(containerId, songIds);
    }
    store.set(setDownloadedContainersAtom, next);
  } catch (err) {
    console.warn("[downloads] failed to rehydrate container index", err);
  }
}

/**
 * Keep the in-memory `downloadedContainersAtom` in sync with the persisted
 * IndexedDB state after a container is added, updated, or removed.
 *
 * Reads the current in-memory atom, mutates a copy, and writes it back so
 * any subscribers (menus) re-render immediately.
 */
function syncContainerAtom(mutate: (map: Map<string, string[]>) => void): void {
  const store = activeStore;
  if (!store) return;

  const prev = store.get(downloadedContainersAtom);
  const next = new Map(prev);
  mutate(next);
  store.set(setDownloadedContainersAtom, next);
}

/**
 * Initialize the download manager subscription. Idempotent; safe to call
 * multiple times (e.g. after account switch).
 *
 * On non-Tauri platforms this is a no-op and the store stays empty.
 */
export async function initDownloadManager(store: Store): Promise<void> {
  activeStore = store;

  if (!isTauriMobile()) return;

  // 1) Subscribe to native download-state-changed events
  if (!unsubscribeNative) {
    try {
      unsubscribeNative = onDownloadStateChanged(
        (payload: DownloadStateEventPayload) => {
          if (!activeStore) return;
          applyDownloadUpdates(activeStore, payload.downloads, payload.paused);
        },
      );
    } catch (err) {
      console.warn("[downloads] failed to subscribe to native events", err);
    }
  }

  // 2) Rehydrate the persisted downloaded-songs map from IndexedDB
  await persistServerStateSubscription();
  await rehydrateContainerIndex(store);

  // 3) Ask the native side for an initial snapshot (covers the
  //    relaunch-with-pending-downloads case where the DownloadManager
  //    already has downloads)
  try {
    const snapshot = await getDownloads();
    replaceSnapshot(store, snapshot, false);
  } catch (err) {
    console.warn("[downloads] failed to fetch initial snapshot", err);
  }
}

/**
 * No-op placeholder. The offline song metadata persistence is wired up through
 * `persistDownloadedSong` / `removeDownloadedSong` calls in
 * `use-download-actions.ts`. This function exists so the initial rehydration
 * is a single readable entrypoint.
 */
async function persistServerStateSubscription(): Promise<void> {
  try {
    const state = await cacheGet<PersistedDownloadState>(DOWNLOADED_SONGS_KEY);
    if (state?.songs) {
      // Note: the per-song download state from the native snapshot (above)
      // takes precedence; we don't rehydrate the per-song status from
      // IndexedDB because the DownloadManager is the source of truth.
      // Persisted songs here are used by `useDownloadActions` for the
      // offline queue builder and downloaded-library view.
    }
  } catch {
    // best-effort; ignore
  }
}

/**
 * Persist a song's metadata to the offline IndexedDB store so the offline
 * queue builder and downloaded-library views have something to render with
 * when the server is unreachable.
 *
 * Called by `use-download-actions.downloadSong` after enqueueing.
 */
export async function persistDownloadedSong(song: Song): Promise<void> {
  try {
    const state = (await cacheGet<PersistedDownloadState>(
      DOWNLOADED_SONGS_KEY,
    )) ?? {
      songs: {},
      containers: {},
    };
    state.songs[song.id] = song;
    await cacheSet(DOWNLOADED_SONGS_KEY, state, { pinned: true });
  } catch (err) {
    console.warn("[downloads] failed to persist song", song.id, err);
  }
}

/**
 * Remove a song from the offline metadata store. Called by
 * `use-download-actions.removeDownload` after the native removal completes.
 */
export async function removeDownloadedSong(songId: string): Promise<void> {
  try {
    const state = await cacheGet<PersistedDownloadState>(DOWNLOADED_SONGS_KEY);
    if (!state?.songs) return;
    if (!(songId in state.songs)) return;
    delete state.songs[songId];
    // Drop the song from any container membership it was in
    for (const [containerId, songIds] of Object.entries(state.containers)) {
      const next = songIds.filter((id) => id !== songId);
      if (next.length === 0) {
        delete state.containers[containerId];
      } else {
        state.containers[containerId] = next;
      }
    }
    await cacheSet(DOWNLOADED_SONGS_KEY, state, { pinned: true });
    syncContainerAtom((map) => {
      for (const [containerId, songIds] of map) {
        const filtered = songIds.filter((id) => id !== songId);
        if (filtered.length === 0) {
          map.delete(containerId);
        } else {
          map.set(containerId, filtered);
        }
      }
    });
  } catch (err) {
    console.warn("[downloads] failed to remove song", songId, err);
  }
}

/**
 * Persist a one-shot container download mapping (container id → songIds).
 * Called by `use-download-actions.downloadAlbum/Artist/Playlist` after
 * enqueuing each song.
 *
 * One-shot means we don't auto-expand the container when the server's
 * content changes later — the membership is a snapshot at download time.
 */
export async function persistDownloadedContainer(
  containerId: string,
  songIds: string[],
): Promise<void> {
  try {
    const state = (await cacheGet<PersistedDownloadState>(
      DOWNLOADED_SONGS_KEY,
    )) ?? {
      songs: {},
      containers: {},
    };
    state.containers[containerId] = songIds;
    await cacheSet(DOWNLOADED_SONGS_KEY, state, { pinned: true });
    syncContainerAtom((map) => {
      map.set(containerId, songIds);
    });
  } catch (err) {
    console.warn("[downloads] failed to persist container", containerId, err);
  }
}

export async function removeDownloadedContainer(
  containerId: string,
): Promise<void> {
  try {
    const state = await cacheGet<PersistedDownloadState>(DOWNLOADED_SONGS_KEY);
    if (!state?.containers) return;
    delete state.containers[containerId];
    await cacheSet(DOWNLOADED_SONGS_KEY, state, { pinned: true });
    syncContainerAtom((map) => {
      map.delete(containerId);
    });
  } catch (err) {
    console.warn("[downloads] failed to remove container", containerId, err);
  }
}

/** Read the persisted downloaded-songs map for offline rendering. */
export async function getDownloadedSongs(): Promise<Record<string, Song>> {
  try {
    const state = await cacheGet<PersistedDownloadState>(DOWNLOADED_SONGS_KEY);
    return state?.songs ?? {};
  } catch {
    return {};
  }
}

/** Read persisted container → songIds mapping for offline rendering. */
export async function getDownloadedContainers(): Promise<
  Record<string, string[]>
> {
  try {
    const state = await cacheGet<PersistedDownloadState>(DOWNLOADED_SONGS_KEY);
    return state?.containers ?? {};
  } catch {
    return {};
  }
}

/** Clear all persisted downloaded songs + containers. */
export async function clearDownloadedMetadata(): Promise<void> {
  await cacheDelByPrefix("offline:downloaded-container:");
  await clearOfflinePlaylistMembership();
  await cacheSet(
    DOWNLOADED_SONGS_KEY,
    { songs: {}, containers: {} },
    {
      pinned: true,
    },
  );
  syncContainerAtom((map) => {
    map.clear();
  });
}

/** Teardown. Called on account switch / logout. */
export function teardownDownloadManager() {
  unsubscribeNative?.();
  unsubscribeNative = null;
  // Reset the store atom to empty so state from the previous account
  // doesn't leak (downloads are device-shared via content-key canonicalization
  // but the Jotai state map is account-scoped for cache invalidation).
  if (activeStore) {
    activeStore.set(setDownloadStateMapAtom, new Map());
    activeStore.set(setDownloadedContainersAtom, new Map());
    activeStore.set(downloadsPausedAtom, false);
  }
  activeStore = null;
}

// Re-export CONTAINER_PREFIX for any consumer that interacts with the
// key namespace (maintenance / clear-all flows).
export { CONTAINER_PREFIX as OFFLINE_CONTAINER_PREFIX };
