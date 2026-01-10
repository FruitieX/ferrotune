/**
 * Tagger Store - Database-backed state management for the tagger view
 *
 * Uses dedicated API endpoints for persistence instead of atomWithServerStorage.
 * This provides better performance and structure for the complex tagger state.
 */

import { atom } from "jotai";
import type { TaggerTrack } from "@/lib/api/generated";
// TaggerPendingEditData import removed - now using individual track sync
import type { TaggerScriptData } from "@/lib/api/generated/TaggerScriptData";
import { getClient } from "@/lib/api/client";

// =============================================================================
// Types
// =============================================================================

export interface TaggerTrackState {
  /** Original track data from server */
  track: TaggerTrack;
  /** Edited tags (only changed fields) */
  editedTags: Record<string, string>;
  /** Cover art changes */
  coverArt: {
    dataUrl?: string;
    changed: boolean;
    removed: boolean;
  } | null;
  /** Computed target path (from rename script) */
  computedPath: string | null;
  /** Whether replacement audio is staged for this track */
  hasReplacementAudio: boolean;
  /** Filename of staged replacement audio (UUID-based, for streaming) */
  replacementAudioFilename?: string;
  /** Original filename of replacement audio (for display) */
  replacementAudioOriginalName?: string;
}

/** Reference to a track with its type */
export interface TaggerTrackRef {
  id: string;
  trackType: "library" | "staged";
}

export interface TaggerSession {
  /** Tracks currently loaded in the tagger with their types */
  tracks: TaggerTrackRef[];
  /** Visible column keys (tags to show in grid) */
  visibleColumns: string[];
  /** ID of active rename script */
  activeRenameScriptId: string | null;
  /** ID of active filename-to-tags script */
  activeTagScriptId: string | null;
  /** Target library ID for saving uploaded files */
  targetLibraryId: string | null;
  /** Whether to show library path prefix in file paths */
  showLibraryPrefix: boolean;
  /** Whether to show computed path (from rename script) instead of current path */
  showComputedPath: boolean;
  /** Column widths for tag columns (key -> width in pixels) */
  columnWidths: Record<string, number>;
  /** Width of the file column in pixels */
  fileColumnWidth: number;
  /** Whether the details panel is open */
  detailsPanelOpen: boolean;
  /** How to handle dangerous characters in filenames/paths */
  dangerousCharMode: "ignore" | "strip" | "replace";
  /** Character to replace dangerous characters with (when mode is 'replace') */
  dangerousCharReplacement: string;
}

