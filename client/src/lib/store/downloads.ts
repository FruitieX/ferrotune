import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithServerStorage } from "@/lib/store/server-storage";

/**
 * Download settings (synced across devices via server preferences).
 *
 * Mirrors the transcoding-atoms pattern in player.ts. The native
 * DownloadManager re-reads these via the setDownloadWifiOnly / enqueueDownload
 * commands whenever they change (Phase 4 wires the UI to native propagation).
 */

/** Format for offline downloads. Default transcodes to Opus at `downloadBitrateAtom`. */
export type DownloadFormat = "opus" | "original";
export const downloadFormatAtom = atomWithServerStorage<DownloadFormat>(
  "downloadFormat",
  "opus",
);

/**
 * Bitrate (kbps) used when `downloadFormatAtom === "opus"`.
 * Defaults to 128 (smaller than the streaming default of 192, since the goal
 * is storage-efficient offline files). Ignored for `"original"` downloads.
 */
export const downloadBitrateAtom = atomWithServerStorage<number>(
  "downloadBitrate",
  128,
);

/**
 * When true, downloads won't progress over metered connections. Defaults
 * to false because Android often reports emulator and VPN-backed Wi-Fi as
 * metered, which makes new downloads appear to do nothing.
 */
export const downloadWifiOnlyAtom = atomWithServerStorage<boolean>(
  "downloadWifiOnly",
  false,
);

/**
 * State of a single song's download, projected from native events.
 *
 * `none` means the song isn't queued or downloaded; the UI shows nothing.
 * `queued` / `downloading` / `completed` / `failed` / `paused` are the
 * same enum values the native DownloadStatus Kotlin emits.
 */
export type DownloadStatus =
  | "none"
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "removing"
  | "paused";

export interface SongDownloadState {
  status: DownloadStatus;
  /** 0–100, or -1 if the total size is unknown. */
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
  failureReason?: string;
}

const DEFAULT_STATE: SongDownloadState = {
  status: "none",
  percent: -1,
  bytesDownloaded: 0,
  bytesTotal: 0,
};

/**
 * Live map of songId → download state. Populated by download-manager.ts
 * from native `download-state-changed` events and the initial `getDownloads()`
 * snapshot. Written through `downloadStateMapAtom` (an action atom) so React
 * subscribers re-render atomically.
 *
 * Reading per-song state should use the `useDownloadState(songId)` hook which
 * derives a stable `SongDownloadState` from this map.
 */
export const downloadStateMapAtom = atom<
  ReadonlyMap<string, SongDownloadState>
>(new Map());

/** Write-only action atom — call `setDownloadStateMap(map)` to refresh. */
export const setDownloadStateMapAtom = atom(
  null,
  (_get, set, next: ReadonlyMap<string, SongDownloadState>) => {
    set(downloadStateMapAtom, next);
  },
);

/**
 * Snapshot of all song IDs known to be fully downloaded locally.
 * Derived from `downloadStateMapAtom` so consumers don't need to re-derive
 * on every state change. Used by the offline-mode queue filter and the
 * "unavailable offline" row dimming.
 */
export const downloadedSongsAtom = atom<Set<string>>((get) => {
  const map = get(downloadStateMapAtom);
  const set = new Set<string>();
  for (const [id, state] of map) {
    if (state.status === "completed") set.add(id);
  }
  return set;
});

/**
 * Map of container id (`album:<id>`, `artist:<id>`, `playlist:<id>`) →
 * songIds. Rehydrated from IndexedDB on app boot by `download-manager.ts`.
 *
 * Used by album/artist/playlist menus to render "Downloaded" vs "Download"
 * without an async fetch when the user opens the menu.
 */
export const downloadedContainersAtom = atom<ReadonlyMap<string, string[]>>(
  new Map(),
);

/** Write-only action atom for replacing the entire container index. */
export const setDownloadedContainersAtom = atom(
  null,
  (_get, set, next: ReadonlyMap<string, string[]>) => {
    set(downloadedContainersAtom, next);
  },
);

/** Convenience hook for reading whether a container is fully downloaded. */
export function useContainerDownloaded(containerId: string): boolean {
  const containers = useAtomValue(downloadedContainersAtom);
  const downloaded = useAtomValue(downloadedSongsAtom);
  const songIds = containers.get(containerId);
  if (!songIds || songIds.length === 0) return false;
  return songIds.every((id) => downloaded.has(id));
}

/** Whether downloads are globally paused (metered network or manual pause). */
export const downloadsPausedAtom = atom<boolean>(false);

/**
 * True when the app cannot reach the Ferrotune server at all. Toggled by
 * a network-listener + reachability probe mounted in providers.tsx (Phase 5).
 *
 * When `true`, the UI dims rows for songs that aren't downloaded, queue
 * materialization filters to downloaded songs, and the auth bootstrap skips
 * the `/api/auth/me` round-trip.
 */
export const isOfflineModeAtom = atom<boolean>(false);

/**
 * Derived per-song download state. Default-folds to `{ status: "none" }` so
 * React consumers can render the OfflineStatusIcon conditionally without
 * extra null checks.
 */
export function deriveDownloadState(
  map: ReadonlyMap<string, SongDownloadState>,
  songId: string,
): SongDownloadState {
  return map.get(songId) ?? DEFAULT_STATE;
}

/** Convenience hook for reading a single song's download state reactively. */
export function useDownloadState(songId: string): SongDownloadState {
  const map = useAtomValue(downloadStateMapAtom);
  return deriveDownloadState(map, songId);
}

/** Convenience hook for writing the live download state map. */
export function useSetDownloadStateMap() {
  return useSetAtom(setDownloadStateMapAtom);
}

/**
 * Returns `true` when the device is offline *and* the song isn't downloaded.
 * Used by song-row / media-card to gray out unavailable entries.
 */
export function useOfflineUnavailableSong(songId: string): boolean {
  const isOffline = useAtomValue(isOfflineModeAtom);
  const downloaded = useAtomValue(downloadedSongsAtom);
  return isOffline && !downloaded.has(songId);
}
