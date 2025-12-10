"use client";

import { useRef, useEffect, useState } from "react";
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
  /** Initial scroll offset for scroll restoration */
  initialOffset?: number;
  /** Callback when scroll position changes */
  onScrollChange?: (offset: number) => void;
  /**
   * Auto-measure the scrollMargin from container position
   * This is useful when the virtualized grid is not at the top of the scroll container
   */
  autoScrollMargin?: boolean;
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
  initialOffset = 0,
  onScrollChange,
  autoScrollMargin = false,
}: VirtualizedGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(columns.default);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Use ref for onScrollChange to avoid recreating virtualizer options
  const onScrollChangeRef = useRef(onScrollChange);
  onScrollChangeRef.current = onScrollChange;

  // Get scroll element (main content area) - stored in ref for stability
  const getScrollElement = () => {
    return document.getElementById("main-scroll-container");
  };

  // Update column count and scroll margin on resize
  useEffect(() => {
    // Calculate current column count based on container width
    const getColumnCount = (width: number) => {
      if (width >= 1280 && columns.xl) return columns.xl;
      if (width >= 1024 && columns.lg) return columns.lg;
      if (width >= 768 && columns.md) return columns.md;
      if (width >= 640 && columns.sm) return columns.sm;
      return columns.default;
    };

    const updateLayout = () => {
      if (containerRef.current) {
        setColumnCount(getColumnCount(containerRef.current.offsetWidth));

        // Update scroll margin if autoScrollMargin is enabled
        if (autoScrollMargin) {
          const scrollElement = getScrollElement();
          if (scrollElement) {
            const scrollRect = scrollElement.getBoundingClientRect();
            const containerRect = containerRef.current.getBoundingClientRect();
            const margin =
              containerRect.top - scrollRect.top + scrollElement.scrollTop;
            setScrollMargin(margin);
          }
        }
      }
    };

    updateLayout();

    const resizeObserver = new ResizeObserver(updateLayout);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);

      // Also observe parent elements that might change size
      if (autoScrollMargin) {
        let parent = containerRef.current.parentElement;
        while (parent && parent !== document.body) {
          resizeObserver.observe(parent);
          parent = parent.parentElement;
        }
      }
    }

    return () => resizeObserver.disconnect();
  }, [autoScrollMargin, columns]);

  // Calculate total rows
  const effectiveTotalCount = totalCount ?? items.length;
  const totalRows = Math.ceil(effectiveTotalCount / columnCount);
  const loadedRows = Math.ceil(items.length / columnCount);

  // Calculate dynamic estimate based on container and column count
  // This accounts for aspect-square images + padding + text
  const getDynamicEstimate = () => {
    if (!containerRef.current) return estimateItemHeight;
    const containerWidth = containerRef.current.offsetWidth;
    const totalGap = (columnCount - 1) * gap;
    const columnWidth = (containerWidth - totalGap) / columnCount;
    // Column width + top padding (16) + margin below image (16) + text area (~56) + bottom padding (16)
    return columnWidth + 16 + 16 + 56 + 16;
  };

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement,
    estimateSize: getDynamicEstimate,
    overscan,
    gap,
    initialOffset,
    scrollMargin: autoScrollMargin ? scrollMargin : 0,
    onChange: (instance) => {
      if (onScrollChangeRef.current && instance.scrollOffset !== null) {
        onScrollChangeRef.current(instance.scrollOffset);
      }
    },
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
                // Subtract scrollMargin when using autoScrollMargin per TanStack Virtual docs
                transform: `translateY(${virtualRow.start - (autoScrollMargin ? scrollMargin : 0)}px)`,
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
                      Array.from({ length: columnCount - rowItems.length }).map(
                        (_, i) => <div key={`empty-${rowIndex}-${i}`} />,
                      )}
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
  /** Initial scroll offset for scroll restoration */
  initialOffset?: number;
  /** Callback when scroll position changes */
  onScrollChange?: (offset: number) => void;
  /**
   * Auto-measure the scrollMargin from container position
   * This is useful when the virtualized list is not at the top of the scroll container
   */
  autoScrollMargin?: boolean;
}

export function VirtualizedList<T>({
  items,
  totalCount,
  renderItem,
  renderSkeleton,
  getItemKey: _getItemKey,
  estimateItemHeight = 56,
  className,
  overscan = 10,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  initialOffset = 0,
  onScrollChange,
  autoScrollMargin = false,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Get scroll element (main content area) - stored in ref for stability
  const getScrollElementRef = useRef(() => {
    return document.getElementById("main-scroll-container");
  });

  // Use ref for onScrollChange to avoid recreating virtualizer options
  const onScrollChangeRef = useRef(onScrollChange);
  onScrollChangeRef.current = onScrollChange;

  // Measure scroll margin when autoScrollMargin is enabled
  useEffect(() => {
    if (!autoScrollMargin || !containerRef.current) return;

    const updateScrollMargin = () => {
      const scrollElement = getScrollElementRef.current();
      if (!scrollElement || !containerRef.current) return;

      const scrollRect = scrollElement.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      // Calculate how far the container is from the top of the scroll element
      const margin =
        containerRect.top - scrollRect.top + scrollElement.scrollTop;
      setScrollMargin(margin);
    };

    updateScrollMargin();

    // Update on resize
    const resizeObserver = new ResizeObserver(updateScrollMargin);
    resizeObserver.observe(containerRef.current);

    // Also observe parent elements that might change size
    let parent = containerRef.current.parentElement;
    while (parent && parent !== document.body) {
      resizeObserver.observe(parent);
      parent = parent.parentElement;
    }

    return () => resizeObserver.disconnect();
  }, [autoScrollMargin]);

  const effectiveTotalCount = totalCount ?? items.length;

  const virtualizer = useVirtualizer({
    count: effectiveTotalCount,
    getScrollElement: getScrollElementRef.current,
    estimateSize: () => estimateItemHeight,
    overscan,
    initialOffset,
    scrollMargin: autoScrollMargin ? scrollMargin : 0,
    onChange: (instance) => {
      if (onScrollChangeRef.current && instance.scrollOffset !== null) {
        onScrollChangeRef.current(instance.scrollOffset);
      }
    },
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
  }, [
    virtualItems,
    items.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  return (
    <div ref={containerRef} className={cn("w-full", className)}>
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
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: estimateItemHeight,
                // Subtract scrollMargin when using autoScrollMargin per TanStack Virtual docs
                transform: `translateY(${virtualItem.start - (autoScrollMargin ? scrollMargin : 0)}px)`,
              }}
            >
              {isLoaded
                ? renderItem(item, virtualItem.index)
                : renderSkeleton?.(virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
