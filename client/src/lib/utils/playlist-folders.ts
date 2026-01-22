import type { Playlist, SmartPlaylist } from "@/lib/api/types";
import type { PlaylistFolderResponse } from "@/lib/api/generated/PlaylistFolderResponse";
import type { PlaylistInFolder } from "@/lib/api/generated/PlaylistInFolder";

export interface PlaylistFolder {
  /** Folder entity ID from database (if exists) */
  id?: string;
  name: string;
  path: string;
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  subfolders: PlaylistFolder[];
  /** Whether this folder has custom cover art */
  hasCoverArt?: boolean;
  /** Parent folder ID (for API folders) */
  parentId?: string | null;
}

export interface PlaylistWithPath extends Playlist {
  displayName: string;
  folderPath: string[];
}

const FOLDER_SEPARATOR = "/";

/**
 * Build a folder tree from API-provided folder entities and playlists.
 * This is the preferred method after the folder migration is complete.
 */
export function buildFolderTreeFromApi(
  folders: PlaylistFolderResponse[],
  playlists: PlaylistInFolder[],
  smartPlaylists: SmartPlaylist[] = [],
): PlaylistFolder {
  const root: PlaylistFolder = {
    name: "root",
    path: "",
    playlists: [],
    smartPlaylists: [],
    subfolders: [],
  };

  // Build a map of folder ID -> folder for quick lookup
  const folderMap = new Map<string, PlaylistFolder>();

  // Create PlaylistFolder objects for each API folder
  for (const apiFolder of folders) {
    const folder: PlaylistFolder = {
      id: apiFolder.id,
      name: apiFolder.name,
      path: "", // Will be computed after tree is built
      playlists: [],
      smartPlaylists: [],
      subfolders: [],
      hasCoverArt: apiFolder.hasCoverArt,
      parentId: apiFolder.parentId,
    };
    folderMap.set(apiFolder.id, folder);
  }

  // Build the tree structure by connecting parents and children
  for (const apiFolder of folders) {
    const folder = folderMap.get(apiFolder.id)!;
    if (apiFolder.parentId) {
      const parent = folderMap.get(apiFolder.parentId);
      if (parent) {
        parent.subfolders.push(folder);
      } else {
        // Parent not found (shouldn't happen), add to root
        root.subfolders.push(folder);
      }
    } else {
      // No parent, add to root
      root.subfolders.push(folder);
    }
  }

  // Compute paths for all folders
  function computePaths(folder: PlaylistFolder, parentPath: string) {
    folder.path = parentPath ? `${parentPath}/${folder.name}` : folder.name;
    for (const subfolder of folder.subfolders) {
      computePaths(subfolder, folder.path);
    }
  }
  for (const folder of root.subfolders) {
    computePaths(folder, "");
  }

  // Add playlists to their folders
  for (const apiPlaylist of playlists) {
    // Convert to full Playlist type
    const playlist: Playlist = {
      id: apiPlaylist.id,
      name: apiPlaylist.name,
      comment: null,
      owner: "admin",
      public: false,
      songCount: apiPlaylist.songCount,
      duration: 0,
      created: new Date().toISOString(),
      changed: new Date().toISOString(),
      coverArt: null,
    };

    if (apiPlaylist.folderId) {
      const folder = folderMap.get(apiPlaylist.folderId);
      if (folder) {
        folder.playlists.push(playlist);
      } else {
        // Folder not found, add to root
        root.playlists.push(playlist);
      }
    } else {
      // No folder, add to root
      root.playlists.push(playlist);
    }
  }

  // Add smart playlists to their folders based on folderId
  for (const smartPlaylist of smartPlaylists) {
    if (smartPlaylist.folderId) {
      const folder = folderMap.get(smartPlaylist.folderId);
      if (folder) {
        folder.smartPlaylists.push(smartPlaylist);
      } else {
        // Folder not found, add to root
        root.smartPlaylists.push(smartPlaylist);
      }
    } else {
      // No folder, add to root
      root.smartPlaylists.push(smartPlaylist);
    }
  }

  // Sort folders and playlists alphabetically
  sortFolderContents(root);

  return root;
}

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
  smartPlaylists: SmartPlaylist[] = [],
): PlaylistFolder {
  const root: PlaylistFolder = {
    name: "root",
    path: "",
    playlists: [],
    smartPlaylists: [],
    subfolders: [],
  };

  // Guard against undefined/null input
  if (!playlists || !Array.isArray(playlists)) {
    // Even if playlists is missing, we might have smart playlists
    if (!smartPlaylists || !Array.isArray(smartPlaylists)) {
      return root;
    }
  }

  const safePlaylists = Array.isArray(playlists) ? playlists : [];
  const safeSmartPlaylists = Array.isArray(smartPlaylists)
    ? smartPlaylists
    : [];

  for (const playlist of safePlaylists) {
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
          smartPlaylists: [],
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

  // Process smart playlists
  for (const playlist of safeSmartPlaylists) {
    const { displayName: _displayName, folderPath } = parsePlaylistPath(
      playlist.name,
    );

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
          smartPlaylists: [],
          subfolders: [],
        };
        currentFolder.subfolders.push(subfolder);
      }

      currentFolder = subfolder;
    }

    // Add smart playlist to the final folder
    currentFolder.smartPlaylists.push(playlist);
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

  folder.smartPlaylists.sort((a, b) => {
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