export interface TaggerScript {
  id: string;
  name: string;
  /** 'rename' for file path scripts, 'tags' for tag editing scripts */
  type: "rename" | "tags";
  script: string;
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_VISIBLE_COLUMNS = [
  "TITLE",
  "ARTIST",
  "ALBUM",
  "ALBUMARTIST",
  "TRACKNUMBER",
  "DISCNUMBER",
  "YEAR",
  "GENRE",
];

const DEFAULT_SESSION: TaggerSession = {
  tracks: [],
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  activeRenameScriptId: null,
  activeTagScriptId: null,
  targetLibraryId: null,
  showLibraryPrefix: false,
  showComputedPath: true, // Default to showing computed path
  columnWidths: {},
  fileColumnWidth: 400,
  detailsPanelOpen: true,
  dangerousCharMode: "replace",
  dangerousCharReplacement: "_",
};

// Default scripts are now seeded in the database migration (009_tagger_sessions.sql)
// for all existing users. New users get scripts created when their session is initialized.
const DEFAULT_SCRIPTS: TaggerScript[] = [];

// =============================================================================
// Pending Edit Types (for persistence)
// =============================================================================

export interface PendingEdit {
  editedTags: Record<string, string>;
  computedPath: string | null;
  coverArtRemoved: boolean;
  /**
   * Whether this edit has modified cover art stored on the server.
   * Use getTaggerCoverArtUrl(trackId) to fetch the actual image.
   */
  hasCoverArt: boolean;
  /**
   * Whether this edit has replacement audio staged on the server.
   * When true, the original audio will be replaced on save.
   */
  hasReplacementAudio: boolean;
  /**
   * The filename of the replacement audio (UUID-based, for streaming).
   */
  replacementAudioFilename?: string | null;
  /**
   * The original filename of the replacement audio (for display).
   */
  replacementAudioOriginalName?: string | null;
}

// =============================================================================
// State Atoms
// =============================================================================

/**
 * Session state - loaded from server on init
 */
const taggerSessionBaseAtom = atom<TaggerSession>(DEFAULT_SESSION);

/**
 * Flag to track if session has been loaded from server
 */
const taggerSessionLoadedAtom = atom(false);

/**
 * Public session atom with auto-save functionality
 */
export const taggerSessionAtom = atom(
  (get) => get(taggerSessionBaseAtom),
  (
    get,
    set,
    update: TaggerSession | ((prev: TaggerSession) => TaggerSession),
  ) => {
    const currentValue = get(taggerSessionBaseAtom);
    const newValue =
      typeof update === "function" ? update(currentValue) : update;

    // Update local state immediately
    set(taggerSessionBaseAtom, newValue);

    // Debounced save to server
    debouncedSaveSession(newValue);
  },
);

/**
 * User scripts - loaded from server on init
 */
const taggerScriptsBaseAtom = atom<TaggerScript[]>(DEFAULT_SCRIPTS);

/**
 * Flag to track if scripts have been loaded from server
 */
const taggerScriptsLoadedAtom = atom(false);

/**
 * Public scripts atom with auto-save functionality
 */
export const taggerScriptsAtom = atom(
  (get) => get(taggerScriptsBaseAtom),
  (
    get,
    set,
    update: TaggerScript[] | ((prev: TaggerScript[]) => TaggerScript[]),
  ) => {
    const currentValue = get(taggerScriptsBaseAtom);
    const newValue =
      typeof update === "function" ? update(currentValue) : update;

    // Update local state immediately
    set(taggerScriptsBaseAtom, newValue);

    // Debounced save to server
    debouncedSaveScripts(newValue);
  },
);

/**
 * Pending edits - loaded from server on init
 */
const taggerPendingEditsBaseAtom = atom<Record<string, PendingEdit>>({});

/**
 * Public pending edits atom with auto-save functionality
 */
export const taggerPendingEditsAtom = atom(
  (get) => get(taggerPendingEditsBaseAtom),
  (
    get,
    set,
    update:
      | Record<string, PendingEdit>
      | ((prev: Record<string, PendingEdit>) => Record<string, PendingEdit>),
  ) => {
    const currentValue = get(taggerPendingEditsBaseAtom);
    const newValue =
      typeof update === "function" ? update(currentValue) : update;

    // Update local state immediately
    set(taggerPendingEditsBaseAtom, newValue);

    // Sync only the changes (not on initial load when lastSyncedEdits is empty)
    // We set lastSyncedEdits during loadTaggerState to prevent syncing on load
    if (
      Object.keys(lastSyncedEdits).length > 0 ||
      Object.keys(newValue).length > 0
    ) {
      syncPendingEditsChanges(lastSyncedEdits, newValue);
      lastSyncedEdits = { ...newValue };
    }
  },
);

/**
 * Details panel visibility (now part of session but exposed as separate atom for compatibility)
 */
export const taggerDetailsPanelOpenAtom = atom(
  (get) => get(taggerSessionBaseAtom).detailsPanelOpen,
  (get, set, update: boolean | ((prev: boolean) => boolean)) => {
    const session = get(taggerSessionBaseAtom);
    const newValue =
      typeof update === "function" ? update(session.detailsPanelOpen) : update;

    set(taggerSessionAtom, { ...session, detailsPanelOpen: newValue });
  },
);

// =============================================================================
// In-Memory Atoms (not persisted)
// =============================================================================

/**
 * Track data and edits - in-memory only (can be large)
 */
export const taggerTracksAtom = atom<Map<string, TaggerTrackState>>(new Map());

/**
 * Currently selected track IDs in the grid (checkboxes)
 */
export const taggerSelectedIdsAtom = atom<Set<string>>(new Set<string>());

/**
 * Track ID of the row with focused cell (for details panel when no selection)
 */
export const taggerFocusedRowIdAtom = atom<string | null>(null);

/**
 * Whether the tagger has unsaved changes
 */
export const taggerHasChangesAtom = atom((get) => {
  const tracks = get(taggerTracksAtom);
  for (const state of tracks.values()) {
    if (hasTrackChanges(state)) return true;
  }
  return false;
});

/**
 * Tracks that have unsaved changes
 */
export const taggerDirtyTrackIdsAtom = atom((get) => {
  const tracks = get(taggerTracksAtom);
  const dirty: string[] = [];
  for (const [id, state] of tracks) {
    if (hasTrackChanges(state)) {
      dirty.push(id);
    }
  }
  return dirty;
});

/**
 * All unique tag keys present in loaded tracks
 */
export const taggerAvailableColumnsAtom = atom((get) => {
  const tracks = get(taggerTracksAtom);
  const keys = new Set<string>();

  for (const state of tracks.values()) {
    for (const tag of state.track.tags) {
      keys.add(tag.key);
    }
    for (const key of Object.keys(state.editedTags)) {
      keys.add(key);
    }
  }

  // Sort alphabetically, but keep common tags first
  const commonTags = [
    "TITLE",
    "ARTIST",
    "ALBUM",
    "ALBUMARTIST",
    "TRACKNUMBER",
    "DISCNUMBER",
    "YEAR",
    "GENRE",
  ];
  const sorted = Array.from(keys).sort((a, b) => {
    const aIdx = commonTags.indexOf(a);
    const bIdx = commonTags.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.localeCompare(b);
  });

  return sorted;
});

// =============================================================================
// Debounced Save Functions
// =============================================================================

let sessionSaveTimeout: ReturnType<typeof setTimeout> | null = null;
let scriptsSaveTimeout: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_DELAY = 500;

function debouncedSaveSession(session: TaggerSession) {
  if (sessionSaveTimeout) {
    clearTimeout(sessionSaveTimeout);
  }

  sessionSaveTimeout = setTimeout(async () => {
    const client = getClient();
    if (!client) return;

    try {
      // Convert columnWidths from Record<string, number> to the expected format
      const columnWidthsForApi: Record<string, number> = {};
      for (const [key, value] of Object.entries(session.columnWidths)) {
        columnWidthsForApi[key] = value;
      }

      // Save session settings
      // Use empty string to explicitly clear script IDs (undefined means don't update)
      await client.updateTaggerSession({
        visibleColumns: session.visibleColumns,
        activeRenameScriptId: session.activeRenameScriptId ?? "",
        activeTagScriptId: session.activeTagScriptId ?? "",
        targetLibraryId: session.targetLibraryId ?? undefined,
        showLibraryPrefix: session.showLibraryPrefix,
        showComputedPath: session.showComputedPath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types use bigint for i64 but runtime uses number
        columnWidths: columnWidthsForApi as any,
        fileColumnWidth: session.fileColumnWidth,
        detailsPanelOpen: session.detailsPanelOpen,
      });

      // Save tracks with types separately
      await client.setTaggerSessionTracks(session.tracks);
    } catch (error) {
      console.warn("Failed to save tagger session:", error);
    }
  }, DEBOUNCE_DELAY);
}

function debouncedSaveScripts(scripts: TaggerScript[]) {
  if (scriptsSaveTimeout) {
    clearTimeout(scriptsSaveTimeout);
  }

  scriptsSaveTimeout = setTimeout(async () => {
    const client = getClient();
    if (!client) return;

    try {
      const scriptsData: TaggerScriptData[] = scripts.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        script: s.script,
      }));
      await client.saveTaggerScripts(scriptsData);
    } catch (error) {
      console.warn("Failed to save tagger scripts:", error);
    }
  }, DEBOUNCE_DELAY);
}

