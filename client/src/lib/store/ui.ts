import { atom } from "jotai";
import { atomWithServerStorage } from "./server-storage";
import { oklchToRgbString } from "@/lib/utils/color";

// Sidebar state
export const sidebarCollapsedAtom = atomWithServerStorage(
  "sidebar-collapsed",
  false,
);
export const sidebarWidthAtom = atomWithServerStorage("sidebar-width", 280);

// Mobile menu state
export const mobileMenuOpenAtom = atom<boolean>(false);

// Queue panel state - persisted so sidebar stays open on reload
export const queuePanelOpenAtom = atomWithServerStorage<boolean>(
  "queue-panel-open",
  false,
);

// Fullscreen player state
export const fullscreenPlayerOpenAtom = atom<boolean>(false);

// Search state
export const searchQueryAtom = atom<string>("");
export const searchOpenAtom = atom<boolean>(false);

// Library filter state (for filtering library views)
export const libraryFilterAtom = atom<string>("");

// View preferences
export type ViewMode = "grid" | "list";
export const albumViewModeAtom = atomWithServerStorage<ViewMode>(
  "album-view",
  "grid",
);
export const artistViewModeAtom = atomWithServerStorage<ViewMode>(
  "artist-view",
  "grid",
);

// Library sorting
export type SortField =
  | "custom"
  | "name"
  | "artist"
  | "year"
  | "dateAdded"
  | "addedToPlaylist"
  | "playCount"
  | "lastPlayed"
  | "duration"
  | "albumCount"
  | "songCount";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export const librarySortAtom = atomWithServerStorage<SortConfig>(
  "library-sort",
  {
    field: "name",
    direction: "asc",
  },
);

// Library column visibility
export interface ColumnVisibility {
  artist: boolean;
  album: boolean;
  duration: boolean;
  playCount: boolean;
  dateAdded: boolean;
  lastPlayed: boolean;
  year: boolean;
}

export const columnVisibilityAtom = atomWithServerStorage<ColumnVisibility>(
  "column-visibility",
  {
    artist: true,
    album: true,
    duration: true,
    playCount: false,
    dateAdded: false,
    lastPlayed: false,
    year: false,
  },
);

// Files browser sort options
export type FilesSortField =
  | "name"
  | "artist"
  | "album"
  | "year"
  | "duration"
  | "size"
  | "dateAdded";

export interface FilesSortConfig {
  field: FilesSortField;
  direction: SortDirection;
}

export const filesSortAtom = atomWithServerStorage<FilesSortConfig>(
  "files-sort",
  {
    field: "name",
    direction: "asc",
  },
);

// Files browser column visibility
export interface FilesColumnVisibility {
  size: boolean;
  duration: boolean;
  artist: boolean;
  album: boolean;
}

export const filesColumnVisibilityAtom =
  atomWithServerStorage<FilesColumnVisibility>("files-columns", {
    size: true,
    duration: true,
    artist: true,
    album: true,
  });

// Playlist-style views settings (favorites, history, playlist details)
export const playlistViewModeAtom = atomWithServerStorage<ViewMode>(
  "playlist-view",
  "list",
);
export const playlistSortAtom = atomWithServerStorage<SortConfig>(
  "playlist-sort",
  {
    field: "custom",
    direction: "asc",
  },
);
export const playlistColumnVisibilityAtom =
  atomWithServerStorage<ColumnVisibility>("playlist-columns", {
    artist: true,
    album: true,
    duration: true,
    playCount: false,
    dateAdded: false,
    lastPlayed: false,
    year: false,
  });

// Favorites albums view settings
export const favoritesAlbumViewModeAtom = atomWithServerStorage<ViewMode>(
  "favorites-album-view",
  "grid",
);
export const favoritesAlbumSortAtom = atomWithServerStorage<SortConfig>(
  "favorites-album-sort",
  {
    field: "name",
    direction: "asc",
  },
);

// Album column visibility for favorites
export interface AlbumColumnVisibility {
  artist: boolean;
  year: boolean;
  songCount: boolean;
  duration: boolean;
}

export const favoritesAlbumColumnVisibilityAtom =
  atomWithServerStorage<AlbumColumnVisibility>("favorites-album-columns", {
    artist: true,
    year: true,
    songCount: true,
    duration: true,
  });

// Favorites artists view settings
export const favoritesArtistViewModeAtom = atomWithServerStorage<ViewMode>(
  "favorites-artist-view",
  "grid",
);
export const favoritesArtistSortAtom = atomWithServerStorage<SortConfig>(
  "favorites-artist-sort",
  {
    field: "name",
    direction: "asc",
  },
);

