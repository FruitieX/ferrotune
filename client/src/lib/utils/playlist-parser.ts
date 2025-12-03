/**
 * Playlist file format parsers
 * Supports: M3U, M3U8, PLS, CSV
 */

export interface ParsedTrack {
  /** Original line/entry from the file */
  raw: string;
  /** Artist name if available */
  artist?: string;
  /** Track title if available */
  title?: string;
  /** Album name if available */
  album?: string;
  /** Duration in seconds if available */
  duration?: number;
  /** File path if available */
  path?: string;
}

export interface ParseResult {
  /** Format detected/used */
  format: "m3u" | "pls" | "csv" | "unknown";
  /** Parsed tracks */
  tracks: ParsedTrack[];
  /** Number of lines that couldn't be parsed */
  errors: number;
}

/**
 * Detect file format from content and/or extension
 */
export function detectFormat(content: string, filename?: string): "m3u" | "pls" | "csv" | "unknown" {
  const ext = filename?.toLowerCase().split(".").pop();
  
  if (ext === "m3u" || ext === "m3u8") return "m3u";
  if (ext === "pls") return "pls";
  if (ext === "csv") return "csv";
  
  // Try to detect from content
  const lines = content.trim().split("\n");
  const firstLine = lines[0]?.trim().toLowerCase();
  
  if (firstLine === "#extm3u" || firstLine.startsWith("#extinf:") || firstLine.endsWith(".mp3") || firstLine.endsWith(".flac")) {
    return "m3u";
  }
  
  if (firstLine === "[playlist]") {
    return "pls";
  }
  
  // Check for CSV header patterns
  if (firstLine.includes(",") && (
    firstLine.includes("artist") || 
    firstLine.includes("title") || 
    firstLine.includes("track") ||
    firstLine.includes("song")
  )) {
    return "csv";
  }
  
  return "unknown";
}

/**
 * Parse M3U/M3U8 playlist format
 * 
 * Extended M3U format:
 * #EXTM3U
 * #EXTINF:123,Artist - Title
 * /path/to/file.mp3
 */
function parseM3U(content: string): ParseResult {
  const lines = content.split("\n").map(l => l.trim()).filter(l => l);
  const tracks: ParsedTrack[] = [];
  let errors = 0;
  
  let currentInfo: { duration?: number; artist?: string; title?: string } = {};
  
  for (const line of lines) {
    // Skip M3U header
    if (line === "#EXTM3U") continue;
    
    // Parse EXTINF line
    if (line.startsWith("#EXTINF:")) {
      const match = line.match(/^#EXTINF:(-?\d+),\s*(.*)$/);
      if (match) {
        const duration = parseInt(match[1], 10);
        const info = match[2];
        
        // Try to parse "Artist - Title" format
        const artistTitleMatch = info.match(/^(.+?)\s*-\s*(.+)$/);
        if (artistTitleMatch) {
          currentInfo = {
            duration: duration > 0 ? duration : undefined,
            artist: artistTitleMatch[1].trim(),
            title: artistTitleMatch[2].trim(),
          };
        } else {
          currentInfo = {
            duration: duration > 0 ? duration : undefined,
            title: info.trim(),
          };
        }
      }
      continue;
    }
    
    // Skip other comment lines
    if (line.startsWith("#")) continue;
    
    // This is a file path line
    const track: ParsedTrack = {
      raw: line,
      path: line,
      ...currentInfo,
    };
    
    // If no EXTINF info, try to extract from filename
    if (!track.title && !track.artist) {
      const filename = line.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "");
      if (filename) {
        const artistTitleMatch = filename.match(/^(.+?)\s*-\s*(.+)$/);
        if (artistTitleMatch) {
          track.artist = artistTitleMatch[1].trim();
          track.title = artistTitleMatch[2].trim();
        } else {
          track.title = filename.trim();
        }
      }
    }
    
    if (track.title || track.path) {
      tracks.push(track);
    } else {
      errors++;
    }
    
    currentInfo = {};
  }
  
  return { format: "m3u", tracks, errors };
}

/**
 * Parse PLS playlist format
 * 
 * [playlist]
 * File1=/path/to/file.mp3
 * Title1=Artist - Title
 * Length1=123
 * NumberOfEntries=1
 * Version=2
 */
