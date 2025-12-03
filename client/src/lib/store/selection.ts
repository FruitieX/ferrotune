import { atom } from "jotai";
import type { Song } from "@/lib/api/types";

// Track selection state
export interface SelectionState {
  selectedIds: Set<string>;
  lastSelectedId: string | null;
  // For range selection with shift
  anchorId: string | null;
}

export const selectionStateAtom = atom<SelectionState>({
  selectedIds: new Set<string>(),
  lastSelectedId: null,
  anchorId: null,
});

// Derived atom to get selected count
export const selectedCountAtom = atom((get) => get(selectionStateAtom).selectedIds.size);

// Derived atom to check if any items are selected
export const hasSelectionAtom = atom((get) => get(selectionStateAtom).selectedIds.size > 0);

// Action atoms for selection management
export const selectTrackAtom = atom(
  null,
  (
    get,
    set,
    {
      id,
      songs,
      shiftKey = false,
      ctrlKey = false,
    }: { id: string; songs: Song[]; shiftKey?: boolean; ctrlKey?: boolean }
  ) => {
    const state = get(selectionStateAtom);
    const newSelectedIds = new Set(state.selectedIds);
    let newAnchorId = state.anchorId;

    if (shiftKey && state.anchorId) {
      // Range selection: select all between anchor and current
      const anchorIndex = songs.findIndex((s) => s.id === state.anchorId);
      const currentIndex = songs.findIndex((s) => s.id === id);

      if (anchorIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);

        // Clear existing selection if not holding ctrl
        if (!ctrlKey) {
          newSelectedIds.clear();
        }

        // Add all songs in range
        for (let i = start; i <= end; i++) {
          newSelectedIds.add(songs[i].id);
        }
      }
    } else if (ctrlKey) {
      // Toggle selection
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
        newAnchorId = id;
      }
    } else {
      // Single selection - clear others and select this one
      newSelectedIds.clear();
      newSelectedIds.add(id);
      newAnchorId = id;
    }

    set(selectionStateAtom, {
      selectedIds: newSelectedIds,
      lastSelectedId: id,
      anchorId: newAnchorId,
    });
  }
);

export const clearSelectionAtom = atom(null, (get, set) => {
  set(selectionStateAtom, {
    selectedIds: new Set<string>(),
    lastSelectedId: null,
    anchorId: null,
  });
});

export const selectAllAtom = atom(null, (get, set, songs: Song[]) => {
  const selectedIds = new Set(songs.map((s) => s.id));
  set(selectionStateAtom, {
    selectedIds,
    lastSelectedId: songs[songs.length - 1]?.id ?? null,
    anchorId: songs[0]?.id ?? null,
  });
});

// Check if a specific track is selected
export const isSelectedAtom = atom((get) => (id: string) => get(selectionStateAtom).selectedIds.has(id));
