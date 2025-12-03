import { atom } from "jotai";

// Generic item selection interface
export interface SelectableItem {
  id: string;
}

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

// Action atoms for selection management - now generic
export const selectItemAtom = atom(
  null,
  (
    get,
    set,
    {
      id,
      items,
      shiftKey = false,
      ctrlKey = false,
    }: { id: string; items: SelectableItem[]; shiftKey?: boolean; ctrlKey?: boolean }
  ) => {
    const state = get(selectionStateAtom);
    const newSelectedIds = new Set(state.selectedIds);
    let newAnchorId = state.anchorId;
    const hasExistingSelection = state.selectedIds.size > 0;
    const isCurrentlySelected = state.selectedIds.has(id);

    if (shiftKey && state.anchorId) {
      // Range selection: select all between anchor and current
      // IMPORTANT: Preserve existing selections when shift-clicking
      const anchorIndex = items.findIndex((s) => s.id === state.anchorId);
      const currentIndex = items.findIndex((s) => s.id === id);

      if (anchorIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);

        // Add all items in range (keeping existing selections)
        for (let i = start; i <= end; i++) {
          newSelectedIds.add(items[i].id);
        }
      }
      // Don't update anchor on shift-click to allow extending selection
    } else if (ctrlKey) {
      // Toggle selection with ctrl held
      if (isCurrentlySelected) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
        newAnchorId = id;
      }
    } else if (hasExistingSelection) {
      // Selection mode is active (we have selections)
      // Toggle the clicked item without clearing others
      if (isCurrentlySelected) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
        newAnchorId = id;
      }
    } else {
      // No existing selection - start fresh selection
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

// Backwards compatible alias for song selection
export const selectTrackAtom = selectItemAtom;

export const clearSelectionAtom = atom(null, (get, set) => {
  set(selectionStateAtom, {
    selectedIds: new Set<string>(),
    lastSelectedId: null,
    anchorId: null,
  });
});

export const selectAllAtom = atom(null, (get, set, items: SelectableItem[]) => {
  const selectedIds = new Set(items.map((s) => s.id));
  set(selectionStateAtom, {
    selectedIds,
    lastSelectedId: items[items.length - 1]?.id ?? null,
    anchorId: items[0]?.id ?? null,
  });
});

// Check if a specific item is selected
export const isSelectedAtom = atom((get) => (id: string) => get(selectionStateAtom).selectedIds.has(id));
