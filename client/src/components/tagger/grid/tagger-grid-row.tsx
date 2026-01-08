"use client";

import { Check, ImagePlus, ImageMinus, FileAudio } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTrackTagValue } from "@/lib/store/tagger";
import {
  ROW_HEIGHT,
  CHECKBOX_WIDTH,
  COVER_ART_COLUMN_WIDTH,
  DEFAULT_TAG_COLUMN_WIDTH,
  type GridRow,
  type CellPosition,
  type CellRange,
} from "./types";
import { isCellInRange, isBottomRightOfRange } from "./utils";

interface TaggerGridRowProps {
  row: GridRow;
  virtualRowIndex: number;
  virtualRowStart: number;
  totalWidth: number;
  isRowSelected: boolean;
  orderedColumns: string[];
  fileColumnWidth: number;
  columnWidths: Record<string, number>;
  showComputedPath: boolean;
  showLibraryPrefix: boolean;
  // Cell state
  activeCell: CellPosition | null;
  selectionRange: CellRange | null;
  fillRange: CellRange | null;
  editingCell: CellPosition | null;
  editValue: string;
  setEditValue: (value: string) => void;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  // Handlers
  onCheckboxClick: (
    e: React.MouseEvent,
    rowId: string,
    rowIndex: number,
  ) => void;
  onCellClick: (
    e: React.MouseEvent,
    rowIndex: number,
    colIndex: number,
  ) => void;
  onCellMouseDown: (
    e: React.MouseEvent,
    rowIndex: number,
    colIndex: number,
  ) => void;
  onFillHandleMouseDown: (e: React.MouseEvent) => void;
  onCommitEdit: (direction?: "down" | "right" | "left") => void;
  onCancelEdit: () => void;
  gridRef: React.RefObject<HTMLDivElement | null>;
}

