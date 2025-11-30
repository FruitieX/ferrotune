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
 * Parse a playlist name to extract folder path and display name
 * e.g., "Rock/80s/Best Hits" -> { displayName: "Best Hits", folderPath: ["Rock", "80s"] }
 */
export function parsePlaylistPath(name: string): { displayName: string; folderPath: string[] } {
  const parts = name.split(FOLDER_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  
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
export function buildPlaylistPath(displayName: string, folderPath: string[]): string {
  if (folderPath.length === 0) {
    return displayName;
  }
  return [...folderPath, displayName].join(FOLDER_SEPARATOR);
}

/**
 * Organize playlists into a folder tree structure
 */
export function organizePlaylistsIntoFolders(playlists: Playlist[]): PlaylistFolder {
  const root: PlaylistFolder = {
    name: "root",
    path: "",
    playlists: [],
    subfolders: [],
  };

  for (const playlist of playlists) {
    const { displayName, folderPath } = parsePlaylistPath(playlist.name);
    
    let currentFolder = root;
    let currentPath = "";
    
    // Navigate/create folder path
    for (const folderName of folderPath) {
      currentPath = currentPath ? `${currentPath}${FOLDER_SEPARATOR}${folderName}` : folderName;
      
      let subfolder = currentFolder.subfolders.find((f) => f.name === folderName);
      
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
      currentPath = currentPath ? `${currentPath}${FOLDER_SEPARATOR}${folder}` : folder;
      paths.add(currentPath);
    }
  }
  
  return Array.from(paths).sort();
}
