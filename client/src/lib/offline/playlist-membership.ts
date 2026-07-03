import type { PlaylistMembershipPlaylist } from "@/lib/api/generated/PlaylistMembershipPlaylist";
import { getClient } from "@/lib/api/client";
import { cacheDel, cacheGet, cacheSet } from "@/lib/cache-store";

const OFFLINE_PLAYLIST_MEMBERSHIP_KEY = "offline:playlist-membership";

export interface OfflinePlaylistMembershipCache {
  syncedAt: number;
  songIds: string[];
  playlists: Record<string, PlaylistMembershipPlaylist>;
}

export async function getOfflinePlaylistMembershipCache(): Promise<OfflinePlaylistMembershipCache | null> {
  try {
    return (
      (await cacheGet<OfflinePlaylistMembershipCache>(
        OFFLINE_PLAYLIST_MEMBERSHIP_KEY,
      )) ?? null
    );
  } catch {
    return null;
  }
}

export async function getOfflinePlaylistMembershipForPlaylist(
  playlistId: string,
): Promise<PlaylistMembershipPlaylist | null> {
  const cache = await getOfflinePlaylistMembershipCache();
  return cache?.playlists[playlistId] ?? null;
}

export async function syncOfflinePlaylistMembership(
  songIds: string[],
): Promise<OfflinePlaylistMembershipCache> {
  const client = getClient();
  if (!client) throw new Error("Not connected");

  const uniqueSongIds = Array.from(new Set(songIds)).filter(Boolean);
  const response = await client.syncPlaylistMembership(uniqueSongIds);
  const cache: OfflinePlaylistMembershipCache = {
    syncedAt: Date.now(),
    songIds: uniqueSongIds,
    playlists: Object.fromEntries(
      response.playlists.map((playlist) => [playlist.id, playlist]),
    ),
  };

  await cacheSet(OFFLINE_PLAYLIST_MEMBERSHIP_KEY, cache, { pinned: true });
  return cache;
}

export async function clearOfflinePlaylistMembership(): Promise<void> {
  await cacheDel(OFFLINE_PLAYLIST_MEMBERSHIP_KEY);
}