// Track the last synced state of edits to detect changes
let lastSyncedEdits: Record<string, PendingEdit> = {};

// Pending sync operations (track ID -> timeout)
const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>();

// Sync a single track's edit to the server
async function syncTrackEdit(trackId: string, edit: PendingEdit | null) {
  const client = getClient();
  if (!client) return;

  try {
    if (edit === null) {
      // Edit was removed - delete from server
      await client.deleteTaggerEdit(trackId);
    } else {
      // Edit was added/changed - upsert to server
      await client.updateTaggerEdit(trackId, {
        editedTags: edit.editedTags,
        computedPath: edit.computedPath ?? null,
        coverArtRemoved: edit.coverArtRemoved,
      });
    }
  } catch (error) {
    console.warn(`Failed to sync edit for track ${trackId}:`, error);
  }
}

// Debounced sync for individual track edits
function debouncedSyncTrackEdit(trackId: string, edit: PendingEdit | null) {
  // Clear any pending sync for this track
  const existingTimeout = pendingSyncs.get(trackId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Schedule new sync
  const timeout = setTimeout(() => {
    pendingSyncs.delete(trackId);
    syncTrackEdit(trackId, edit);
  }, DEBOUNCE_DELAY);

  pendingSyncs.set(trackId, timeout);
}

// Compare previous and current edits, sync only changes
function syncPendingEditsChanges(
  prevEdits: Record<string, PendingEdit>,
  newEdits: Record<string, PendingEdit>,
) {
  // Find removed edits
  for (const trackId of Object.keys(prevEdits)) {
    if (!(trackId in newEdits)) {
      debouncedSyncTrackEdit(trackId, null);
    }
  }

  // Find added/changed edits
  for (const [trackId, edit] of Object.entries(newEdits)) {
    const prevEdit = prevEdits[trackId];
    if (!prevEdit || JSON.stringify(prevEdit) !== JSON.stringify(edit)) {
      debouncedSyncTrackEdit(trackId, edit);
    }
  }
}

// =============================================================================
// Session Loading
// =============================================================================

// Store setter references for loading
let setSessionBase: ((session: TaggerSession) => void) | null = null;
let setSessionLoaded: ((loaded: boolean) => void) | null = null;
let setScriptsBase: ((scripts: TaggerScript[]) => void) | null = null;
let setScriptsLoaded: ((loaded: boolean) => void) | null = null;
let setPendingEditsBase: ((edits: Record<string, PendingEdit>) => void) | null =
  null;

/**
 * Load tagger state from the server.
 * Call this once when entering the tagger page.
 */
export async function loadTaggerState(): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    // Load pending edits FIRST - they need to be available when tracks load
    const editsResponse = await client.getTaggerPendingEdits();
    const edits: Record<string, PendingEdit> = {};
    for (const [trackId, edit] of Object.entries(editsResponse.edits)) {
      if (!edit) continue;
      // Convert editedTags to ensure no undefined values
      const editedTags: Record<string, string> = {};
      for (const [key, value] of Object.entries(edit.editedTags)) {
        if (value !== undefined) {
          editedTags[key] = value;
        }
      }
      edits[trackId] = {
        editedTags,
        computedPath: edit.computedPath ?? null,
        coverArtRemoved: edit.coverArtRemoved,
        hasCoverArt: edit.hasCoverArt,
        hasReplacementAudio: edit.hasReplacementAudio,
        replacementAudioFilename: edit.replacementAudioFilename,
        replacementAudioOriginalName: edit.replacementAudioOriginalName,
      };
    }
    // Initialize lastSyncedEdits to match server state (prevents re-sync on load)
    lastSyncedEdits = { ...edits };
    if (setPendingEditsBase) setPendingEditsBase(edits);

    // Load scripts
    const scriptsResponse = await client.getTaggerScripts();
    if (scriptsResponse.scripts.length > 0) {
      const scripts: TaggerScript[] = scriptsResponse.scripts.map(
        (s: TaggerScriptData) => ({
          id: s.id,
          name: s.name,
          type: s.type as "rename" | "tags",
          script: s.script,
        }),
      );
      if (setScriptsBase) setScriptsBase(scripts);
    }
    if (setScriptsLoaded) setScriptsLoaded(true);

    // Load session LAST - this triggers track loading which needs pending edits to be ready
    const sessionResponse = await client.getTaggerSession();
    // Convert columnWidths from API response (may have bigint values) to number
    const columnWidths: Record<string, number> = {};
    for (const [key, value] of Object.entries(sessionResponse.columnWidths)) {
      columnWidths[key] = Number(value);
    }

    const session: TaggerSession = {
      tracks: sessionResponse.tracks.map((t) => ({
        id: t.id,
        trackType: t.trackType as "library" | "staged",
      })),
      visibleColumns: sessionResponse.visibleColumns,
      activeRenameScriptId: sessionResponse.activeRenameScriptId ?? null,
      activeTagScriptId: sessionResponse.activeTagScriptId ?? null,
      targetLibraryId: sessionResponse.targetLibraryId ?? null,
      showLibraryPrefix: sessionResponse.showLibraryPrefix,
      showComputedPath: sessionResponse.showComputedPath,
      columnWidths,
      fileColumnWidth: Number(sessionResponse.fileColumnWidth),
      detailsPanelOpen: sessionResponse.detailsPanelOpen,
      dangerousCharMode:
        (sessionResponse.dangerousCharMode as
          | "ignore"
          | "strip"
          | "replace"
          | undefined) ?? "replace",
      dangerousCharReplacement: sessionResponse.dangerousCharReplacement ?? "_",
    };
    if (setSessionBase) setSessionBase(session);
    if (setSessionLoaded) setSessionLoaded(true);
  } catch (error) {
    console.warn("Failed to load tagger state:", error);
  }
}

