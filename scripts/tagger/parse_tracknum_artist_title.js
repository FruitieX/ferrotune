// Parse "01 - Artist - Title" or "01. Artist - Title" from filename
//
// Also handles "01 Artist - Title" format
// Available: filename, ext, filepath, and all current tags

// Try to extract track number from start
const numMatch = filename.match(/^(\d+)[.\-\s]+(.+)/);
if (numMatch) {
  const trackNum = parseInt(numMatch[1], 10);
  const rest = numMatch[2].trim();
  
  // Try to split remaining into Artist - Title
  const parts = rest.split(' - ');
  if (parts.length >= 2) {
    return {
      tracknumber: String(trackNum),
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim()
    };
  }
  return {
    tracknumber: String(trackNum),
    title: rest
  };
}

// Fallback: just try Artist - Title
const parts = filename.split(' - ');
if (parts.length >= 2) {
  return {
    artist: parts[0].trim(),
    title: parts.slice(1).join(' - ').trim()
  };
}

return { title: filename.trim() };