function parsePLS(content: string): ParseResult {
  const lines = content.split("\n").map(l => l.trim()).filter(l => l);
  const tracks: ParsedTrack[] = [];
  let errors = 0;
  
  // Collect entries by number
  const entries: Map<number, { file?: string; title?: string; length?: number }> = new Map();
  
  for (const line of lines) {
    // Skip header and metadata
    if (line.toLowerCase() === "[playlist]") continue;
    if (line.toLowerCase().startsWith("numberofentries")) continue;
    if (line.toLowerCase().startsWith("version")) continue;
    
    const match = line.match(/^(File|Title|Length)(\d+)\s*=\s*(.*)$/i);
    if (match) {
      const [, key, numStr, value] = match;
      const num = parseInt(numStr, 10);
      
      if (!entries.has(num)) {
        entries.set(num, {});
      }
      const entry = entries.get(num)!;
      
      switch (key.toLowerCase()) {
        case "file":
          entry.file = value;
          break;
        case "title":
          entry.title = value;
          break;
        case "length":
          entry.length = parseInt(value, 10);
          break;
      }
    }
  }
  
  // Convert entries to tracks
  for (const [, entry] of Array.from(entries.entries()).sort((a, b) => a[0] - b[0])) {
    const track: ParsedTrack = {
      raw: entry.title || entry.file || "",
      path: entry.file,
      duration: entry.length && entry.length > 0 ? entry.length : undefined,
    };
    
    // Parse title for artist/title
    if (entry.title) {
      const artistTitleMatch = entry.title.match(/^(.+?)\s*-\s*(.+)$/);
      if (artistTitleMatch) {
        track.artist = artistTitleMatch[1].trim();
        track.title = artistTitleMatch[2].trim();
      } else {
        track.title = entry.title.trim();
      }
    } else if (entry.file) {
      // Try to extract from filename
      const filename = entry.file.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "");
      if (filename) {
        const artistTitleMatch = filename.match(/^(.+?)\s*-\s*(.+)$/);
        if (artistTitleMatch) {
          track.artist = artistTitleMatch[1].trim();
          track.title = artistTitleMatch[2].trim();
        } else {
          track.title = filename.trim();
        }
      }
    }
    
    if (track.title || track.path) {
      tracks.push(track);
    } else {
      errors++;
    }
  }
  
  return { format: "pls", tracks, errors };
}

/**
 * Parse CSV with headers
 * Looks for columns: artist, title, album, duration, track, song, name
 */
function parseCSV(content: string): ParseResult {
  const lines = content.split("\n").map(l => l.trim()).filter(l => l);
  const tracks: ParsedTrack[] = [];
  let errors = 0;
  
  if (lines.length === 0) {
    return { format: "csv", tracks, errors: 0 };
  }
  
  // Parse header
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  
  // Find column indices
  const artistIdx = headers.findIndex(h => h === "artist" || h === "artists");
  const titleIdx = headers.findIndex(h => h === "title" || h === "track" || h === "song" || h === "name" || h === "track name" || h === "song name");
  const albumIdx = headers.findIndex(h => h === "album" || h === "album name");
  const durationIdx = headers.findIndex(h => h === "duration" || h === "length" || h === "time");
  
  // If no title column found, error
  if (titleIdx === -1 && artistIdx === -1) {
    // Try to treat as simple list
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values[0]) {
        tracks.push({
          raw: lines[i],
          title: values[0].trim(),
          artist: values[1]?.trim(),
        });
      } else {
        errors++;
      }
    }
    return { format: "csv", tracks, errors };
  }
  
  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    
    const track: ParsedTrack = {
      raw: lines[i],
    };
    
    if (titleIdx !== -1 && values[titleIdx]) {
      track.title = values[titleIdx].trim();
    }
    if (artistIdx !== -1 && values[artistIdx]) {
      track.artist = values[artistIdx].trim();
    }
    if (albumIdx !== -1 && values[albumIdx]) {
      track.album = values[albumIdx].trim();
    }
    if (durationIdx !== -1 && values[durationIdx]) {
      const dur = parseInt(values[durationIdx], 10);
      if (!isNaN(dur)) {
        track.duration = dur;
      }
    }
    
    if (track.title || track.artist) {
      tracks.push(track);
    } else {
      errors++;
    }
  }
  
  return { format: "csv", tracks, errors };
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Parse playlist file content
 */
export function parsePlaylist(content: string, filename?: string): ParseResult {
  const format = detectFormat(content, filename);
  
  switch (format) {
    case "m3u":
      return parseM3U(content);
    case "pls":
      return parsePLS(content);
    case "csv":
      return parseCSV(content);
    default:
      // Try to parse as M3U (most flexible)
      return parseM3U(content);
  }
}

/**
 * Export tracks to M3U format
 */
export function exportToM3U(tracks: { title: string; artist?: string; duration?: number }[]): string {
  let output = "#EXTM3U\n";
  
  for (const track of tracks) {
    const duration = track.duration ?? -1;
    const info = track.artist ? `${track.artist} - ${track.title}` : track.title;
    output += `#EXTINF:${duration},${info}\n`;
    // Add a placeholder path since we don't have the actual file
    output += `# ${info}\n`;
  }
  
  return output;
}
