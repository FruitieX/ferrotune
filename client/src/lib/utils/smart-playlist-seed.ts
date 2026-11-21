/**
 * Seeds for smart playlists sorted randomly. The server shuffles with the seed
 * a view sends, so every page of that view (fetched in any order) continues
 * one order instead of reshuffling. One seed per playlist per page load keeps
 * revisits on the same order and lets cached pages be reused.
 */
const seeds = new Map<string, number>();

export function smartPlaylistSeed(playlistId: string): number {
  let seed = seeds.get(playlistId);
  if (seed === undefined) {
    seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    seeds.set(playlistId, seed);
  }
  return seed;
}
