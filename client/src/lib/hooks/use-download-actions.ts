"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  enqueueDownload,
  removeDownload,
  removeAllDownloads,
  pauseDownloads,
  resumeDownloads,
  setDownloadWifiOnly,
} from "tauri-plugin-native-audio-api";
import { isTauriMobile } from "@/lib/tauri";
import { getClient } from "@/lib/api/client";
import {
  hapticConfirm,
  hapticDestructive,
  hapticSelection,
} from "@/lib/utils/haptic";
import type { Song } from "@/lib/api/types";
import {
  downloadFormatAtom,
  downloadBitrateAtom,
  downloadWifiOnlyAtom,
  downloadStateMapAtom,
  deriveDownloadState,
  downloadedSongsAtom,
} from "@/lib/store/downloads";
import {
  persistDownloadedSong,
  persistDownloadedContainer,
  getDownloadedSongs,
  removeDownloadedSong,
  removeDownloadedContainer,
  clearDownloadedMetadata,
} from "@/lib/offline/download-manager";
import { syncOfflinePlaylistMembership } from "@/lib/offline/playlist-membership";
import {
  prefetchOfflineWaveform,
  withHighQualityOfflineCover,
} from "@/lib/offline/download-assets";

export interface DownloadActions {
  /** True if the song has been fully downloaded to the device. */
  isDownloaded: (songId: string) => boolean;
  /** Live per-song download state (queued / downloading / completed / failed). */
  getDownloadState: (songId: string) => ReturnType<typeof deriveDownloadState>;
  /** Enqueue a single song for offline download. */
  downloadSong: (song: Song) => Promise<void>;
  /** Cancel a queued download or remove a completed one. */
  removeSongDownload: (songId: string) => Promise<void>;
  /** Cancel or remove several song downloads with one user-facing result. */
  removeSongDownloads: (songIds: string[]) => Promise<boolean>;
  /** Enqueue every song in an album (one-shot snapshot). */
  downloadAlbum: (albumId: string) => Promise<void>;
  /** Enqueue every song across all of an artist's albums. */
  downloadArtist: (artistId: string) => Promise<void>;
  /**
   * Enqueue every song in a playlist. The caller is expected to already
   * have fetched the playlist's songs; pass them directly.
   */
  downloadPlaylist: (playlistId: string, songs: Song[]) => Promise<void>;
  /** Cancel any queued download / remove downloaded bytes for a container. */
  removeContainerDownload: (
    containerId: string,
    songIds: string[],
  ) => Promise<void>;
  /** Pause all in-flight downloads (resume later with `resumeAllDownloads`). */
  pauseAllDownloads: () => Promise<void>;
  /** Resume any paused or queued downloads. */
  resumeAllDownloads: () => Promise<void>;
  /** Remove every downloaded song + clear the persisted offline metadata. */
  clearAllDownloads: () => Promise<void>;
}

let lastPropagatedWifiOnly: boolean | null = null;

function unsupportedToast(): boolean {
  toast.error("Downloads are only available in the Ferrotune Android app.");
  return false;
}

