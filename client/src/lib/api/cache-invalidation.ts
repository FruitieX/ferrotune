import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidate all queries that display song data.
 * Use when songs are created, deleted, restored, or their metadata changes.
 */
export function invalidateSongQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["songs"] });
  queryClient.invalidateQueries({ queryKey: ["album"] });
  queryClient.invalidateQueries({ queryKey: ["albums"] });
  queryClient.invalidateQueries({ queryKey: ["artist"] });
  queryClient.invalidateQueries({ queryKey: ["artists"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
  queryClient.invalidateQueries({ queryKey: ["starred"] });
  queryClient.invalidateQueries({ queryKey: ["starred-songs"] });
  queryClient.invalidateQueries({ queryKey: ["randomSongs"] });
  queryClient.invalidateQueries({ queryKey: ["playlistSongs"] });
  queryClient.invalidateQueries({ queryKey: ["genres"] });
}

/**
 * Invalidate queries after play counts or history changes.
 * Use after scrobbles, play count imports, or history modifications.
 */
export function invalidatePlayCountQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["songs"] });
  queryClient.invalidateQueries({ queryKey: ["album"] });
  queryClient.invalidateQueries({ queryKey: ["artist"] });
  queryClient.invalidateQueries({ queryKey: ["play-history"] });
  queryClient.invalidateQueries({ queryKey: ["starred-search"] });
  queryClient.invalidateQueries({ queryKey: ["playlistSongs"] });
  queryClient.invalidateQueries({ queryKey: ["randomSongs"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
  queryClient.invalidateQueries({ queryKey: ["starred"] });
  queryClient.invalidateQueries({ queryKey: ["periodReview"] });
}

/**
 * Invalidate playlist-related queries.
 * Use when playlists are created, deleted, or their metadata changes.
 */
export function invalidatePlaylistQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["playlists"] });
  queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
}

/**
 * Invalidate a specific playlist's songs.
 */
export function invalidatePlaylistSongs(
  queryClient: QueryClient,
  playlistId?: string,
): void {
  if (playlistId) {
    queryClient.invalidateQueries({ queryKey: ["playlistSongs", playlistId] });
  } else {
    queryClient.invalidateQueries({ queryKey: ["playlistSongs"] });
  }
}

/**
 * Invalidate smart playlist queries.
 */
export function invalidateSmartPlaylistQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
  queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
}

/**
 * Invalidate recycle bin queries.
 */
export function invalidateRecycleBinQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["recycleBin"] });
}

/**
 * Reset user-scoped queries after auth account changes.
 *
 * - Cancels in-flight requests so old-account responses cannot race into cache
 * - Removes inactive queries to prevent stale data flashes on navigation
 * - Resets active queries so mounted views refetch immediately
 */
export async function resetQueriesForAccountSwitch(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.removeQueries({ type: "inactive" });
  await queryClient.resetQueries({ type: "active" });
}
