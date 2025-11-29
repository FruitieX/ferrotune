import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

// Sidebar state
export const sidebarCollapsedAtom = atomWithStorage("ferrotune-sidebar-collapsed", false);
export const sidebarWidthAtom = atomWithStorage("ferrotune-sidebar-width", 280);

// Mobile menu state
export const mobileMenuOpenAtom = atom<boolean>(false);

// Queue panel state
export const queuePanelOpenAtom = atom<boolean>(false);

// Fullscreen player state
export const fullscreenPlayerOpenAtom = atom<boolean>(false);

// Search state
export const searchQueryAtom = atom<string>("");
export const searchOpenAtom = atom<boolean>(false);

// View preferences
export type ViewMode = "grid" | "list";
export const albumViewModeAtom = atomWithStorage<ViewMode>("ferrotune-album-view", "grid");
export const artistViewModeAtom = atomWithStorage<ViewMode>("ferrotune-artist-view", "grid");

// Current library tab
export type LibraryTab = "albums" | "artists" | "songs" | "genres" | "playlists";
export const libraryTabAtom = atomWithStorage<LibraryTab>("ferrotune-library-tab", "albums");

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
