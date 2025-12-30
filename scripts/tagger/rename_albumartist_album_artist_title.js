// AlbumArtist/Album/Artist - Title rename script
//
// Available: title, artist, albumartist, album, genre, year,
// tracknumber, tracktotal, discnumber, disctotal, ext, filename
//
// Return an array of path segments. Each segment will be sanitized
// to remove/replace dangerous characters for the filesystem.

const albumArtist = albumartist || artist || 'Unknown Artist';
const trackArtist = artist || 'Unknown Artist';
const trackTitle = title || 'Unknown Title';

// Build segments array
const segments = [albumArtist];

// Add album folder only if album tag exists
if (album) {
  segments.push(album);
}

// Add filename
segments.push(`${trackArtist} - ${trackTitle}.${ext}`);

return segments;
