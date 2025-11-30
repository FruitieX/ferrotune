"use client";

import { useRef, useCallback, useMemo, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

interface VirtualizedGridProps<T> {
  items: T[];
  /** Total count of items (for scroll height when using infinite scroll) */
  totalCount?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Render skeleton for unloaded items */
  renderSkeleton?: (index: number) => React.ReactNode;
  getItemKey: (item: T, index: number) => string | number;
  estimateItemHeight?: number;
  gap?: number;
  className?: string;
  /** Number of columns at different breakpoints */
  columns?: {
    default: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  /** Extra items to render outside viewport for smoother scrolling */
  overscan?: number;
  /** Infinite scroll support */
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
}

export function VirtualizedGrid<T>({
  items,
  totalCount,
  renderItem,
  renderSkeleton,
  getItemKey,
  estimateItemHeight = 280,
  gap = 16,
  className,
  columns = { default: 2, sm: 3, md: 4, lg: 5, xl: 6 },
  overscan = 3,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
}: VirtualizedGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(columns.default);

  // Calculate current column count based on container width
  const getColumnCount = useCallback((width: number) => {
    if (width >= 1280 && columns.xl) return columns.xl;
    if (width >= 1024 && columns.lg) return columns.lg;
    if (width >= 768 && columns.md) return columns.md;
    if (width >= 640 && columns.sm) return columns.sm;
    return columns.default;
  }, [columns]);

  // Update column count on resize
  useEffect(() => {
    const updateColumns = () => {
      if (containerRef.current) {
        setColumnCount(getColumnCount(containerRef.current.offsetWidth));
      }
    };
    
    updateColumns();
    
    const resizeObserver = new ResizeObserver(updateColumns);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => resizeObserver.disconnect();
  }, [getColumnCount]);

  // Calculate total rows
  const effectiveTotalCount = totalCount ?? items.length;
  const totalRows = Math.ceil(effectiveTotalCount / columnCount);
  const loadedRows = Math.ceil(items.length / columnCount);

  // Get scroll element (main content area)
  const getScrollElement = useCallback(() => {
    return document.getElementById("main-scroll-container");
  }, []);

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement,
    estimateSize: () => estimateItemHeight,
    overscan,
    gap,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Fetch more when approaching the end of loaded data
  useEffect(() => {
    if (!fetchNextPage || !hasNextPage || isFetchingNextPage) return;
    
    const lastVirtualRow = virtualRows[virtualRows.length - 1];
    if (!lastVirtualRow) return;

    // If we're within 5 rows of the end of loaded data, fetch more
    if (lastVirtualRow.index >= loadedRows - 5) {
      fetchNextPage();
    }
  }, [virtualRows, loadedRows, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div ref={containerRef} className={cn("w-full", className)}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualRows.map((virtualRow) => {
          const rowIndex = virtualRow.index;
          const startIndex = rowIndex * columnCount;
          const rowItems = items.slice(startIndex, startIndex + columnCount);
          const isLoadedRow = startIndex < items.length;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                  columnGap: `${gap}px`,
                }}
              >
                {isLoadedRow ? (
                  <>
                    {rowItems.map((item, colIndex) => {
                      const globalIndex = startIndex + colIndex;
                      return (
                        <div key={getItemKey(item, globalIndex)}>
                          {renderItem(item, globalIndex)}
                        </div>
                      );
                    })}
                    {/* Fill empty cells in partially filled rows */}
                    {rowItems.length < columnCount &&
                      Array.from({ length: columnCount - rowItems.length }).map((_, i) => (
                        <div key={`empty-${rowIndex}-${i}`} />
                      ))}
                  </>
                ) : renderSkeleton ? (
                  // Render skeleton placeholders for unloaded rows
                  Array.from({ length: columnCount }).map((_, i) => (
                    <div key={`skeleton-${rowIndex}-${i}`}>
                      {renderSkeleton(startIndex + i)}
                    </div>
                  ))
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Virtualized list for compact/list view
interface VirtualizedListProps<T> {
  items: T[];
  /** Total count of items (for scroll height when using infinite scroll) */
  totalCount?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Render skeleton for unloaded items */
  renderSkeleton?: (index: number) => React.ReactNode;
  getItemKey: (item: T, index: number) => string | number;
  estimateItemHeight?: number;
  className?: string;
  overscan?: number;
  /** Infinite scroll support */
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
}

export function VirtualizedList<T>({
  items,
  totalCount,
  renderItem,
  renderSkeleton,
  getItemKey,
  estimateItemHeight = 56,
  className,
  overscan = 10,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
}: VirtualizedListProps<T>) {
  // Get scroll element (main content area)
  const getScrollElement = useCallback(() => {
    return document.getElementById("main-scroll-container");
  }, []);

  const effectiveTotalCount = totalCount ?? items.length;

  const virtualizer = useVirtualizer({
    count: effectiveTotalCount,
    getScrollElement,
    estimateSize: () => estimateItemHeight,
    overscan,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Fetch more when approaching the end of loaded data
  useEffect(() => {
    if (!fetchNextPage || !hasNextPage || isFetchingNextPage) return;
    
    const lastVirtualItem = virtualItems[virtualItems.length - 1];
    if (!lastVirtualItem) return;

    if (lastVirtualItem.index >= items.length - 10) {
      fetchNextPage();
    }
  }, [virtualItems, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className={cn("w-full", className)}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          const isLoaded = virtualItem.index < items.length;

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {isLoaded 
                ? renderItem(item, virtualItem.index) 
                : renderSkeleton?.(virtualItem.index)
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}
