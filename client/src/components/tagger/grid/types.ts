import type { TaggerTrackState } from "@/lib/store/tagger";

export interface TaggerGridProps {
  visibleColumns: string[];
  onColumnsReorder?: (columns: string[]) => void;
  /** Handler to save specific track IDs */
  onSaveTracks?: (trackIds: string[]) => void;
  /** Handler to remove tracks from the tagger */
  onRemoveTracks?: (trackIds: string[]) => void;
  /** Handler to revert changes on specific tracks */
  onRevertTracks?: (trackIds: string[]) => void;
  /** Handler to open one-off script dialog */
  onOpenOneOffScript?: () => void;
}

export interface GridRow {
  id: string;
  isStaged: boolean;
  filePath: string;
  state: TaggerTrackState;
}

export interface CellPosition {
  rowIndex: number;
  colIndex: number; // -1 = file column, 0+ = tag columns
}

export interface CellRange {
  start: CellPosition;
  end: CellPosition;
}

// Undo/redo history entry - stores the track ID and the previous editedTags state
export interface HistoryEntry {
  trackId: string;
  previousEditedTags: Record<string, string>;
  newEditedTags: Record<string, string>;
}

export type SortDirection = "asc" | "desc" | null;

// Constants
export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 40;
export const CHECKBOX_WIDTH = 40;
export const COVER_ART_COLUMN_WIDTH = 32; // Narrow column for cover art status icon
export const DEFAULT_FILE_COLUMN_WIDTH = 400;
export const DEFAULT_TAG_COLUMN_WIDTH = 200;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_HISTORY = 50;
