export function getPlaylistDetailsHref(
  playlistType: string,
  playlistId: string,
): string {
  return playlistType === "smartPlaylist"
    ? `/playlists/smart?id=${encodeURIComponent(playlistId)}`
    : `/playlists/details?id=${encodeURIComponent(playlistId)}`;
}

export function getSongRadioHref(songId: string): string {
  return `/radio/song?id=${encodeURIComponent(songId)}`;
}

export function getQueueSourceHref(source: {
  type: string;
  id?: string | null;
  name?: string | null;
}): string | null {
  switch (source.type) {
    case "album":
      return source.id
        ? `/library/albums/details?id=${encodeURIComponent(source.id)}`
        : null;
    case "artist":
      return source.id
        ? `/library/artists/details?id=${encodeURIComponent(source.id)}`
        : null;
    case "playlist":
    case "smartPlaylist":
      return source.id ? getPlaylistDetailsHref(source.type, source.id) : null;
    case "songRadio":
      return source.id ? getSongRadioHref(source.id) : null;
    case "genre":
      return source.name
        ? `/library/genres/details?name=${encodeURIComponent(source.name)}`
        : null;
    default:
      return null;
  }
}
