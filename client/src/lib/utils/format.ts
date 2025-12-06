/**
 * Format duration in seconds to mm:ss or hh:mm:ss
 */
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format duration to a human readable string (e.g., "3 min 45 sec")
 */
export function formatDurationLong(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0 sec";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hr`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (secs > 0 && hours === 0) parts.push(`${secs} sec`);

  return parts.join(" ") || "0 sec";
}

/**
 * Format total duration of a list of items
 */
export function formatTotalDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
}

/**
 * Format a date string to relative time or formatted date
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format file size in bytes to human readable
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Alias for formatFileSize for convenience
 */
export const formatBytes = formatFileSize;

/**
 * Format bitrate in kbps
 */
export function formatBitrate(kbps: number | undefined): string {
  if (!kbps) return "";
  return `${kbps} kbps`;
}

/**
 * Pluralize a word based on count
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural || `${singular}s`;
}

/**
 * Format count with label (e.g., "5 songs")
 */
export function formatCount(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}

/**
 * Extract initials from a name (e.g., "The Beatles" -> "TB")
 */
export function getInitials(name: string, maxChars = 2): string {
  return name
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase())
    .slice(0, maxChars)
    .join("");
}

/**
 * Get first letter for artist index
 */
export function getIndexLetter(name: string): string {
  const cleaned = name.replace(/^(the|a|an)\s+/i, "").trim();
  const firstChar = cleaned.charAt(0).toUpperCase();
  return /[A-Z]/.test(firstChar) ? firstChar : "#";
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Format listening time (total seconds) to a friendly string
 * e.g., "42 minutes", "3 hours 15 min", "2 days 5 hours"
 */
export function formatListeningTime(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 60) {
    return "Less than a minute";
  }
  
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days} day${days > 1 ? 's' : ''} ${remainingHours} hr`;
    }
    return `${days} day${days > 1 ? 's' : ''}`;
  }
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours} hr ${remainingMinutes} min`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  
  return `${minutes} minute${minutes > 1 ? 's' : ''}`;
}

/**
 * Generate a random ID
 */
export function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}
