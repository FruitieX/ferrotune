// Trim leading/trailing whitespace from tags
//
// Available: title, artist, album, albumartist, genre, year,
// tracknumber, tracktotal, discnumber, disctotal, ext, filename

return {
  title: title?.trim() || '',
  artist: artist?.trim() || '',
  album: album?.trim() || '',
  albumartist: albumartist?.trim() || ''
};
