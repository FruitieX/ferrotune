import type { CellRange } from "./types";

/**
 * Get column name by index
 * @param colIndex -1 = filePath, 0+ = orderedColumns index
 * @param orderedColumns The ordered list of column names
 */
export function getColumnByIndex(
  colIndex: number,
  orderedColumns: string[],
): string | null {
  if (colIndex === -1) return "filePath";
  if (colIndex >= 0 && colIndex < orderedColumns.length) {
    return orderedColumns[colIndex];
  }
  return null;
}

/**
 * Check if a cell is within a selection range
 */
export function isCellInRange(
  rowIndex: number,
  colIndex: number,
  range: CellRange | null,
): boolean {
  if (!range) return false;
  const rowStart = Math.min(range.start.rowIndex, range.end.rowIndex);
  const rowEnd = Math.max(range.start.rowIndex, range.end.rowIndex);
  const colStart = Math.min(range.start.colIndex, range.end.colIndex);
  const colEnd = Math.max(range.start.colIndex, range.end.colIndex);
  return (
    rowIndex >= rowStart &&
    rowIndex <= rowEnd &&
    colIndex >= colStart &&
    colIndex <= colEnd
  );
}

/**
 * Check if a cell is at the bottom-right corner of a selection range
 */
export function isBottomRightOfRange(
  rowIndex: number,
  colIndex: number,
  range: CellRange | null,
): boolean {
  if (!range) return false;
  const rowEnd = Math.max(range.start.rowIndex, range.end.rowIndex);
  const colEnd = Math.max(range.start.colIndex, range.end.colIndex);
  return rowIndex === rowEnd && colIndex === colEnd;
}

/**
 * Get the normalized bounds of a range
 */
export function getRangeBounds(range: CellRange): {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
} {
  return {
    rowStart: Math.min(range.start.rowIndex, range.end.rowIndex),
    rowEnd: Math.max(range.start.rowIndex, range.end.rowIndex),
    colStart: Math.min(range.start.colIndex, range.end.colIndex),
    colEnd: Math.max(range.start.colIndex, range.end.colIndex),
  };
}
