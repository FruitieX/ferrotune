"use client";

import { useRef, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  taggerTracksAtom,
  taggerSessionAtom,
  taggerSelectedIdsAtom,
  taggerFocusedRowIdAtom,
  taggerScriptsAtom,
  getTrackTagValue,
  getTrackTags,
} from "@/lib/store/tagger";
import { startQueueAtom } from "@/lib/store/server-queue";
import { useRenameScript } from "@/lib/hooks/use-rename-script";
import { usePreviewAudio } from "@/lib/hooks/use-preview-audio";
import { getClient } from "@/lib/api/client";
import {
  ROW_HEIGHT,
  CHECKBOX_WIDTH,
  COVER_ART_COLUMN_WIDTH,
  DEFAULT_TAG_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type TaggerGridProps,
  type GridRow,
  type CellPosition,
  type CellRange,
  type SortDirection,
  type HistoryEntry,
  useTaggerHistory,
  TaggerGridHeader,
  TaggerGridRow,
  TaggerGridContextMenu,
  getColumnByIndex,
  getRangeBounds,
} from "./grid";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import {
  ImportFromFileDialog,
  type ImportFromFileOptions,
} from "./import-from-file-dialog";

// Stable empty object for columnWidths fallback to avoid dependency changes
const EMPTY_COLUMN_WIDTHS: Record<string, number> = {};