export function TaggerGridRow({
  row,
  virtualRowIndex,
  virtualRowStart,
  totalWidth,
  isRowSelected,
  orderedColumns,
  fileColumnWidth,
  columnWidths,
  showComputedPath,
  showLibraryPrefix,
  activeCell,
  selectionRange,
  fillRange,
  editingCell,
  editValue,
  setEditValue,
  editInputRef,
  onCheckboxClick,
  onCellClick,
  onCellMouseDown,
  onFillHandleMouseDown,
  onCommitEdit,
  onCancelEdit,
  gridRef,
}: TaggerGridRowProps) {
  const editedTags = Object.keys(row.state.editedTags);
  const getColumnWidth = (col: string) =>
    columnWidths[col] ?? DEFAULT_TAG_COLUMN_WIDTH;

  // Check if cell is in fill range (extended area beyond selection)
  function isCellInFillRange(rowIndex: number, colIndex: number): boolean {
    if (!fillRange || !selectionRange) return false;

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

    // Check if in source selection
    if (
      rowIndex >= srcRowStart &&
      rowIndex <= srcRowEnd &&
      colIndex >= srcColStart &&
      colIndex <= srcColEnd
    ) {
      return false;
    }

    const fillRowStart = Math.min(
      fillRange.start.rowIndex,
      fillRange.end.rowIndex,
      srcRowStart,
    );
    const fillRowEnd = Math.max(
      fillRange.start.rowIndex,
      fillRange.end.rowIndex,
      srcRowEnd,
    );
    const fillColStart = Math.min(
      fillRange.start.colIndex,
      fillRange.end.colIndex,
      srcColStart,
    );
    const fillColEnd = Math.max(
      fillRange.start.colIndex,
      fillRange.end.colIndex,
      srcColEnd,
    );

    return (
      rowIndex >= fillRowStart &&
      rowIndex <= fillRowEnd &&
      colIndex >= fillColStart &&
      colIndex <= fillColEnd
    );
  }

  return (
    <div
      key={row.id}
      data-row-id={row.id}
      className={cn(
        "absolute top-0 left-0 flex border-b border-border/50",
        isRowSelected && "bg-primary/15",
      )}
      style={{
        height: ROW_HEIGHT,
        width: totalWidth,
        transform: `translateY(${virtualRowStart}px)`,
      }}
    >
      {/* Checkbox cell */}
      <div
        className={cn(
          "flex items-center justify-center border-r border-border/50 shrink-0 cursor-pointer hover:bg-muted/30",
          isRowSelected && "bg-primary/10",
        )}
        style={{ width: CHECKBOX_WIDTH }}
        onClick={(e) => onCheckboxClick(e, row.id, virtualRowIndex)}
      >
        <div
          className={cn(
            "w-4 h-4 rounded border flex items-center justify-center transition-colors",
            isRowSelected
              ? "bg-primary border-primary"
              : "border-muted-foreground hover:border-primary",
          )}
        >
          {isRowSelected && (
            <Check className="w-3 h-3 text-primary-foreground" />
          )}
        </div>
      </div>

      {/* Cover art / replacement audio status cell */}
      <div
        className={cn(
          "flex items-center justify-center gap-1 border-r border-border/50 shrink-0",
          isRowSelected && "bg-primary/10",
        )}
        style={{ width: COVER_ART_COLUMN_WIDTH }}
        title={
          row.state.hasReplacementAudio
            ? `Audio replacement: ${row.state.replacementAudioOriginalName ?? "staged"}`
            : row.state.coverArt?.removed
              ? "Cover art will be removed"
              : row.state.coverArt?.changed
                ? "Cover art changed"
                : undefined
        }
      >
        {row.state.coverArt?.removed ? (
          <ImageMinus className="w-4 h-4 text-destructive" />
        ) : row.state.coverArt?.changed ? (
          <ImagePlus className="w-4 h-4 text-green-500" />
        ) : null}
        {row.state.hasReplacementAudio && (
          <FileAudio className="w-4 h-4 text-blue-500" />
        )}
      </div>

      {/* File cell - shows path based on showComputedPath and showLibraryPrefix settings */}
      {(() => {
        const hasPathChange =
          row.state.computedPath && row.state.computedPath !== row.filePath;
        // Show computed path only if setting is enabled AND there's a computed path
        const relativePath =
          showComputedPath && hasPathChange
            ? row.state.computedPath!
            : row.filePath;

        // Prepend library path if setting is enabled and track has music folder info
        const musicFolderPath = row.state.track.musicFolderPath;
        const displayPath =
          showLibraryPrefix && musicFolderPath && !row.isStaged
            ? `${musicFolderPath}/${relativePath}`
            : relativePath;

        const isEditingPath =
          editingCell?.rowIndex === virtualRowIndex &&
          editingCell?.colIndex === -1;

        return (
          <div
            data-col-index={-1}
            className={cn(
              "flex items-center px-3 text-sm border-r border-border/50 shrink-0 truncate relative",
              isRowSelected && "bg-primary/10",
              isCellInRange(virtualRowIndex, -1, selectionRange) &&
                "bg-blue-500/20",
              activeCell?.rowIndex === virtualRowIndex &&
                activeCell?.colIndex === -1 &&
                "ring-2 ring-primary ring-inset",
              hasPathChange && "text-primary font-medium bg-primary/10",
            )}
            style={{ width: fileColumnWidth }}
            title={
              hasPathChange
                ? `Original: ${row.filePath}\nNew: ${row.state.computedPath}`
                : row.filePath
            }
            onClick={(e) => onCellClick(e, virtualRowIndex, -1)}
            onMouseDown={(e) => onCellMouseDown(e, virtualRowIndex, -1)}
          >
            {isEditingPath ? (
              <input
                ref={editInputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={() => onCommitEdit()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCommitEdit("down");
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onCancelEdit();
                    gridRef.current?.focus();
                  } else if (e.key === "Tab") {
                    e.preventDefault();
                    if (e.shiftKey) {
                      onCommitEdit("left");
                    } else {
                      onCommitEdit("right");
                    }
                  }
                  e.stopPropagation();
                }}
                className="w-full h-6 px-1 bg-background border border-primary rounded text-sm focus:outline-none"
              />
            ) : (
              displayPath
            )}
          </div>
        );
      })()}

      {/* Tag cells */}
      {orderedColumns.map((col, colIdx) => {
        const value = getTrackTagValue(row.state, col);
        const isEdited = editedTags.includes(col);
        const isEditing =
          editingCell?.rowIndex === virtualRowIndex &&
          editingCell?.colIndex === colIdx;
        const isInSelection = isCellInRange(
          virtualRowIndex,
          colIdx,
          selectionRange,
        );
        const isInFill = isCellInFillRange(virtualRowIndex, colIdx);
        const showFillHandle = isBottomRightOfRange(
          virtualRowIndex,
          colIdx,
          selectionRange,
        );
        const isActive =
          activeCell?.rowIndex === virtualRowIndex &&
          activeCell?.colIndex === colIdx;

        return (
          <div
            key={col}
            data-col-index={colIdx}
            className={cn(
              "flex items-center px-2 text-sm border-r border-border/50 shrink-0 truncate relative",
              isEdited && "bg-primary/20",
              isRowSelected && !isEdited && "bg-primary/10",
              isRowSelected && isEdited && "bg-primary/30",
              isInSelection && "bg-blue-500/20",
              isActive && "ring-2 ring-primary ring-inset",
              isInFill && "bg-blue-500/30",
            )}
            style={{ width: getColumnWidth(col) }}
            onClick={(e) => onCellClick(e, virtualRowIndex, colIdx)}
            onMouseDown={(e) => onCellMouseDown(e, virtualRowIndex, colIdx)}
          >
            {isEditing ? (
              <input
                ref={editInputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={() => onCommitEdit()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCommitEdit("down");
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onCancelEdit();
                    gridRef.current?.focus();
                  } else if (e.key === "Tab") {
                    e.preventDefault();
                    if (e.shiftKey) {
                      onCommitEdit("left");
                    } else {
                      onCommitEdit("right");
                    }
                  }
                  e.stopPropagation();
                }}
                className="w-full h-6 px-1 bg-background border border-primary rounded text-sm focus:outline-none"
              />
            ) : (
              <>
                <span
                  className={cn(
                    "truncate flex-1",
                    isEdited && "text-primary font-medium",
                  )}
                  title={value}
                >
                  {value}
                </span>
                {/* Fill handle */}
                {showFillHandle && !editingCell && (
                  <div
                    className="absolute right-0 bottom-0 w-2 h-2 bg-primary cursor-crosshair z-20"
                    onMouseDown={onFillHandleMouseDown}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
