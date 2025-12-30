// Parse "Artist - Title" from filename
//
// Expects format: Artist - Title.ext
// Available: filename, ext, filepath, and all current tags

const parts = filename.split(' - ');
if (parts.length >= 2) {
  return {
    artist: parts[0].trim(),
    title: parts.slice(1).join(' - ').trim()
  };
}

// If no separator found, use filename as title
return { title: filename.trim() };
