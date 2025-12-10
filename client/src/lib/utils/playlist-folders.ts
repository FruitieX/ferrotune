import type { Playlist } from "@/lib/api/types";

export interface PlaylistFolder {
  name: string;
  path: string;
  playlists: Playlist[];
  subfolders: PlaylistFolder[];
}

export interface PlaylistWithPath extends Playlist {
  displayName: string;
  folderPath: string[];
}

const FOLDER_SEPARATOR = "/";

/**
 * Check if a playlist is a folder placeholder (ends with /)
 * e.g., "Rock/" or "Music/Rock/" are empty folder placeholders
 */
export function isFolderPlaceholder(name: string): boolean {
  return name.endsWith(FOLDER_SEPARATOR);
}

/**
 * Get the folder path from a folder placeholder name
 * e.g., "Rock/" -> "Rock", "Music/Rock/" -> "Music/Rock"
 */
export function getFolderPathFromPlaceholder(name: string): string {
  return name.slice(0, -1);
}

/**
 * Parse a playlist name to extract folder path and display name
 * e.g., "Rock/80s/Best Hits" -> { displayName: "Best Hits", folderPath: ["Rock", "80s"] }
 * For folder placeholders like "Rock/", returns { displayName: "", folderPath: ["Rock"], isPlaceholder: true }
 */
export function parsePlaylistPath(name: string): {
  displayName: string;
  folderPath: string[];
  isPlaceholder?: boolean;
} {
  // Handle folder placeholders (trailing /)
  if (isFolderPlaceholder(name)) {
    const folderPath = getFolderPathFromPlaceholder(name);
    const parts = folderPath
      .split(FOLDER_SEPARATOR)
      .map((p) => p.trim())
      .filter(Boolean);
    return { displayName: "", folderPath: parts, isPlaceholder: true };
  }

  const parts = name
    .split(FOLDER_SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return { displayName: name, folderPath: [] };
  }

  return {
    displayName: parts[parts.length - 1],
    folderPath: parts.slice(0, -1),
  };
}

/**
 * Build a full playlist name from display name and folder path
 */
export function buildPlaylistPath(
  displayName: string,
  folderPath: string[],
): string {
  if (folderPath.length === 0) {
    return displayName;
  }
  return [...folderPath, displayName].join(FOLDER_SEPARATOR);
}

/**
 * Organize playlists into a folder tree structure
 */
export function organizePlaylistsIntoFolders(
  playlists: Playlist[],
): PlaylistFolder {
  const root: PlaylistFolder = {
    name: "root",
    path: "",
    playlists: [],
    subfolders: [],
  };

  // Guard against undefined/null input
  if (!playlists || !Array.isArray(playlists)) {
    return root;
  }

  for (const playlist of playlists) {
    const {
      displayName: _displayName,
      folderPath,
      isPlaceholder,
    } = parsePlaylistPath(playlist.name);

    let currentFolder = root;
    let currentPath = "";

    // Navigate/create folder path
    for (const folderName of folderPath) {
      currentPath = currentPath
        ? `${currentPath}${FOLDER_SEPARATOR}${folderName}`
        : folderName;

      let subfolder = currentFolder.subfolders.find(
        (f) => f.name === folderName,
      );

      if (!subfolder) {
        subfolder = {
          name: folderName,
          path: currentPath,
          playlists: [],
          subfolders: [],
        };
        currentFolder.subfolders.push(subfolder);
      }

      currentFolder = subfolder;
    }

    // Skip folder placeholders - they're just used to establish folder structure
    // but shouldn't appear as actual playlists
    if (isPlaceholder) {
      continue;
    }

    // Add playlist with display name to the final folder
    currentFolder.playlists.push({
      ...playlist,
      // Store original name but we'll use displayName for display
    } as Playlist & { _displayName?: string });
  }

  // Sort folders and playlists alphabetically
  sortFolderContents(root);

  return root;
}

function sortFolderContents(folder: PlaylistFolder): void {
  folder.subfolders.sort((a, b) => a.name.localeCompare(b.name));
  folder.playlists.sort((a, b) => {
    const aName = parsePlaylistPath(a.name).displayName;
    const bName = parsePlaylistPath(b.name).displayName;
    return aName.localeCompare(bName);
  });

  for (const subfolder of folder.subfolders) {
    sortFolderContents(subfolder);
  }
}

/**
 * Get display name for a playlist (last part of path)
 */
export function getPlaylistDisplayName(playlist: Playlist): string {
  return parsePlaylistPath(playlist.name).displayName;
}

/**
 * Get all unique folder paths from playlists
 */
export function getUniqueFolderPaths(playlists: Playlist[]): string[] {
  const paths = new Set<string>();

  for (const playlist of playlists) {
    const { folderPath } = parsePlaylistPath(playlist.name);

    let currentPath = "";
    for (const folder of folderPath) {
      currentPath = currentPath
        ? `${currentPath}${FOLDER_SEPARATOR}${folder}`
        : folder;
      paths.add(currentPath);
    }
  }

  return Array.from(paths).sort();
}

/**
 * Find the folder placeholder playlist for a given folder path
 * Returns the playlist if it exists and is an empty folder placeholder
 */
export function findFolderPlaceholder(
  playlists: Playlist[],
  folderPath: string,
): Playlist | undefined {
  const placeholderName = `${folderPath}/`;
  return playlists.find((p) => p.name === placeholderName);
}

/**
 * Check if a folder has only a placeholder (is empty)
 * Returns true if the only playlist in this folder path is the placeholder itself
 */
export function isFolderEmpty(
  playlists: Playlist[],
  folderPath: string,
): boolean {
  const prefix = `${folderPath}/`;
  const playlistsInFolder = playlists.filter((p) => p.name.startsWith(prefix));

  // Empty if no playlists or only the placeholder exists
  return (
    playlistsInFolder.length === 0 ||
    (playlistsInFolder.length === 1 && playlistsInFolder[0].name === prefix)
  );
}