export function TaggerGrid({
  visibleColumns,
  onColumnsReorder,
  onSaveTracks,
  onRemoveTracks,
  onRevertTracks,
  onOpenOneOffScript,
}: TaggerGridProps) {
  const [tracks, setTracks] = useAtom(taggerTracksAtom);
  const [selectedIds, setSelectedIds] = useAtom(taggerSelectedIdsAtom);
  const setFocusedRowId = useSetAtom(taggerFocusedRowIdAtom);
  const [session, setSession] = useAtom(taggerSessionAtom);
  const scripts = useAtomValue(taggerScriptsAtom);
  const startQueue = useSetAtom(startQueueAtom);
  const { runOnTracks } = useRenameScript();
  const previewAudio = usePreviewAudio();
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const lastClickedIndexRef = useRef<number | null>(null);

  // Column widths from persisted session (with fallbacks for existing sessions without these fields)
  const columnWidths = session.columnWidths ?? EMPTY_COLUMN_WIDTHS;
  const fileColumnWidth = session.fileColumnWidth ?? 400;

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Column reordering state
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [orderedColumns, setOrderedColumns] =
    useState<string[]>(visibleColumns);

  // Column resizing state
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);
  const justResizedRef = useRef<boolean>(false);

  // Context menu state
  const [contextMenuRowId, setContextMenuRowId] = useState<string | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Cell selection state (range selection)
  const [activeCell, setActiveCell] = useState<CellPosition | null>(null);
  const [selectionRange, setSelectionRange] = useState<CellRange | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  // Fill handle state
  const [fillRange, setFillRange] = useState<{
    start: CellPosition;
    end: CellPosition;
  } | null>(null);
  const [isFilling, setIsFilling] = useState(false);

  // Editing state
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const editStartedByTypingRef = useRef(false);
  // Guard to prevent double-commit when blur fires after Enter/Tab
  const isCommittingRef = useRef(false);

  // Import from file (replace audio) state
  const importFromFileTargetIdsRef = useRef<string[]>([]);
  const [importFromFileDialogOpen, setImportFromFileDialogOpen] =
    useState(false);

  // Import from file upload progress state
  const [isImportingFromFile, setIsImportingFromFile] = useState(false);
  const [importFromFileProgress, setImportFromFileProgress] = useState({
    current: 0,
    total: 0,
  });

  // Undo/redo
  const { pushToUndoStack, handleUndo, handleRedo, canUndo, canRedo } =
    useTaggerHistory({ setTracks });

  // Sync ordered columns with visible columns prop
  useEffect(() => {
    setOrderedColumns((prev) => {
      const prevSet = new Set(prev);
      const newSet = new Set(visibleColumns);

      // If sets are identical but order differs (e.g., reset), adopt new order
      if (
        prevSet.size === newSet.size &&
        visibleColumns.every((c) => prevSet.has(c))
      ) {
        // Check if order is different
        const orderDiffers = prev.some((c, i) => c !== visibleColumns[i]);
        if (orderDiffers) {
          return visibleColumns;
        }
        return prev;
      }

      // If prev is empty, use visibleColumns directly
      if (prev.length === 0) {
        return visibleColumns;
      }

      // Otherwise, preserve existing order and add new columns at the end
      const newCols = visibleColumns.filter((c) => !prevSet.has(c));
      const filtered = prev.filter((c) => newSet.has(c));
      return [...filtered, ...newCols];
    });
  }, [visibleColumns]);

  // Convert track states to rows
  const rows: GridRow[] = Array.from(tracks.values()).map((state) => ({
    id: state.track.id,
    isStaged: state.track.isStaged,
    filePath: state.track.filePath,
    state,
  }));

  // Sort rows
  const sortedRows = [...rows].sort((a, b) => {
    if (!sortColumn || !sortDirection) return 0;

    let aVal: string;
    let bVal: string;

    if (sortColumn === "filePath") {
      aVal = a.filePath;
      bVal = b.filePath;
    } else {
      aVal = getTrackTagValue(a.state, sortColumn);
      bVal = getTrackTagValue(b.state, sortColumn);
    }

    const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
    return sortDirection === "asc" ? cmp : -cmp;
  });

  // Virtual row setup
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Focus input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      // Only select all if editing didn't start from typing
      if (!editStartedByTypingRef.current) {
        editInputRef.current.select();
      } else {
        // Move cursor to end when started by typing
        const len = editInputRef.current.value.length;
        editInputRef.current.setSelectionRange(len, len);
      }
      // Reset the flag
      editStartedByTypingRef.current = false;
    }
  }, [editingCell]);

  // Scroll to active cell when it changes
  useEffect(() => {
    if (!activeCell || !containerRef.current) return;

    const { rowIndex, colIndex } = activeCell;

    // Vertical scrolling using virtualizer
    rowVirtualizer.scrollToIndex(rowIndex, { align: "auto" });

    // Horizontal scrolling - calculate the position of the cell
    const container = containerRef.current;
    let cellLeft = CHECKBOX_WIDTH + COVER_ART_COLUMN_WIDTH; // Start after checkbox and cover art column

    // Add file column width if we're past it
    if (colIndex >= 0) {
      cellLeft += fileColumnWidth;
      // Add widths of columns before the target
      for (let i = 0; i < colIndex; i++) {
        cellLeft += columnWidths[orderedColumns[i]] ?? DEFAULT_TAG_COLUMN_WIDTH;
      }
    }

    // Get the cell width
    const cellWidth =
      colIndex === -1
        ? fileColumnWidth
        : (columnWidths[orderedColumns[colIndex]] ?? DEFAULT_TAG_COLUMN_WIDTH);

    const cellRight = cellLeft + cellWidth;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;

    // Scroll horizontally if needed
    if (cellLeft < viewLeft) {
      container.scrollLeft = cellLeft - CHECKBOX_WIDTH - COVER_ART_COLUMN_WIDTH; // Keep checkbox and cover art visible
    } else if (cellRight > viewRight) {
      container.scrollLeft = cellRight - container.clientWidth + 20; // 20px padding
    }
  }, [
    activeCell,
    rowVirtualizer,
    fileColumnWidth,
    columnWidths,
    orderedColumns,
  ]);

  // Get column width
  const getColumnWidth = (col: string) =>
    columnWidths[col] ?? DEFAULT_TAG_COLUMN_WIDTH;

  // Calculate total width
  const totalWidth =
    CHECKBOX_WIDTH +
    COVER_ART_COLUMN_WIDTH +
    fileColumnWidth +
    orderedColumns.reduce((sum, col) => sum + getColumnWidth(col), 0);

  // Handle checkbox click
  function handleCheckboxClick(
    e: React.MouseEvent,
    rowId: string,
    rowIndex: number,
  ) {
    e.stopPropagation();
    e.preventDefault();

    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    setSelectedIds((current) => {
      const newSet = new Set(current);

      if (isShift && lastClickedIndexRef.current !== null) {
        const start = Math.min(lastClickedIndexRef.current, rowIndex);
        const end = Math.max(lastClickedIndexRef.current, rowIndex);
        for (let i = start; i <= end; i++) {
          if (sortedRows[i]) {
            newSet.add(sortedRows[i].id);
          }
        }
      } else if (isCtrl) {
        if (newSet.has(rowId)) {
          newSet.delete(rowId);
        } else {
          newSet.add(rowId);
        }
      } else {
        if (newSet.has(rowId)) {
          newSet.delete(rowId);
        } else {
          newSet.add(rowId);
        }
      }

      return newSet;
    });

    lastClickedIndexRef.current = rowIndex;
  }

  // Handle select all
  function handleSelectAll() {
    if (selectedIds.size === sortedRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedRows.map((r) => r.id)));
    }
  }

  // Handle column header click for sorting
  function handleHeaderClick(column: string) {
    // Suppress click if we just finished resizing
    if (justResizedRef.current) {
      justResizedRef.current = false;
      return;
    }

    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  // Column resize handlers
  function handleResizeStart(
    e: React.MouseEvent,
    column: string,
    isFileColumn = false,
  ) {
    e.stopPropagation();
    e.preventDefault();
    setResizingColumn(isFileColumn ? "__file__" : column);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = isFileColumn
      ? fileColumnWidth
      : getColumnWidth(column);
  }

  useEffect(() => {
    if (!resizingColumn) return;

    function handleMouseMove(e: MouseEvent) {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(
        MIN_COLUMN_WIDTH,
        resizeStartWidth.current + delta,
      );

      if (resizingColumn === "__file__") {
        setSession((prev) => ({ ...prev, fileColumnWidth: newWidth }));
      } else {
        setSession((prev) => ({
          ...prev,
          columnWidths: {
            ...(prev.columnWidths ?? {}),
            [resizingColumn!]: newWidth,
          },
        }));
      }
    }

    function handleMouseUp() {
      justResizedRef.current = true;
      setResizingColumn(null);
      // Reset the flag after a short delay to allow the click to be suppressed
      setTimeout(() => {
        justResizedRef.current = false;
      }, 100);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingColumn, setSession]);

  // Column drag/reorder handlers
  function handleColumnDragStart(e: React.DragEvent, column: string) {
    e.stopPropagation();
    setDraggedColumn(column);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", column);
  }

  function handleColumnDragOver(e: React.DragEvent, targetColumn: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedColumn || draggedColumn === targetColumn) return;

    setOrderedColumns((prev) => {
      const newOrder = [...prev];
      const fromIndex = newOrder.indexOf(draggedColumn);
      const toIndex = newOrder.indexOf(targetColumn);
      if (fromIndex === -1 || toIndex === -1) return prev;

      newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, draggedColumn);
      return newOrder;
    });
  }

  function handleColumnDragEnd(e: React.DragEvent) {
    e.stopPropagation();
    setDraggedColumn(null);
    onColumnsReorder?.(orderedColumns);
  }

  // Get the track IDs that would be affected by context menu actions
  // Uses selected tracks if any, otherwise uses the right-clicked row
  function getContextMenuTargetIds(rightClickedRowId: string | null): string[] {
    if (selectedIds.size > 0) {
      return Array.from(selectedIds);
    }
    if (rightClickedRowId) {
      return [rightClickedRowId];
    }
    return [];
  }

  // Context menu handlers
  function handleContextMenuCut() {
    // Cut is copy + mark for delete (we'll implement as copy for now)
    handleContextMenuCopy();
  }

  function handleContextMenuCopy() {
    if (!selectionRange) return;

    const { rowStart, rowEnd, colStart, colEnd } =
      getRangeBounds(selectionRange);

    const lines: string[] = [];
    for (let r = rowStart; r <= rowEnd; r++) {
      const row = sortedRows[r];
      if (!row) continue;

      const cells: string[] = [];
      for (let c = colStart; c <= colEnd; c++) {
        const col = getColumnByIndex(c, orderedColumns);
        if (!col) continue;

        if (col === "filePath") {
          cells.push(row.filePath);
        } else {
          cells.push(getTrackTagValue(row.state, col));
        }
      }
      lines.push(cells.join("\t"));
    }

    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Copied to clipboard");
  }

  async function handleContextMenuPaste() {
    if (!selectionRange) return;

    const text = await navigator.clipboard.readText();
    if (!text) return;

    const clipboardRows = text.split("\n").map((row) => row.split("\t"));
    const startRow = Math.min(
      selectionRange.start.rowIndex,
      selectionRange.end.rowIndex,
    );
    const startCol = Math.min(
      selectionRange.start.colIndex,
      selectionRange.end.colIndex,
    );

    const affectedTrackIds: string[] = [];
    const historyEntries: HistoryEntry[] = [];

    setTracks((prev) => {
      const newTracks = new Map(prev);

      for (let i = 0; i < clipboardRows.length; i++) {
        const rowIndex = startRow + i;
        if (rowIndex >= sortedRows.length) break;

        const row = sortedRows[rowIndex];
        const state = newTracks.get(row.id);
        if (!state) continue;

        // Capture previous state for undo
        const previousEditedTags = { ...state.editedTags };
        const updatedEditedTags = { ...state.editedTags };

        for (let j = 0; j < clipboardRows[i].length; j++) {
          const colIndex = startCol + j;
          const col = getColumnByIndex(colIndex, orderedColumns);
          if (!col || col === "filePath") continue;

          const newValue = clipboardRows[i][j]?.trim() ?? "";
          const originalTag = state.track.tags.find((t) => t.key === col);
          const originalValue = originalTag?.value ?? "";

          if (newValue !== originalValue) {
            updatedEditedTags[col] = newValue;
          } else {
            delete updatedEditedTags[col];
          }
        }

        newTracks.set(row.id, {
          ...state,
          editedTags: updatedEditedTags,
        });
        affectedTrackIds.push(row.id);

        // Record history entry
        historyEntries.push({
          trackId: row.id,
          previousEditedTags,
          newEditedTags: updatedEditedTags,
        });
      }

      return newTracks;
    });

    // Push to undo stack
    if (historyEntries.length > 0) {
      pushToUndoStack(historyEntries);
    }

    if (affectedTrackIds.length > 0) {
      runOnTracks(affectedTrackIds);
    }

    toast.success("Pasted from clipboard");
  }

  function handleContextMenuRevert() {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    if (targetIds.length === 0) return;

    onRevertTracks?.(targetIds);
  }

  function handleContextMenuPlay() {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    if (targetIds.length === 0) return;

    // Separate staged and library tracks
    const stagedTracks = targetIds
      .map((id) => tracks.get(id))
      .filter((state) => state?.track.isStaged);
    const libraryTracks = targetIds
      .map((id) => tracks.get(id))
      .filter((state) => state && !state.track.isStaged);

    // If only staged tracks, use preview
    if (libraryTracks.length === 0 && stagedTracks.length > 0) {
      const client = getClient();
      if (!client) return;

      // For staged files, use preview audio (only first one)
      const firstStaged = stagedTracks[0]!;
      const streamUrl = client.getStagedFileStreamUrl(firstStaged.track.id);
      previewAudio.playUrl(streamUrl, firstStaged.track.id, 0);

      toast.success(
        stagedTracks.length === 1
          ? "Previewing staged file"
          : `Previewing first of ${stagedTracks.length} staged files`,
      );
      return;
    }

    // Get the song IDs from library tracks
    const songIds = libraryTracks.map((state) => state!.track.id);

    if (songIds.length === 0) {
      toast.error("No library tracks selected");
      return;
    }

    startQueue({
      sourceType: "other",
      sourceName: `Tagger: ${songIds.length} track${songIds.length > 1 ? "s" : ""}`,
      songIds,
      startIndex: 0,
    });

    toast.success(
      `Playing ${songIds.length} track${songIds.length > 1 ? "s" : ""}`,
    );
  }

  function handleContextMenuRemove() {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    if (targetIds.length === 0) return;

    onRemoveTracks?.(targetIds);
  }

  // Import from file - works for library tracks (single or batch)
  function handleImportFromFile() {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    if (targetIds.length === 0) return;

    // Filter to only library tracks
    const libraryTrackIds = targetIds.filter((id) => {
      const state = tracks.get(id);
      return state && !state.track.isStaged;
    });

    if (libraryTrackIds.length === 0) return;

    // Sort IDs by their position in sortedRows to match user's visible order
    const sortedTargetIds = libraryTrackIds.sort((a, b) => {
      const indexA = sortedRows.findIndex((r) => r.id === a);
      const indexB = sortedRows.findIndex((r) => r.id === b);
      return indexA - indexB;
    });

    // Store the target IDs and open the dialog
    importFromFileTargetIdsRef.current = sortedTargetIds;
    setImportFromFileDialogOpen(true);
  }

  async function handleImportFromFileConfirm(
    options: ImportFromFileOptions,
    files: File[],
    fileHandles?: {
      handle: FileSystemFileHandle;
      parentHandle: FileSystemDirectoryHandle;
    }[],
  ) {
    const targetIds = importFromFileTargetIdsRef.current;

    if (targetIds.length === 0 || files.length === 0) return;

    const client = getClient();
    if (!client) {
      toast.error("Not connected");
      return;
    }

    const newTracks = new Map(tracks);
    let successCount = 0;
    let failCount = 0;

    // Show progress dialog for batch uploads
    if (targetIds.length > 1) {
      setImportFromFileProgress({ current: 0, total: targetIds.length });
      setIsImportingFromFile(true);
    }

    // Process files - for single track use single file, for batch match by index
    for (let i = 0; i < targetIds.length; i++) {
      const trackId = targetIds[i];
      const file = files[i] ?? files[0]; // For single selection, use the first file

      if (!file) {
        console.error(`No file at index ${i} for track ${trackId}`);
        failCount++;
        if (targetIds.length > 1) {
          setImportFromFileProgress((prev) => ({
            ...prev,
            current: prev.current + 1,
          }));
        }
        continue;
      }

      try {
        const response = await client.uploadTaggerReplacementAudio(
          trackId,
          file,
          {
            importAudio: options.importAudio,
            importTags: options.importTags,
            importCoverArt: options.importCoverArt,
          },
        );

        const trackState = newTracks.get(trackId);
        if (trackState) {
          const updatedState = { ...trackState };

          // Update audio replacement state
          if (options.importAudio && response.audioImported) {
            updatedState.hasReplacementAudio = true;
            updatedState.replacementAudioFilename = response.originalName;
            updatedState.replacementAudioOriginalName = response.originalName;
          }

          // Update tags if imported
          // When importing, we REPLACE all tags - clear originals first, then set imported values
          if (options.importTags) {
            const newEditedTags: Record<string, string> = {};

            // First, mark all original tags as cleared (empty string)
            for (const tag of trackState.track.tags) {
              newEditedTags[tag.key] = "";
            }

            // Then apply imported tags (if any exist)
            if (response.importedTags) {
              for (const [key, value] of Object.entries(
                response.importedTags,
              )) {
                if (value !== undefined) {
                  newEditedTags[key] = value;
                }
              }
            }

            // Replace the editedTags entirely for tag-related keys
            updatedState.editedTags = {
              ...updatedState.editedTags,
              ...newEditedTags,
            };
          }

          // Update cover art state if imported
          // coverArtImported: true = new cover art added, false = source had no cover art (clear existing)
          if (options.importCoverArt) {
            if (response.coverArtImported) {
              // Fetch the cover art as data URL so it displays immediately
              try {
                const coverArtUrl = client.getTaggerCoverArtUrl(trackId);
                const coverArtResponse = await fetch(coverArtUrl);
                if (coverArtResponse.ok) {
                  const blob = await coverArtResponse.blob();
                  const dataUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                  });
                  updatedState.coverArt = {
                    dataUrl,
                    changed: true,
                    removed: false,
                  };
                } else {
                  // Fallback - just mark as changed
                  updatedState.coverArt = {
                    ...updatedState.coverArt,
                    changed: true,
                    removed: false,
                  };
                }
              } catch {
                // Fallback - just mark as changed
                updatedState.coverArt = {
                  ...updatedState.coverArt,
                  changed: true,
                  removed: false,
                };
              }
            } else {
              // Source file had no cover art - mark existing cover art as removed
              updatedState.coverArt = {
                changed: false,
                removed: true,
              };
            }
          }

          newTracks.set(trackId, updatedState);
        }
        successCount++;
      } catch (error) {
        console.error(`Failed to import from file for ${trackId}:`, error);
        failCount++;
      }

      if (targetIds.length > 1) {
        setImportFromFileProgress((prev) => ({
          ...prev,
          current: prev.current + 1,
        }));
      }
    }

    setTracks(newTracks);
    setIsImportingFromFile(false);

    // Build success message based on what was imported
    const importedItems: string[] = [];
    if (options.importAudio) importedItems.push("audio");
    if (options.importTags) importedItems.push("tags");
    if (options.importCoverArt) importedItems.push("cover art");
    const importedStr = importedItems.join(", ");

    if (failCount === 0) {
      toast.success(
        `Imported ${importedStr} for ${successCount} track${successCount !== 1 ? "s" : ""}`,
      );
    } else if (successCount === 0) {
      toast.error("Failed to import from file");
    } else {
      toast.warning(
        `Imported for ${successCount} of ${targetIds.length} tracks (${failCount} failed)`,
      );
    }

    // Move files: delete source files from the directory after successful import
    if (options.moveFiles && fileHandles && successCount > 0) {
      let moveCount = 0;
      for (let i = 0; i < targetIds.length; i++) {
        const handle = fileHandles[i];
        if (!handle) continue;
        try {
          await handle.parentHandle.removeEntry(handle.handle.name);
          moveCount++;
        } catch (err) {
          console.error(
            `Failed to remove source file ${handle.handle.name}:`,
            err,
          );
        }
      }
      if (moveCount > 0) {
        toast.success(
          `Removed ${moveCount} source file${moveCount !== 1 ? "s" : ""}`,
        );
      }
    }

    // Clean up
    importFromFileTargetIdsRef.current = [];
  }

  async function handleRevertImportFromFile() {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);

    // Filter to only tracks with replacement audio
    const tracksWithReplacement = targetIds.filter((id) => {
      const state = tracks.get(id);
      return state?.hasReplacementAudio;
    });

    if (tracksWithReplacement.length === 0) return;

    const client = getClient();
    if (!client) {
      toast.error("Not connected");
      return;
    }

    const newTracks = new Map(tracks);
    let successCount = 0;
    let failCount = 0;

    for (const trackId of tracksWithReplacement) {
      try {
        await client.deleteTaggerReplacementAudio(trackId);

        const trackState = newTracks.get(trackId);
        if (trackState) {
          newTracks.set(trackId, {
            ...trackState,
            hasReplacementAudio: false,
            replacementAudioFilename: undefined,
            replacementAudioOriginalName: undefined,
          });
        }
        successCount++;
      } catch (error) {
        console.error(
          `Failed to revert replacement audio for ${trackId}:`,
          error,
        );
        failCount++;
      }
    }

    setTracks(newTracks);

    if (failCount === 0) {
      toast.success(
        `Audio replacement reverted for ${successCount} track${successCount !== 1 ? "s" : ""}`,
      );
    } else {
      toast.warning(
        `Reverted ${successCount} of ${tracksWithReplacement.length} replacements (${failCount} failed)`,
      );
    }
  }

  // Determine if import from file option should be shown
  function getCanImportFromFile(): boolean {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    if (targetIds.length === 0) return false;

    // Check if any target is a library track (not staged)
    return targetIds.some((id) => {
      const state = tracks.get(id);
      return state && !state.track.isStaged;
    });
  }

  function getHasAnyReplacementAudio(): boolean {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    return targetIds.some((id) => {
      const state = tracks.get(id);
      return state?.hasReplacementAudio;
    });
  }

  function getImportFromFileLabel(): string {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    const libraryTrackCount = targetIds.filter((id) => {
      const state = tracks.get(id);
      return state && !state.track.isStaged;
    }).length;

    if (libraryTrackCount <= 1) {
      return "Replace with File...";
    }
    return `Replace with File (${libraryTrackCount} tracks)...`;
  }

  function handleContextMenuRunScript(scriptId: string) {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    if (targetIds.length === 0) return;

    const script = scripts.find((s) => s.id === scriptId);
    if (!script) return;

    if (script.type === "rename") {
      // For rename scripts, we just set computed paths
      const newTracks = new Map(tracks);
      let successCount = 0;
      let errorCount = 0;

      for (const id of targetIds) {
        const state = newTracks.get(id);
        if (!state) continue;

        const tags = getTrackTags(state);
        const filePath = state.track.filePath;
        const parts = filePath.split("/");
        const fullFilename = parts[parts.length - 1];
        const dotIdx = fullFilename.lastIndexOf(".");
        const filename =
          dotIdx > 0 ? fullFilename.slice(0, dotIdx) : fullFilename;
        const ext = dotIdx > 0 ? fullFilename.slice(dotIdx + 1) : "";

        const context: Record<string, string> = {
          filename,
          ext,
          filepath: filePath,
          title: tags.TITLE ?? "",
          artist: tags.ARTIST ?? "",
          albumartist: tags.ALBUMARTIST ?? "",
          album: tags.ALBUM ?? "",
          genre: tags.GENRE ?? "",
          year: tags.YEAR ?? "",
          tracknumber: tags.TRACKNUMBER ?? "",
          tracktotal: tags.TRACKTOTAL ?? "",
          discnumber: tags.DISCNUMBER ?? "",
          disctotal: tags.DISCTOTAL ?? "",
          comment: tags.COMMENT ?? "",
          composer: tags.COMPOSER ?? "",
        };

        try {
          const fn = new Function(...Object.keys(context), script.script);
          const result = fn(...Object.values(context));

          if (typeof result === "string" && result.trim()) {
            newTracks.set(id, { ...state, computedPath: result });
            successCount++;
          }
        } catch {
          errorCount++;
        }
      }

      setTracks(newTracks);
      if (errorCount > 0) {
        toast.warning(
          `Applied to ${successCount} tracks, ${errorCount} errors`,
        );
      } else {
        toast.success(`Applied rename script to ${successCount} tracks`);
      }
    } else {
      // For tag scripts, update editedTags
      const newTracks = new Map(tracks);
      let successCount = 0;
      let errorCount = 0;

      for (const id of targetIds) {
        const state = newTracks.get(id);
        if (!state) continue;

        const tags = getTrackTags(state);
        const filePath = state.track.filePath;
        const parts = filePath.split("/");
        const fullFilename = parts[parts.length - 1];
        const dotIdx = fullFilename.lastIndexOf(".");
        const filename =
          dotIdx > 0 ? fullFilename.slice(0, dotIdx) : fullFilename;
        const ext = dotIdx > 0 ? fullFilename.slice(dotIdx + 1) : "";

        const context: Record<string, string> = {
          filename,
          ext,
          filepath: filePath,
          title: tags.TITLE ?? "",
          artist: tags.ARTIST ?? "",
          albumartist: tags.ALBUMARTIST ?? "",
          album: tags.ALBUM ?? "",
          genre: tags.GENRE ?? "",
          year: tags.YEAR ?? "",
          tracknumber: tags.TRACKNUMBER ?? "",
          tracktotal: tags.TRACKTOTAL ?? "",
          discnumber: tags.DISCNUMBER ?? "",
          disctotal: tags.DISCTOTAL ?? "",
          comment: tags.COMMENT ?? "",
          composer: tags.COMPOSER ?? "",
        };

        try {
          const fn = new Function(...Object.keys(context), script.script);
          const result = fn(...Object.values(context));

          if (result && typeof result === "object") {
            const updatedEditedTags = { ...state.editedTags };
            for (const [key, value] of Object.entries(result)) {
              if (typeof value === "string") {
                const normalizedKey = key.toUpperCase();
                // Find original value for this tag
                const originalTag = state.track.tags.find(
                  (t) => t.key === normalizedKey,
                );
                const originalValue = originalTag?.value ?? "";

                // Only add to editedTags if value differs from original
                if (value !== originalValue) {
                  updatedEditedTags[normalizedKey] = value;
                } else {
                  // Remove from editedTags if value matches original
                  delete updatedEditedTags[normalizedKey];
                }
              }
            }
            newTracks.set(id, { ...state, editedTags: updatedEditedTags });
            successCount++;
          }
        } catch {
          errorCount++;
        }
      }

      setTracks(newTracks);
      // Run rename script on affected tracks if active
      runOnTracks(targetIds);

      if (errorCount > 0) {
        toast.warning(
          `Applied to ${successCount} tracks, ${errorCount} errors`,
        );
      } else {
        toast.success(`Applied tag script to ${successCount} tracks`);
      }
    }
  }

  function handleContextMenuSave() {
    const targetIds = getContextMenuTargetIds(contextMenuRowId);
    if (targetIds.length === 0) return;

    onSaveTracks?.(targetIds);
  }

  // Cell click - start selection and update focused row for details panel
  // Also handles double-click for faster edit initiation (e.detail === 2)
  function handleCellClick(
    e: React.MouseEvent,
    rowIndex: number,
    colIndex: number,
  ) {
    e.stopPropagation();

    // If this is a double-click, start editing immediately
    if (e.detail === 2) {
      // For file column, only edit if no rename script is active
      if (colIndex === -1 && !canEditPath) return;
      startEditing(rowIndex, colIndex);
      return;
    }

    // Check if clicking on already-active cell - skip redundant state updates
    const isAlreadyActive =
      activeCell?.rowIndex === rowIndex && activeCell?.colIndex === colIndex;

    // Update focused row ID for the details panel (only if different)
    const row = sortedRows[rowIndex];
    if (row) {
      setFocusedRowId(row.id);
    }

    // If already active and not shift-clicking, nothing to do
    if (isAlreadyActive && !e.shiftKey) {
      return;
    }

    const pos: CellPosition = { rowIndex, colIndex };

    if (e.shiftKey) {
      // Shift+click: extend selection from anchor to clicked cell
      // Use existing selection start as anchor, or current activeCell, or clicked position
      const anchor = selectionRange?.start ?? activeCell ?? pos;
      setActiveCell(pos);
      setSelectionRange({ start: anchor, end: pos });
    } else {
      // Regular click: start new selection at clicked cell
      setActiveCell(pos);
      setSelectionRange({ start: pos, end: pos });
    }

    setEditingCell(null);
  }

  // Cell mouse down - start range selection (drag to select)
  function handleCellMouseDown(
    e: React.MouseEvent,
    rowIndex: number,
    colIndex: number,
  ) {
    if (e.button !== 0) return; // Only left click

    // Skip on double-click (detail >= 2) - let handleCellClick handle it
    if (e.detail >= 2) return;

    // Skip drag selection if shift is held (shift+click is handled in handleCellClick)
    if (e.shiftKey) return;

    // Skip if clicking on already-active cell (avoid redundant updates)
    const isAlreadyActive =
      activeCell?.rowIndex === rowIndex && activeCell?.colIndex === colIndex;
    if (isAlreadyActive) return;

    const pos: CellPosition = { rowIndex, colIndex };
    setActiveCell(pos);
    setSelectionRange({ start: pos, end: pos });
    setIsSelecting(true);
  }

  // Mouse move during selection
  useEffect(() => {
    if (!isSelecting) return;

    function handleMouseMove(e: MouseEvent) {
      if (!containerRef.current || !selectionRange) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const scrollTop = containerRef.current.scrollTop;
      // containerRef is the scrollable area below the header, so no need to subtract HEADER_HEIGHT
      const relativeY = e.clientY - containerRect.top + scrollTop;
      const rowIndex = Math.max(
        0,
        Math.min(sortedRows.length - 1, Math.floor(relativeY / ROW_HEIGHT)),
      );

      // Calculate column index from X position
      let x = e.clientX - containerRect.left + containerRef.current.scrollLeft;
      x -= CHECKBOX_WIDTH + COVER_ART_COLUMN_WIDTH;

      let colIndex = -1;
      if (x >= fileColumnWidth) {
        x -= fileColumnWidth;
        let cumWidth = 0;
        for (let i = 0; i < orderedColumns.length; i++) {
          cumWidth +=
            columnWidths[orderedColumns[i]] ?? DEFAULT_TAG_COLUMN_WIDTH;
          if (x < cumWidth) {
            colIndex = i;
            break;
          }
        }
        if (colIndex === -1 && orderedColumns.length > 0) {
          colIndex = orderedColumns.length - 1;
        }
      }

      setSelectionRange((prev) =>
        prev ? { ...prev, end: { rowIndex, colIndex } } : null,
      );
    }

    function handleMouseUp() {
      setIsSelecting(false);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isSelecting,
    selectionRange,
    sortedRows.length,
    fileColumnWidth,
    orderedColumns,
    columnWidths,
  ]);

  // Fill handle - start
  function handleFillHandleMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    if (!selectionRange) return;

    setFillRange({ start: selectionRange.start, end: selectionRange.end });
    setIsFilling(true);
  }

  // Fill handle - mouse move and apply
  useEffect(() => {
    if (!isFilling || !fillRange) return;

    function handleMouseMove(e: MouseEvent) {
      if (!containerRef.current || !selectionRange) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const scrollTop = containerRef.current.scrollTop;
      // containerRef is the scrollable area below the header, so no need to subtract HEADER_HEIGHT
      const relativeY = e.clientY - containerRect.top + scrollTop;
      const rowIndex = Math.max(
        0,
        Math.min(sortedRows.length - 1, Math.floor(relativeY / ROW_HEIGHT)),
      );

      // Calculate column index from X position
      let x = e.clientX - containerRect.left + containerRef.current.scrollLeft;
      x -= CHECKBOX_WIDTH + COVER_ART_COLUMN_WIDTH;

      let colIndex = -1;
      if (x >= fileColumnWidth) {
        x -= fileColumnWidth;
        let cumWidth = 0;
        for (let i = 0; i < orderedColumns.length; i++) {
          cumWidth +=
            columnWidths[orderedColumns[i]] ?? DEFAULT_TAG_COLUMN_WIDTH;
          if (x < cumWidth) {
            colIndex = i;
            break;
          }
        }
        if (colIndex === -1 && orderedColumns.length > 0) {
          colIndex = orderedColumns.length - 1;
        }
      }

      setFillRange((prev) =>
        prev ? { ...prev, end: { rowIndex, colIndex } } : null,
      );
    }

    function handleMouseUp() {
      // Apply fill inline
      if (fillRange && selectionRange) {
        const srcRowStart = Math.min(
          selectionRange.start.rowIndex,
          selectionRange.end.rowIndex,
        );
        const srcRowEnd = Math.max(
          selectionRange.start.rowIndex,
          selectionRange.end.rowIndex,
        );
        const srcColStart = Math.min(
          selectionRange.start.colIndex,
          selectionRange.end.colIndex,
        );
        const srcColEnd = Math.max(
          selectionRange.start.colIndex,
          selectionRange.end.colIndex,
        );

        const tgtRowStart = Math.min(
          fillRange.start.rowIndex,
          fillRange.end.rowIndex,
        );
        const tgtRowEnd = Math.max(
          fillRange.start.rowIndex,
          fillRange.end.rowIndex,
        );
        const tgtColStart = Math.min(
          fillRange.start.colIndex,
          fillRange.end.colIndex,
        );
        const tgtColEnd = Math.max(
          fillRange.start.colIndex,
          fillRange.end.colIndex,
        );

        // Get source values
        const sourceValues: string[][] = [];
        for (let r = srcRowStart; r <= srcRowEnd; r++) {
          const rowVals: string[] = [];
          for (let c = srcColStart; c <= srcColEnd; c++) {
            const col = getColumnByIndex(c, orderedColumns);
            const row = sortedRows[r];
            if (col && row && col !== "filePath") {
              rowVals.push(getTrackTagValue(row.state, col));
            }
          }
          sourceValues.push(rowVals);
        }

        if (sourceValues.length > 0 && sourceValues[0].length > 0) {
          const affectedTrackIds: string[] = [];
          const historyEntries: HistoryEntry[] = [];

          setTracks((prev) => {
            const newTracks = new Map(prev);

            for (
              let r = Math.min(tgtRowStart, srcRowStart);
              r <= Math.max(tgtRowEnd, srcRowEnd);
              r++
            ) {
              // Skip source rows
              if (r >= srcRowStart && r <= srcRowEnd) continue;

              const row = sortedRows[r];
              if (!row) continue;

              const state = newTracks.get(row.id);
              if (!state) continue;

              // Capture previous state for undo
              const previousEditedTags = { ...state.editedTags };
              const updatedEditedTags = { ...state.editedTags };

              for (
                let c = Math.min(tgtColStart, srcColStart);
                c <= Math.max(tgtColEnd, srcColEnd);
                c++
              ) {
                const col = getColumnByIndex(c, orderedColumns);
                if (!col || col === "filePath") continue;

                // Get source value (cycle through source rows/cols)
                const srcRowOffset =
                  (((r - Math.min(tgtRowStart, srcRowStart)) %
                    sourceValues.length) +
                    sourceValues.length) %
                  sourceValues.length;
                const srcColOffset =
                  (((c - Math.min(tgtColStart, srcColStart)) %
                    sourceValues[0].length) +
                    sourceValues[0].length) %
                  sourceValues[0].length;
                const sourceValue =
                  sourceValues[srcRowOffset]?.[srcColOffset] ?? "";

                const originalTag = state.track.tags.find((t) => t.key === col);
                const originalValue = originalTag?.value ?? "";

                if (sourceValue !== originalValue) {
                  updatedEditedTags[col] = sourceValue;
                } else {
                  delete updatedEditedTags[col];
                }
              }

              newTracks.set(row.id, {
                ...state,
                editedTags: updatedEditedTags,
              });
              affectedTrackIds.push(row.id);

              // Record history entry
              historyEntries.push({
                trackId: row.id,
                previousEditedTags,
                newEditedTags: updatedEditedTags,
              });
            }

            return newTracks;
          });

          // Push to undo stack
          if (historyEntries.length > 0) {
            pushToUndoStack(historyEntries);
          }

          // Re-run rename script for affected tracks
          if (affectedTrackIds.length > 0) {
            runOnTracks(affectedTrackIds);
          }

          // Update selection to include filled area
          setSelectionRange({
            start: {
              rowIndex: Math.min(srcRowStart, tgtRowStart),
              colIndex: Math.min(srcColStart, tgtColStart),
            },
            end: {
              rowIndex: Math.max(srcRowEnd, tgtRowEnd),
              colIndex: Math.max(srcColEnd, tgtColEnd),
            },
          });
        }
      }
      setIsFilling(false);
      setFillRange(null);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isFilling,
    fillRange,
    selectionRange,
    sortedRows,
    fileColumnWidth,
    orderedColumns,
    columnWidths,
    setTracks,
    runOnTracks,
    pushToUndoStack,
  ]);

  // Sync header scroll with content scroll
  useEffect(() => {
    const container = containerRef.current;
    const header = headerRef.current;
    if (!container || !header) return;

    function handleScroll() {
      if (header && container) {
        header.scrollLeft = container.scrollLeft;
      }
    }

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Check if manual path editing is allowed (no active rename script)
  const canEditPath = !session.activeRenameScriptId;

  // Start editing a cell
  function startEditing(rowIndex: number, colIndex: number) {
    // Can only edit file column if no rename script is active
    if (colIndex === -1 && !canEditPath) return;

    const row = sortedRows[rowIndex];
    if (!row) return;

    const col = getColumnByIndex(colIndex, orderedColumns);
    if (!col) return;

    // For file path, get the current effective path
    if (col === "filePath") {
      const currentPath = row.state.computedPath || row.filePath;
      setEditValue(currentPath);
    } else {
      const currentValue = getTrackTagValue(row.state, col);
      setEditValue(currentValue);
    }
    setEditingCell({ rowIndex, colIndex });
  }

  // Commit edit and optionally move to a direction
  function commitEdit(moveDirection?: "down" | "right" | "left") {
    if (!editingCell) return;
    // Prevent double-commit (blur fires after Enter/Tab removes input from DOM)
    if (isCommittingRef.current) return;
    isCommittingRef.current = true;

    const { rowIndex, colIndex } = editingCell;
    const row = sortedRows[rowIndex];
    const col = getColumnByIndex(colIndex, orderedColumns);

    if (!row || !col) {
      setEditingCell(null);
      gridRef.current?.focus();
      queueMicrotask(() => {
        isCommittingRef.current = false;
      });
      return;
    }

    const state = tracks.get(row.id);
    if (!state) {
      setEditingCell(null);
      gridRef.current?.focus();
      queueMicrotask(() => {
        isCommittingRef.current = false;
      });
      return;
    }

    // Handle file path editing separately
    if (col === "filePath") {
      const originalPath = row.filePath;
      if (editValue !== originalPath) {
        setTracks((prev) => {
          const newTracks = new Map(prev);
          const currentState = newTracks.get(row.id);
          if (currentState) {
            newTracks.set(row.id, {
              ...currentState,
              computedPath: editValue !== originalPath ? editValue : null,
            });
          }
          return newTracks;
        });
      }
    } else {
      const originalTag = state.track.tags.find((t) => t.key === col);
      const originalValue = originalTag?.value ?? "";
      const currentEditedValue = state.editedTags[col];

      // Determine if we actually need to update anything
      // We need to update if:
      // 1. The new value differs from the original AND there's no edit or the edit differs
      // 2. The new value equals the original AND there's currently an edit (need to remove it)
      const hasExistingEdit = currentEditedValue !== undefined;
      const needsUpdate =
        (editValue !== originalValue && currentEditedValue !== editValue) ||
        (editValue === originalValue && hasExistingEdit);

      if (needsUpdate) {
        // Capture previous state for undo
        const previousEditedTags = { ...state.editedTags };

        // Calculate new edited tags
        const newEditedTags = { ...state.editedTags };
        if (editValue !== originalValue) {
          newEditedTags[col] = editValue;
        } else {
          delete newEditedTags[col];
        }

        setTracks((prev) => {
          const newTracks = new Map(prev);
          const currentState = newTracks.get(row.id);
          if (currentState) {
            newTracks.set(row.id, {
              ...currentState,
              editedTags: newEditedTags,
            });
          }
          return newTracks;
        });

        // Record history entry OUTSIDE of setTracks
        pushToUndoStack([
          {
            trackId: row.id,
            previousEditedTags,
            newEditedTags,
          },
        ]);

        // Re-run rename script for this track since tags changed
        runOnTracks([row.id]);
      }
    }

    setEditingCell(null);

    // Move to next cell based on direction
    if (moveDirection === "down") {
      // Move to cell below (same column)
      const nextRow = Math.min(rowIndex + 1, sortedRows.length - 1);
      const newPos = { rowIndex: nextRow, colIndex };
      setActiveCell(newPos);
      setSelectionRange({ start: newPos, end: newPos });
      const targetRow = sortedRows[nextRow];
      if (targetRow) setFocusedRowId(targetRow.id);
    } else if (moveDirection === "right") {
      // Move to next cell right, wrap to next row
      let nextCol = colIndex + 1;
      let nextRow = rowIndex;
      if (nextCol >= orderedColumns.length) {
        nextCol = 0;
        nextRow = Math.min(rowIndex + 1, sortedRows.length - 1);
      }
      const newPos = { rowIndex: nextRow, colIndex: nextCol };
      setActiveCell(newPos);
      setSelectionRange({ start: newPos, end: newPos });
      const targetRow = sortedRows[nextRow];
      if (targetRow) setFocusedRowId(targetRow.id);
    } else if (moveDirection === "left") {
      // Move to previous cell left, wrap to previous row
      let nextCol = colIndex - 1;
      let nextRow = rowIndex;
      if (nextCol < 0) {
        nextCol = orderedColumns.length - 1;
        nextRow = Math.max(rowIndex - 1, 0);
      }
      const newPos = { rowIndex: nextRow, colIndex: nextCol };
      setActiveCell(newPos);
      setSelectionRange({ start: newPos, end: newPos });
      const targetRow = sortedRows[nextRow];
      if (targetRow) setFocusedRowId(targetRow.id);
    }

    // Refocus grid to maintain keyboard navigation
    gridRef.current?.focus();

    // Reset commit guard after a microtask to allow blur event to be ignored
    queueMicrotask(() => {
      isCommittingRef.current = false;
    });
  }

  // Cancel edit
  function cancelEdit() {
    setEditingCell(null);
  }

  // Handle keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    // Handle undo/redo first (even while editing)
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === "y" || (e.key === "z" && e.shiftKey))
    ) {
      e.preventDefault();
      handleRedo();
      return;
    }

    // If editing, let the input handle most keys
    if (editingCell) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
        gridRef.current?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        commitEdit("down"); // Move down after Enter
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          commitEdit("left"); // Move left on Shift+Tab
        } else {
          commitEdit("right"); // Move right on Tab
        }
      }
      return;
    }

    // Ctrl+A to select all rows and cells
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      // Select all rows
      const allIds = new Set(sortedRows.map((r) => r.id));
      setSelectedIds(allIds);
      // Select all cells
      if (sortedRows.length > 0 && orderedColumns.length > 0) {
        setSelectionRange({
          start: { rowIndex: 0, colIndex: 0 },
          end: {
            rowIndex: sortedRows.length - 1,
            colIndex: orderedColumns.length - 1,
          },
        });
        setActiveCell({ rowIndex: 0, colIndex: 0 });
      }
      return;
    }

    // Escape to clear selection
    if (e.key === "Escape") {
      e.preventDefault();
      setSelectedIds(new Set());
      setSelectionRange(null);
      setActiveCell(null);
      return;
    }

    // Delete key to remove selected tracks from the tagger
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      // Use selected rows or fall back to active cell's row
      const targetIds =
        selectedIds.size > 0
          ? Array.from(selectedIds)
          : activeCell
            ? [sortedRows[activeCell.rowIndex]?.id].filter(Boolean)
            : [];
      if (targetIds.length > 0) {
        onRemoveTracks?.(targetIds as string[]);
      }
      return;
    }

    if (!activeCell) return;

    const { rowIndex, colIndex } = activeCell;

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (rowIndex > 0) {
          const newPos = { rowIndex: rowIndex - 1, colIndex };
          setActiveCell(newPos);
          // Update focused row for details panel
          const upRow = sortedRows[rowIndex - 1];
          if (upRow) setFocusedRowId(upRow.id);
          if (e.shiftKey) {
            // Extend selection from anchor (existing start or current position)
            const anchor = selectionRange?.start ?? { rowIndex, colIndex };
            setSelectionRange({ start: anchor, end: newPos });
          } else {
            setSelectionRange({ start: newPos, end: newPos });
          }
        }
        break;

      case "ArrowDown":
        e.preventDefault();
        if (rowIndex < sortedRows.length - 1) {
          const newPos = { rowIndex: rowIndex + 1, colIndex };
          setActiveCell(newPos);
          // Update focused row for details panel
          const downRow = sortedRows[rowIndex + 1];
          if (downRow) setFocusedRowId(downRow.id);
          if (e.shiftKey) {
            // Extend selection from anchor (existing start or current position)
            const anchor = selectionRange?.start ?? { rowIndex, colIndex };
            setSelectionRange({ start: anchor, end: newPos });
          } else {
            setSelectionRange({ start: newPos, end: newPos });
          }
        }
        break;

      case "ArrowLeft":
        e.preventDefault();
        // Allow going to File column (-1)
        if (colIndex > -1) {
          const newPos = { rowIndex, colIndex: colIndex - 1 };
          setActiveCell(newPos);
          if (e.shiftKey) {
            // Extend selection from anchor (existing start or current position)
            const anchor = selectionRange?.start ?? { rowIndex, colIndex };
            setSelectionRange({ start: anchor, end: newPos });
          } else {
            setSelectionRange({ start: newPos, end: newPos });
          }
        }
        break;

      case "ArrowRight":
        e.preventDefault();
        if (colIndex < orderedColumns.length - 1) {
          const newPos = { rowIndex, colIndex: colIndex + 1 };
          setActiveCell(newPos);
          if (e.shiftKey) {
            // Extend selection from anchor (existing start or current position)
            const anchor = selectionRange?.start ?? { rowIndex, colIndex };
            setSelectionRange({ start: anchor, end: newPos });
          } else {
            setSelectionRange({ start: newPos, end: newPos });
          }
        }
        break;

      case "Enter":
      case " ":
        e.preventDefault();
        if (colIndex >= 0) {
          startEditing(rowIndex, colIndex);
        }
        break;

      case "F2":
        e.preventDefault();
        if (colIndex >= 0) {
          startEditing(rowIndex, colIndex);
        }
        break;

      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          // Move left, wrap to previous row
          let nextCol = colIndex - 1;
          let nextRow = rowIndex;
          if (nextCol < -1) {
            // If we're at file column, wrap to previous row's last column
            nextCol = orderedColumns.length - 1;
            nextRow = Math.max(rowIndex - 1, 0);
          }
          const newPosLeft = { rowIndex: nextRow, colIndex: nextCol };
          setActiveCell(newPosLeft);
          setSelectionRange({ start: newPosLeft, end: newPosLeft });
          const leftRow = sortedRows[nextRow];
          if (leftRow) setFocusedRowId(leftRow.id);
        } else {
          // Move right, wrap to next row
          let nextCol = colIndex + 1;
          let nextRow = rowIndex;
          if (nextCol >= orderedColumns.length) {
            nextCol = -1; // Start at file column
            nextRow = Math.min(rowIndex + 1, sortedRows.length - 1);
          }
          const newPosRight = { rowIndex: nextRow, colIndex: nextCol };
          setActiveCell(newPosRight);
          setSelectionRange({ start: newPosRight, end: newPosRight });
          const rightRow = sortedRows[nextRow];
          if (rightRow) setFocusedRowId(rightRow.id);
        }
        break;

      default:
        // Start editing immediately when typing a printable character
        // Only for tag columns (colIndex >= 0), and only for single printable characters
        if (
          colIndex >= 0 &&
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          e.preventDefault();
          // Start editing with the typed character as initial value
          const row = sortedRows[rowIndex];
          if (row) {
            editStartedByTypingRef.current = true;
            setEditingCell({ rowIndex, colIndex });
            setEditValue(e.key); // Start with the typed character
          }
        }
        break;
    }
  }

  // Handle paste
  function handlePaste(e: React.ClipboardEvent) {
    if (editingCell) return;
    if (!selectionRange) return;

    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;

    const clipboardRows = text.split("\n").map((row) => row.split("\t"));
    const startRow = Math.min(
      selectionRange.start.rowIndex,
      selectionRange.end.rowIndex,
    );
    const startCol = Math.min(
      selectionRange.start.colIndex,
      selectionRange.end.colIndex,
    );

    const affectedTrackIds: string[] = [];
    const historyEntries: HistoryEntry[] = [];

    setTracks((prev) => {
      const newTracks = new Map(prev);

      for (let i = 0; i < clipboardRows.length; i++) {
        const rowIndex = startRow + i;
        if (rowIndex >= sortedRows.length) break;

        const row = sortedRows[rowIndex];
        const state = newTracks.get(row.id);
        if (!state) continue;

        // Capture previous state for undo
        const previousEditedTags = { ...state.editedTags };
        const updatedEditedTags = { ...state.editedTags };

        for (let j = 0; j < clipboardRows[i].length; j++) {
          const colIndex = startCol + j;
          const col = getColumnByIndex(colIndex, orderedColumns);
          if (!col || col === "filePath") continue;

          const newValue = clipboardRows[i][j]?.trim() ?? "";
          const originalTag = state.track.tags.find((t) => t.key === col);
          const originalValue = originalTag?.value ?? "";

          if (newValue !== originalValue) {
            updatedEditedTags[col] = newValue;
          } else {
            delete updatedEditedTags[col];
          }
        }

        newTracks.set(row.id, {
          ...state,
          editedTags: updatedEditedTags,
        });
        affectedTrackIds.push(row.id);

        // Record history entry
        historyEntries.push({
          trackId: row.id,
          previousEditedTags,
          newEditedTags: updatedEditedTags,
        });
      }

      return newTracks;
    });

    // Push to undo stack
    if (historyEntries.length > 0) {
      pushToUndoStack(historyEntries);
    }

    // Re-run rename script for affected tracks
    if (affectedTrackIds.length > 0) {
      runOnTracks(affectedTrackIds);
    }

    e.preventDefault();
  }

  // Handle copy
  function handleCopy(e: React.ClipboardEvent) {
    if (editingCell) return;
    if (!selectionRange) return;

    const { rowStart, rowEnd, colStart, colEnd } =
      getRangeBounds(selectionRange);

    const lines: string[] = [];
    for (let r = rowStart; r <= rowEnd; r++) {
      const row = sortedRows[r];
      if (!row) continue;

      const cells: string[] = [];
      for (let c = colStart; c <= colEnd; c++) {
        const col = getColumnByIndex(c, orderedColumns);
        if (!col) continue;

        if (col === "filePath") {
          cells.push(row.filePath);
        } else {
          cells.push(getTrackTagValue(row.state, col));
        }
      }
      lines.push(cells.join("\t"));
    }

    e.clipboardData?.setData("text/plain", lines.join("\n"));
    e.preventDefault();
  }

  // Handle context menu
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();

    // Update position and open the menu
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuOpen(true);

    // Find which row was right-clicked
    const target = e.target as HTMLElement;
    const rowElement = target.closest("[data-row-id]");
    if (rowElement) {
      const rowId = rowElement.getAttribute("data-row-id");
      setContextMenuRowId(rowId);

      // If the right-clicked row is not selected, select it (and deselect others)
      if (rowId && !selectedIds.has(rowId)) {
        setSelectedIds(new Set([rowId]));
        setFocusedRowId(rowId);
      }

      // Find which cell was right-clicked and set it as active for copy/paste
      const cellElement = target.closest("[data-col-index]");
      if (cellElement && rowId) {
        const colIndexStr = cellElement.getAttribute("data-col-index");
        const rowIndex = sortedRows.findIndex((r) => r.id === rowId);
        if (colIndexStr !== null && rowIndex !== -1) {
          const colIndex = parseInt(colIndexStr, 10);
          const cellPos: CellPosition = { rowIndex, colIndex };

          // Always update active cell to the right-clicked cell
          setActiveCell(cellPos);

          // Check if clicked cell is within the current selection
          const isInCurrentSelection =
            selectionRange &&
            rowIndex >=
              Math.min(
                selectionRange.start.rowIndex,
                selectionRange.end.rowIndex,
              ) &&
            rowIndex <=
              Math.max(
                selectionRange.start.rowIndex,
                selectionRange.end.rowIndex,
              ) &&
            colIndex >=
              Math.min(
                selectionRange.start.colIndex,
                selectionRange.end.colIndex,
              ) &&
            colIndex <=
              Math.max(
                selectionRange.start.colIndex,
                selectionRange.end.colIndex,
              );

          // Only collapse selection if clicked cell is outside current selection
          if (!isInCurrentSelection) {
            setSelectionRange({ start: cellPos, end: cellPos });
          }
        }
      }
    } else {
      setContextMenuRowId(null);
    }
  }

  const allSelected =
    sortedRows.length > 0 && selectedIds.size === sortedRows.length;
  const someSelected =
    selectedIds.size > 0 && selectedIds.size < sortedRows.length;

  return (
    <div
      ref={gridRef}
      className="h-full w-full flex flex-col overflow-hidden bg-background select-none outline-none"
      tabIndex={0}
      onPaste={handlePaste}
      onCopy={handleCopy}
      onKeyDown={handleKeyDown}
      onDragOver={(e) => e.stopPropagation()}
      onDragEnter={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <TaggerGridHeader
        orderedColumns={orderedColumns}
        fileColumnWidth={fileColumnWidth}
        columnWidths={columnWidths}
        totalWidth={totalWidth}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onHeaderClick={handleHeaderClick}
        allSelected={allSelected}
        someSelected={someSelected}
        onSelectAll={handleSelectAll}
        draggedColumn={draggedColumn}
        onColumnDragStart={handleColumnDragStart}
        onColumnDragOver={handleColumnDragOver}
        onColumnDragEnd={handleColumnDragEnd}
        onResizeStart={handleResizeStart}
        headerRef={headerRef}
      />

      {/* Context menu */}
      <TaggerGridContextMenu
        open={contextMenuOpen}
        onOpenChange={setContextMenuOpen}
        position={contextMenuPosition}
        onCut={handleContextMenuCut}
        onCopy={handleContextMenuCopy}
        onPaste={handleContextMenuPaste}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onRevert={handleContextMenuRevert}
        onPlay={handleContextMenuPlay}
        onRunScript={handleContextMenuRunScript}
        onRunOneOffScript={() => onOpenOneOffScript?.()}
        onSave={handleContextMenuSave}
        onRemove={handleContextMenuRemove}
        onImportFromFile={handleImportFromFile}
        onRevertImportFromFile={handleRevertImportFromFile}
        canUndo={canUndo}
        canRedo={canRedo}
        canRevert={!!onRevertTracks}
        canSave={!!onSaveTracks}
        canRemove={!!onRemoveTracks}
        canImportFromFile={getCanImportFromFile()}
        hasAnyReplacementAudio={getHasAnyReplacementAudio()}
        importFromFileLabel={getImportFromFileLabel()}
        scripts={scripts}
        selectedCount={selectedIds.size}
      />

      {/* Import from file options dialog */}
      <ImportFromFileDialog
        open={importFromFileDialogOpen}
        onOpenChange={setImportFromFileDialogOpen}
        trackCount={importFromFileTargetIdsRef.current.length}
        trackNames={importFromFileTargetIdsRef.current.map((id) => {
          const state = tracks.get(id);
          if (!state) return id;
          const title = getTrackTagValue(state, "TITLE");
          const artist = getTrackTagValue(state, "ARTIST");
          if (title && artist) return `${artist} - ${title}`;
          if (title) return title;
          // Fallback to filename
          return state.track.filePath.split("/").pop() ?? id;
        })}
        onConfirm={handleImportFromFileConfirm}
      />

      {/* Import from file progress dialog */}
      <Dialog open={isImportingFromFile}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Replacing with File...
            </DialogTitle>
            <DialogDescription className="sr-only">
              File import progress
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Progress
              value={
                importFromFileProgress.total > 0
                  ? (importFromFileProgress.current /
                      importFromFileProgress.total) *
                    100
                  : 0
              }
            />
            <p className="text-sm text-muted-foreground text-center">
              {importFromFileProgress.current} of {importFromFileProgress.total}{" "}
              files processed
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rows container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onContextMenu={handleContextMenu}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: totalWidth,
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = sortedRows[virtualRow.index];
            if (!row) return null;

            const isRowSelected = selectedIds.has(row.id);

            return (
              <TaggerGridRow
                key={row.id}
                row={row}
                virtualRowIndex={virtualRow.index}
                virtualRowStart={virtualRow.start}
                totalWidth={totalWidth}
                isRowSelected={isRowSelected}
                orderedColumns={orderedColumns}
                fileColumnWidth={fileColumnWidth}
                columnWidths={columnWidths}
                showComputedPath={session.showComputedPath ?? true}
                showLibraryPrefix={session.showLibraryPrefix ?? false}
                activeCell={activeCell}
                selectionRange={selectionRange}
                fillRange={fillRange}
                editingCell={editingCell}
                editValue={editValue}
                setEditValue={setEditValue}
                editInputRef={editInputRef}
                onCheckboxClick={handleCheckboxClick}
                onCellClick={handleCellClick}
                onCellMouseDown={handleCellMouseDown}
                onFillHandleMouseDown={handleFillHandleMouseDown}
                onCommitEdit={commitEdit}
                onCancelEdit={cancelEdit}
                gridRef={gridRef}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