// Artist column visibility for favorites
export interface ArtistColumnVisibility {
  albumCount: boolean;
}

export const favoritesArtistColumnVisibilityAtom =
  atomWithServerStorage<ArtistColumnVisibility>("favorites-artist-columns", {
    albumCount: true,
  });

// Library album column visibility (for albums list view)
export const libraryAlbumColumnVisibilityAtom =
  atomWithServerStorage<AlbumColumnVisibility>("library-album-columns", {
    artist: true,
    year: true,
    songCount: true,
    duration: false,
  });

// Library artist column visibility (for artists list view)
export const libraryArtistColumnVisibilityAtom =
  atomWithServerStorage<ArtistColumnVisibility>("library-artist-columns", {
    albumCount: true,
  });

// Album details view settings (for album songs list)
export const albumDetailViewModeAtom = atomWithServerStorage<ViewMode>(
  "album-detail-view",
  "list",
);
export const albumDetailSortAtom = atomWithServerStorage<SortConfig>(
  "album-detail-sort",
  {
    field: "custom", // Custom means track order
    direction: "asc",
  },
);
export const albumDetailColumnVisibilityAtom =
  atomWithServerStorage<ColumnVisibility>("album-detail-columns", {
    artist: false, // Album typically has same artist
    album: false, // Already on album page
    duration: true,
    playCount: false,
    dateAdded: false,
    lastPlayed: false,
    year: false,
  });

// Artist details view settings (for artist songs list)
export const artistDetailViewModeAtom = atomWithServerStorage<ViewMode>(
  "artist-detail-view",
  "list",
);
export const artistDetailSortAtom = atomWithServerStorage<SortConfig>(
  "artist-detail-sort",
  {
    field: "name",
    direction: "asc",
  },
);
export const artistDetailColumnVisibilityAtom =
  atomWithServerStorage<ColumnVisibility>("artist-detail-columns", {
    artist: false, // Already on artist page
    album: true,
    duration: true,
    playCount: false,
    dateAdded: false,
    lastPlayed: false,
    year: true,
  });

// Genre details view settings (for genre songs list)
export const genreDetailViewModeAtom = atomWithServerStorage<ViewMode>(
  "genre-detail-view",
  "list",
);
export const genreDetailSortAtom = atomWithServerStorage<SortConfig>(
  "genre-detail-sort",
  {
    field: "name",
    direction: "asc",
  },
);
export const genreDetailColumnVisibilityAtom =
  atomWithServerStorage<ColumnVisibility>("genre-detail-columns", {
    artist: true,
    album: true,
    duration: true,
    playCount: false,
    dateAdded: false,
    lastPlayed: false,
    year: true,
  });

// Playlists list view settings (for /playlists page listing playlists)
export const playlistsViewModeAtom = atomWithServerStorage<ViewMode>(
  "playlists-view",
  "grid",
);
export const playlistsSortAtom = atomWithServerStorage<SortConfig>(
  "playlists-sort",
  {
    field: "name",
    direction: "asc",
  },
);

// Playlist column visibility (for list view of playlists)
export interface PlaylistColumnVisibility {
  songCount: boolean;
  duration: boolean;
  owner: boolean;
  created: boolean;
}

export const playlistsColumnVisibilityAtom =
  atomWithServerStorage<PlaylistColumnVisibility>("playlists-columns", {
    songCount: true,
    duration: true,
    owner: false,
    created: false,
  });

// ===== Advanced Filtering =====
export interface AdvancedFilters {
  minYear?: number;
  maxYear?: number;
  genre?: string;
  minDuration?: number; // in seconds
  maxDuration?: number; // in seconds
  minRating?: number; // 1-5
  maxRating?: number; // 1-5
  starredOnly?: boolean;
  minPlayCount?: number;
  maxPlayCount?: number;
  shuffleExcludedOnly?: boolean; // Filter to only show shuffle-excluded tracks
  minBitrate?: number; // in kbps
  maxBitrate?: number; // in kbps
  addedAfter?: string; // ISO 8601 date string (YYYY-MM-DD)
  addedBefore?: string; // ISO 8601 date string (YYYY-MM-DD)
}

// Filter state (not persisted - resets on page reload)
export const advancedFiltersAtom = atom<AdvancedFilters>({});

// Derived atom to check if any filters are active
export const hasActiveFiltersAtom = atom((get) => {
  const filters = get(advancedFiltersAtom);
  return Object.values(filters).some(
    (v) => v !== undefined && v !== false && v !== "",
  );
});

