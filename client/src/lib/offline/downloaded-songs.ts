import type { Song } from "@/lib/api/types";
import { getDownloadedSongs } from "@/lib/offline/download-manager";

export function sortDownloadedSongs(songs: Song[]): Song[] {
  return songs
    .slice()
    .sort((a, b) =>
      `${a.artist ?? ""}\u0000${a.album ?? ""}\u0000${a.discNumber ?? 0}\u0000${a.track ?? 0}\u0000${a.title}`.localeCompare(
        `${b.artist ?? ""}\u0000${b.album ?? ""}\u0000${b.discNumber ?? 0}\u0000${b.track ?? 0}\u0000${b.title}`,
      ),
    );
}

export async function getSortedDownloadedSongs(): Promise<Song[]> {
  return sortDownloadedSongs(Object.values(await getDownloadedSongs()));
}