export function useDownloadActions(): DownloadActions {
  const format = useAtomValue(downloadFormatAtom);
  const bitrate = useAtomValue(downloadBitrateAtom);
  const wifiOnly = useAtomValue(downloadWifiOnlyAtom);
  const stateMap = useAtomValue(downloadStateMapAtom);
  const downloaded = useAtomValue(downloadedSongsAtom);

  // Propagate the Wi-Fi-only setting to the native DownloadManager whenever
  // it changes. Kept in this hook so every consumer that binds to any other
  // download setting (format/bitrate) re-runs the side-effect-free native
  // propagate call once per app instance.
  useEffect(() => {
    void propagateWifiOnlyToNative(wifiOnly);
  }, [wifiOnly]);

  async function enqueue(song: Song): Promise<boolean> {
    if (!isTauriMobile()) return unsupportedToast();
    try {
      const maxBitRate = format === "opus" ? bitrate : 0;
      await enqueueDownload(song.id, format, maxBitRate);
      const enrichedSong = await withHighQualityOfflineCover(song);
      await persistDownloadedSong(enrichedSong);
      void prefetchOfflineWaveform(song.id);
      return true;
    } catch (err) {
      console.error("[downloads] enqueueDownload failed", err);
      toast.error(`Download failed to start: ${err}`);
      return false;
    }
  }

  async function removeSongs(
    songIds: string[],
    successMessage: string,
  ): Promise<boolean> {
    if (!isTauriMobile()) return false;
    const uniqueIds = Array.from(new Set(songIds));
    if (uniqueIds.length === 0) return true;

    try {
      await Promise.all(uniqueIds.map((id) => removeDownload(id)));
      await Promise.all(uniqueIds.map((id) => removeDownloadedSong(id)));
      hapticDestructive();
      toast.success(successMessage);
      return true;
    } catch (err) {
      console.error("[downloads] removeDownload failed", err);
      toast.error(`Failed to remove: ${err}`);
      return false;
    }
  }

  return {
    isDownloaded: (songId) => downloaded.has(songId),
    getDownloadState: (songId) => deriveDownloadState(stateMap, songId),
    downloadSong: async (song) => {
      const ok = await enqueue(song);
      if (ok) {
        hapticConfirm();
        toast.success(`Downloading "${song.title}" for offline use`);
      }
    },
    removeSongDownload: async (songId) => {
      await removeSongs([songId], "Removed offline copy");
    },
    removeSongDownloads: async (songIds) => {
      return removeSongs(
        songIds,
        `Removed ${songIds.length} offline cop${songIds.length === 1 ? "y" : "ies"}`,
      );
    },
    downloadAlbum: async (albumId) => {
      if (!isTauriMobile()) return;
      const client = getClient();
      if (!client) return;
      try {
        const response = await client.getAlbum(albumId);
        const songs = response.album.song ?? [];
        if (songs.length === 0) {
          toast.error("This album has no songs.");
          return;
        }
        let ok = 0;
        for (const song of songs) {
          if (await enqueue(song)) ok++;
        }
        if (ok > 0) {
          await persistDownloadedContainer(
            `album:${albumId}`,
            songs.map((s) => s.id),
          );
          hapticConfirm();
          toast.success(
            `Queued ${ok} song${ok === 1 ? "" : "s"} from the album for download`,
          );
        }
      } catch (err) {
        console.error("[downloads] downloadAlbum failed", err);
        toast.error(`Album download failed: ${err}`);
      }
    },
    downloadArtist: async (artistId) => {
      if (!isTauriMobile()) return;
      const client = getClient();
      if (!client) return;
      try {
        const artist = await client.getArtist(artistId);
        const albums = artist.artist.album ?? [];
        const allSongs: Song[] = [];
        for (const album of albums) {
          const detail = await client.getAlbum(album.id);
          for (const song of detail.album.song ?? []) {
            allSongs.push(song);
          }
        }
        if (allSongs.length === 0) {
          toast.error("This artist has no songs.");
          return;
        }
        let ok = 0;
        for (const song of allSongs) {
          if (await enqueue(song)) ok++;
        }
        if (ok > 0) {
          await persistDownloadedContainer(
            `artist:${artistId}`,
            allSongs.map((s) => s.id),
          );
          hapticConfirm();
          toast.success(
            `Queued ${ok} song${ok === 1 ? "" : "s"} from the artist for download`,
          );
        }
      } catch (err) {
        console.error("[downloads] downloadArtist failed", err);
        toast.error(`Artist download failed: ${err}`);
      }
    },
    downloadPlaylist: async (playlistId, songs) => {
      if (!isTauriMobile()) return;
      if (songs.length === 0) {
        toast.error("This playlist has no songs.");
        return;
      }
      let ok = 0;
      for (const song of songs) {
        if (await enqueue(song)) ok++;
      }
      if (ok > 0) {
        await persistDownloadedContainer(
          `playlist:${playlistId}`,
          songs.map((s) => s.id),
        );
        await refreshOfflinePlaylistMembership();
        hapticConfirm();
        toast.success(
          `Queued ${ok} song${ok === 1 ? "" : "s"} from the playlist for download`,
        );
      }
    },
    removeContainerDownload: async (containerId, songIds) => {
      if (!isTauriMobile()) return;
      try {
        await Promise.all(songIds.map((id) => removeDownload(id)));
        await removeDownloadedContainer(containerId);
        await Promise.all(songIds.map((id) => removeDownloadedSong(id)));
        hapticDestructive();
        toast.success("Removed offline copies");
      } catch (err) {
        console.error("[downloads] removeContainerDownload failed", err);
        toast.error(`Failed to remove: ${err}`);
      }
    },
    pauseAllDownloads: async () => {
      if (!isTauriMobile()) return;
      try {
        await pauseDownloads();
        hapticSelection();
      } catch (err) {
        console.error("[downloads] pauseDownloads failed", err);
      }
    },
    resumeAllDownloads: async () => {
      if (!isTauriMobile()) return;
      try {
        await resumeDownloads();
        hapticSelection();
      } catch (err) {
        console.error("[downloads] resumeDownloads failed", err);
      }
    },
    clearAllDownloads: async () => {
      if (!isTauriMobile()) return;
      try {
        await removeAllDownloads();
        await clearDownloadedMetadata();
        hapticDestructive();
        toast.success("Removed all offline downloads");
      } catch (err) {
        console.error("[downloads] clearAllDownloads failed", err);
        toast.error(`Failed to clear: ${err}`);
      }
    },
  };
}

async function refreshOfflinePlaylistMembership() {
  try {
    const songsById = await getDownloadedSongs();
    const songIds = Object.keys(songsById);
    if (songIds.length === 0) return;
    await syncOfflinePlaylistMembership(songIds);
  } catch (err) {
    console.warn(
      "[downloads] failed to refresh offline playlist metadata",
      err,
    );
  }
}

/**
 * Push the Wi-Fi-only flag to the native DownloadManager whenever the setting
 * changes. Mounted once at app boot (Phase 4 settings UI wires this up).
 */
export async function propagateWifiOnlyToNative(wifiOnly: boolean) {
  if (!isTauriMobile()) return;
  if (lastPropagatedWifiOnly === wifiOnly) return;
  lastPropagatedWifiOnly = wifiOnly;
  try {
    await setDownloadWifiOnly(wifiOnly);
  } catch (err) {
    lastPropagatedWifiOnly = null;
    console.warn("[downloads] setDownloadWifiOnly failed", err);
  }
}

// Re-export the wifiOnly atom for the settings UI to bind to without an extra
// import layer.
export { downloadWifiOnlyAtom };