/**
 * Atom to register setters for loading (call this in a useEffect in the tagger page)
 */
export const taggerStateLoadingAtom = atom(
  null,
  (_get, set, _action: { type: "register" } | { type: "load" }) => {
    // Register setters
    setSessionBase = (session) => set(taggerSessionBaseAtom, session);
    setSessionLoaded = (loaded) => set(taggerSessionLoadedAtom, loaded);
    setScriptsBase = (scripts) => set(taggerScriptsBaseAtom, scripts);
    setScriptsLoaded = (loaded) => set(taggerScriptsLoadedAtom, loaded);
    setPendingEditsBase = (edits) => set(taggerPendingEditsBaseAtom, edits);
  },
);

/**
 * Atom to check if tagger state has been loaded
 */
export const taggerStateLoadedAtom = atom(
  (get) => get(taggerSessionLoadedAtom) && get(taggerScriptsLoadedAtom),
);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the current (possibly edited) value of a tag for a track
 */
export function getTrackTagValue(state: TaggerTrackState, key: string): string {
  // Check edited tags first
  if (key in state.editedTags) {
    return state.editedTags[key];
  }
  // Fall back to original tags
  const tag = state.track.tags.find((t) => t.key === key);
  return tag?.value ?? "";
}

/**
 * Get all current tag values for a track (merged original + edits)
 */
export function getTrackTags(state: TaggerTrackState): Record<string, string> {
  const tags: Record<string, string> = {};

  // Start with original tags
  for (const tag of state.track.tags) {
    tags[tag.key] = tag.value;
  }

  // Apply edits
  for (const [key, value] of Object.entries(state.editedTags)) {
    tags[key] = value;
  }

  return tags;
}

/**
 * Convert a TaggerTrack to initial TaggerTrackState
 */
export function createTrackState(track: TaggerTrack): TaggerTrackState {
  return {
    track,
    editedTags: {},
    coverArt: null,
    computedPath: null,
    hasReplacementAudio: false,
  };
}

/**
 * Check if a track state has any changes
 */
export function hasTrackChanges(state: TaggerTrackState): boolean {
  // Staged (uploaded) tracks always need saving
  if (state.track.isStaged) return true;
  if (Object.keys(state.editedTags).length > 0) return true;
  if (state.coverArt?.changed || state.coverArt?.removed) return true;
  if (state.computedPath && state.computedPath !== state.track.filePath)
    return true;
  if (state.hasReplacementAudio) return true;
  return false;
}
