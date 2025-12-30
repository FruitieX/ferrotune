// AlbumArtist/Album/NN - Title rename script (Picard-style)
//
// Available: title, artist, albumartist, album, genre, year,
// tracknumber, tracktotal, discnumber, disctotal, ext, filename
//
// Return an array of path segments. Each segment will be sanitized
// to remove/replace dangerous characters for the filesystem.

// Get artist folder name (albumartist or first artist)
const artistFolder = albumartist || artist?.split(',')[0]?.trim() || 'Unknown Artist';

// Build segments array
const segments = [artistFolder];

// Add album folder if present
if (album) {
  segments.push(album);
}

// Add filename with track number: NN - Title
const trackNum = String(tracknumber || 1).padStart(2, '0');
const fileTitle = title || 'Unknown Title';
segments.push(`${trackNum} - ${fileTitle}.${ext}`);

return segments;
