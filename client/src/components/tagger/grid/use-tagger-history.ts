import { useState, useRef } from "react";
import type { TaggerTrackState } from "@/lib/store/tagger";
import { MAX_HISTORY, type HistoryEntry } from "./types";

export interface UseTaggerHistoryOptions {
  setTracks: (
    updater: (
      prev: Map<string, TaggerTrackState>,
    ) => Map<string, TaggerTrackState>,
  ) => void;
}

export interface UseTaggerHistoryResult {
  pushToUndoStack: (entries: HistoryEntry[]) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useTaggerHistory({
  setTracks,
}: UseTaggerHistoryOptions): UseTaggerHistoryResult {
  // Use refs to avoid stale closure issues
  const undoStackRef = useRef<HistoryEntry[][]>([]);
  const redoStackRef = useRef<HistoryEntry[][]>([]);

  // State just for triggering re-renders when stack lengths change
  const [undoLength, setUndoLength] = useState(0);
  const [redoLength, setRedoLength] = useState(0);

  // Push changes to undo stack
  function pushToUndoStack(entries: HistoryEntry[]) {
    if (entries.length === 0) return;

    undoStackRef.current = [...undoStackRef.current, entries];
    // Limit stack size
    if (undoStackRef.current.length > MAX_HISTORY) {
      undoStackRef.current = undoStackRef.current.slice(-MAX_HISTORY);
    }
    // Clear redo stack when new action is performed
    redoStackRef.current = [];

    // Update state to trigger re-render
    setUndoLength(undoStackRef.current.length);
    setRedoLength(0);
  }

  // Undo the last operation
  function handleUndo() {
    if (undoStackRef.current.length === 0) return;

    const lastBatch = undoStackRef.current[undoStackRef.current.length - 1];

    // Apply the undo
    setTracks((currentTracks) => {
      const newTracks = new Map(currentTracks);

      for (const entry of lastBatch) {
        const state = newTracks.get(entry.trackId);
        if (state) {
          newTracks.set(entry.trackId, {
            ...state,
            editedTags: { ...entry.previousEditedTags },
          });
        }
      }

      return newTracks;
    });

    // Update stacks synchronously via refs
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, lastBatch];

    // Update state to trigger re-render
    setUndoLength(undoStackRef.current.length);
    setRedoLength(redoStackRef.current.length);
  }

  // Redo the last undone operation
  function handleRedo() {
    if (redoStackRef.current.length === 0) return;

    const lastBatch = redoStackRef.current[redoStackRef.current.length - 1];

    // Apply the redo
    setTracks((currentTracks) => {
      const newTracks = new Map(currentTracks);

      for (const entry of lastBatch) {
        const state = newTracks.get(entry.trackId);
        if (state) {
          newTracks.set(entry.trackId, {
            ...state,
            editedTags: { ...entry.newEditedTags },
          });
        }
      }

      return newTracks;
    });

    // Update stacks synchronously via refs
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, lastBatch];

    // Update state to trigger re-render
    setRedoLength(redoStackRef.current.length);
    setUndoLength(undoStackRef.current.length);
  }

  return {
    pushToUndoStack,
    handleUndo,
    handleRedo,
    canUndo: undoLength > 0,
    canRedo: redoLength > 0,
  };
}
