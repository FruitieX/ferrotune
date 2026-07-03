import { cacheGet, cacheSet } from "@/lib/cache-store";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import type { WaveformResponse } from "@/lib/api/generated/WaveformResponse";

export const OFFLINE_WAVEFORM_PREFIX = "offline:waveform:";

function waveformKey(songId: string): string {
  return `${OFFLINE_WAVEFORM_PREFIX}${songId}`;
}

export async function getCachedOfflineWaveform(
  songId: string,
): Promise<WaveformResponse | null> {
  return (await cacheGet<WaveformResponse>(waveformKey(songId))) ?? null;
}

export async function prefetchOfflineWaveform(songId: string): Promise<void> {
  try {
    const client = getClient();
    if (!client) return;
    const waveform = await client.getWaveform(songId);
    if (waveform?.heights?.length) {
      await cacheOfflineWaveform(songId, waveform);
    }
  } catch (error) {
    console.debug("[downloads] waveform prefetch skipped", { songId, error });
  }
}

export async function cacheOfflineWaveform(
  songId: string,
  waveform: WaveformResponse,
): Promise<void> {
  if (!waveform.heights?.length) return;
  await cacheSet(waveformKey(songId), waveform, { pinned: true });
}

export async function withHighQualityOfflineCover(song: Song): Promise<Song> {
  if (!song.coverArt) return song;

  try {
    const client = getClient();
    if (!client) return song;
    const response = await fetch(client.getCoverArtUrl(song.coverArt, "large"));
    if (!response.ok) return song;
    const blob = await response.blob();
    const coverArtData = await blobToBase64(blob);
    return { ...song, coverArtData };
  } catch (error) {
    console.debug("[downloads] high quality cover prefetch skipped", {
      songId: song.id,
      error,
    });
    return song;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}
