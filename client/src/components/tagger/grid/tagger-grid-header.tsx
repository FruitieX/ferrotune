"use client";

import {
  Check,
  Minus,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HEADER_HEIGHT,
  CHECKBOX_WIDTH,
  COVER_ART_COLUMN_WIDTH,
  DEFAULT_TAG_COLUMN_WIDTH,
  type SortDirection,
} from "./types";

interface TaggerGridHeaderProps {
  // Column config
  orderedColumns: string[];
  fileColumnWidth: number;
  columnWidths: Record<string, number>;
  totalWidth: number;
  // Sorting
  sortColumn: string | null;
  sortDirection: SortDirection;
  onHeaderClick: (column: string) => void;
  // Selection
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: () => void;
  // Column dragging
  draggedColumn: string | null;
  onColumnDragStart: (e: React.DragEvent, column: string) => void;
  onColumnDragOver: (e: React.DragEvent, targetColumn: string) => void;
  onColumnDragEnd: (e: React.DragEvent) => void;
  // Resize
  onResizeStart: (
    e: React.MouseEvent,
    column: string,
    isFileColumn?: boolean,
  ) => void;
  // Ref for scroll sync
  headerRef: React.RefObject<HTMLDivElement | null>;
}

export function TaggerGridHeader({
  orderedColumns,
  fileColumnWidth,
  columnWidths,
  totalWidth,
  sortColumn,
  sortDirection,
  onHeaderClick,
  allSelected,
  someSelected,
  onSelectAll,
  draggedColumn,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDragEnd,
  onResizeStart,
  headerRef,
}: TaggerGridHeaderProps) {
  const getColumnWidth = (col: string) =>
    columnWidths[col] ?? DEFAULT_TAG_COLUMN_WIDTH;

  return (
    <div
      ref={headerRef}
      className="flex shrink-0 border-b border-border bg-muted/50 overflow-hidden"
      style={{ height: HEADER_HEIGHT, width: "100%" }}
    >
      <div className="flex" style={{ minWidth: totalWidth }}>
        {/* Checkbox header */}
        <div
          className="flex items-center justify-center border-r border-border shrink-0 cursor-pointer hover:bg-muted"
          style={{ width: CHECKBOX_WIDTH }}
          onClick={onSelectAll}
        >
          <div
            className={cn(
              "w-4 h-4 rounded border flex items-center justify-center",
              allSelected || someSelected
                ? "bg-primary border-primary"
                : "border-muted-foreground",
            )}
          >
            {allSelected && (
              <Check className="w-3 h-3 text-primary-foreground" />
            )}
            {someSelected && (
              <Minus className="w-3 h-3 text-primary-foreground" />
            )}
          </div>
        </div>

        {/* Cover art status column header */}
        <div
          className="flex items-center justify-center border-r border-border shrink-0"
          style={{ width: COVER_ART_COLUMN_WIDTH }}
          title="Cover Art Status"
        >
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* File column header */}
        <div
          className="flex items-center px-3 font-medium text-sm border-r border-border shrink-0 cursor-pointer hover:bg-muted/50 relative"
          style={{ width: fileColumnWidth }}
          onClick={() => onHeaderClick("filePath")}
        >
          <span className="flex-1">File</span>
          {sortColumn === "filePath" &&
            (sortDirection === "asc" ? (
              <ArrowUp className="w-3 h-3 ml-1" />
            ) : (
              <ArrowDown className="w-3 h-3 ml-1" />
            ))}
          {/* Resize handle for file column */}
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 z-10"
            onMouseDown={(e) => onResizeStart(e, "", true)}
          />
        </div>

        {/* Tag column headers */}
        {orderedColumns.map((col) => (
          <div
            key={col}
            className={cn(
              "flex items-center font-medium text-sm border-r border-border shrink-0 hover:bg-muted/50 relative group",
              draggedColumn === col && "opacity-50",
            )}
            style={{ width: getColumnWidth(col) }}
            draggable
            onDragStart={(e) => onColumnDragStart(e, col)}
            onDragOver={(e) => onColumnDragOver(e, col)}
            onDragEnd={onColumnDragEnd}
            onDragEnter={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-3 h-3 ml-1 mr-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />
            <div
              className="flex-1 truncate cursor-pointer pr-2"
              onClick={() => onHeaderClick(col)}
            >
              {col.charAt(0) + col.slice(1).toLowerCase()}
              {sortColumn === col &&
                (sortDirection === "asc" ? (
                  <ArrowUp className="w-3 h-3 ml-1 inline" />
                ) : (
                  <ArrowDown className="w-3 h-3 ml-1 inline" />
                ))}
            </div>
            {/* Resize handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 z-10"
              onMouseDown={(e) => onResizeStart(e, col)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
