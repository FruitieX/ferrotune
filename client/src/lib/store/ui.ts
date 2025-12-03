import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

// Sidebar state
export const sidebarCollapsedAtom = atomWithStorage("ferrotune-sidebar-collapsed", false);
export const sidebarWidthAtom = atomWithStorage("ferrotune-sidebar-width", 280);

// Mobile menu state
export const mobileMenuOpenAtom = atom<boolean>(false);

// Queue panel state - persisted so sidebar stays open on reload
export const queuePanelOpenAtom = atomWithStorage<boolean>("ferrotune-queue-panel-open", false);

// Fullscreen player state
export const fullscreenPlayerOpenAtom = atom<boolean>(false);

// Search state
export const searchQueryAtom = atom<string>("");
export const searchOpenAtom = atom<boolean>(false);

// Library filter state (for filtering library views)
export const libraryFilterAtom = atom<string>("");

// View preferences
export type ViewMode = "grid" | "list";
export const albumViewModeAtom = atomWithStorage<ViewMode>("ferrotune-album-view", "grid");
export const artistViewModeAtom = atomWithStorage<ViewMode>("ferrotune-artist-view", "grid");

// Library sorting
export type SortField = "custom" | "name" | "artist" | "year" | "dateAdded" | "playCount" | "duration";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export const librarySortAtom = atomWithStorage<SortConfig>("ferrotune-library-sort", {
  field: "name",
  direction: "asc",
});

// Library column visibility
export interface ColumnVisibility {
  artist: boolean;
  album: boolean;
  duration: boolean;
  playCount: boolean;
  dateAdded: boolean;
  year: boolean;
}

export const columnVisibilityAtom = atomWithStorage<ColumnVisibility>("ferrotune-column-visibility", {
  artist: true,
  album: true,
  duration: true,
  playCount: false,
  dateAdded: false,
  year: false,
});

// Playlist-style views settings (favorites, history, playlist details)
export const playlistViewModeAtom = atomWithStorage<ViewMode>("ferrotune-playlist-view", "list");
export const playlistSortAtom = atomWithStorage<SortConfig>("ferrotune-playlist-sort", {
  field: "custom",
  direction: "asc",
});
export const playlistColumnVisibilityAtom = atomWithStorage<ColumnVisibility>("ferrotune-playlist-columns", {
  artist: true,
  album: true,
  duration: true,
  playCount: false,
  dateAdded: false,
  year: false,
});

// Favorites albums view settings
export const favoritesAlbumViewModeAtom = atomWithStorage<ViewMode>("ferrotune-favorites-album-view", "grid");
export const favoritesAlbumSortAtom = atomWithStorage<SortConfig>("ferrotune-favorites-album-sort", {
  field: "name",
  direction: "asc",
});

// Favorites artists view settings
export const favoritesArtistViewModeAtom = atomWithStorage<ViewMode>("ferrotune-favorites-artist-view", "grid");
export const favoritesArtistSortAtom = atomWithStorage<SortConfig>("ferrotune-favorites-artist-sort", {
  field: "name",
  direction: "asc",
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
export const playlistsSidebarExpandedAtom = atomWithStorage<boolean>(
  "ferrotune-playlists-expanded",
  true
);

// Library sidebar expansion state
export const librarySidebarExpandedAtom = atomWithStorage<boolean>(
  "ferrotune-library-expanded",
  true
);

// Expanded playlist folders in sidebar
export const expandedPlaylistFoldersAtom = atomWithStorage<string[]>(
  "ferrotune-expanded-playlist-folders",
  []
);

// Accent color theme - 10 presets + custom option
export type AccentColor = 
  | "rust"     // 45° - warm orange (default)
  | "gold"     // 85° - yellow-gold
  | "lime"     // 125° - yellow-green  
  | "emerald"  // 160° - green
  | "teal"     // 195° - cyan-green
  | "ocean"    // 230° - blue
  | "indigo"   // 265° - blue-purple
  | "violet"   // 300° - purple
  | "rose"     // 340° - pink-red
  | "crimson"  // 15° - red
  | "custom";

export const accentColorAtom = atomWithStorage<AccentColor>("ferrotune-accent-color", "rust");

// Custom accent color OKLCH values
export const customAccentHueAtom = atomWithStorage<number>("ferrotune-custom-accent-hue", 45);
export const customAccentLightnessAtom = atomWithStorage<number>("ferrotune-custom-accent-lightness", 0.65);
export const customAccentChromaAtom = atomWithStorage<number>("ferrotune-custom-accent-chroma", 0.18);

// Flag to indicate preferences have been loaded from server
export const preferencesLoadedAtom = atom<boolean>(false);

// Accent color presets with their OKLCH hue values for display (~36° apart)
export const ACCENT_PRESETS: { name: AccentColor; hue: number; label: string }[] = [
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