// Keyboard shortcuts dialog
export const shortcutsDialogOpenAtom = atom<boolean>(false);

// Add to playlist modal
export const addToPlaylistModalAtom = atom<{
  open: boolean;
  songIds: string[];
}>({ open: false, songIds: [] });

// Context menu state
export const contextMenuAtom = atom<{
  type: "song" | "album" | "artist" | "playlist" | null;
  id: string | null;
  position: { x: number; y: number } | null;
}>({ type: null, id: null, position: null });

// Playlist sidebar expansion state
export const playlistsSidebarExpandedAtom = atomWithServerStorage<boolean>(
  "playlists-expanded",
  true,
);

// Library sidebar expansion state
export const librarySidebarExpandedAtom = atomWithServerStorage<boolean>(
  "library-expanded",
  true,
);

// Expanded playlist folders in sidebar
export const expandedPlaylistFoldersAtom = atomWithServerStorage<string[]>(
  "expanded-playlist-folders",
  [],
);

// Progress bar style preference
export type ProgressBarStyle = "waveform" | "simple";
export const progressBarStyleAtom = atomWithServerStorage<ProgressBarStyle>(
  "progress-bar-style",
  "waveform",
);

// Accent color theme - 10 presets + custom option
export type AccentColor =
  | "rust" // 45° - warm orange (default)
  | "gold" // 85° - yellow-gold
  | "lime" // 125° - yellow-green
  | "emerald" // 160° - green
  | "teal" // 195° - cyan-green
  | "ocean" // 230° - blue
  | "indigo" // 265° - blue-purple
  | "violet" // 300° - purple
  | "rose" // 340° - pink-red
  | "crimson" // 15° - red
  | "custom";

export const accentColorAtom = atomWithServerStorage<AccentColor>(
  "accent-color",
  "rust",
);

// Custom accent color OKLCH values
export const customAccentHueAtom = atomWithServerStorage<number>(
  "custom-accent-hue",
  45,
);
export const customAccentLightnessAtom = atomWithServerStorage<number>(
  "custom-accent-lightness",
  0.65,
);
export const customAccentChromaAtom = atomWithServerStorage<number>(
  "custom-accent-chroma",
  0.18,
);

// Flag to indicate preferences have been loaded from server
export const preferencesLoadedAtom = atom<boolean>(false);

// Accent color presets with their OKLCH hue values for display (~36° apart)
export const ACCENT_PRESETS: {
  name: AccentColor;
  hue: number;
  label: string;
}[] = [
  { name: "rust", hue: 45, label: "Rust" },
  { name: "gold", hue: 85, label: "Gold" },
  { name: "lime", hue: 125, label: "Lime" },
  { name: "emerald", hue: 160, label: "Emerald" },
  { name: "teal", hue: 195, label: "Teal" },
  { name: "ocean", hue: 230, label: "Ocean" },
  { name: "indigo", hue: 265, label: "Indigo" },
  { name: "violet", hue: 300, label: "Violet" },
  { name: "rose", hue: 340, label: "Rose" },
  { name: "crimson", hue: 15, label: "Crimson" },
];

// OKLCH preset values matching globals.css
const PRESET_OKLCH: Record<AccentColor, { l: number; c: number; h: number }> = {
  rust: { l: 0.65, c: 0.16, h: 45 },
  gold: { l: 0.75, c: 0.15, h: 85 },
  lime: { l: 0.75, c: 0.18, h: 125 },
  emerald: { l: 0.7, c: 0.15, h: 160 },
  teal: { l: 0.7, c: 0.12, h: 195 },
  ocean: { l: 0.65, c: 0.15, h: 230 },
  indigo: { l: 0.65, c: 0.18, h: 265 },
  violet: { l: 0.7, c: 0.18, h: 300 },
  rose: { l: 0.65, c: 0.18, h: 340 },
  crimson: { l: 0.6, c: 0.2, h: 15 },
  custom: { l: 0.65, c: 0.18, h: 45 }, // Placeholder, overridden by custom atoms
};

/**
 * Derived atom that computes the current accent color as an RGB string.
 * Updates automatically when accent color or custom color values change.
 */
export const accentColorRgbAtom = atom((get) => {
  const accentColor = get(accentColorAtom);

  let l: number, c: number, h: number;

  if (accentColor === "custom") {
    l = get(customAccentLightnessAtom);
    c = get(customAccentChromaAtom);
    h = get(customAccentHueAtom);
  } else {
    const preset = PRESET_OKLCH[accentColor];
    l = preset.l;
    c = preset.c;
    h = preset.h;
  }

  return oklchToRgbString(l, c, h);
});
