"use client";

import { useRef, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

// Debounce delay for ensureRange calls (ms) - prevents request spam during rapid scrolling
const ENSURE_RANGE_DEBOUNCE_MS = 100;

interface VirtualizedGridProps<T> {
  items: (T | undefined)[];
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
  /** Infinite scroll support (sequential pagination) */
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  /** Sparse pagination support (random-access pagination) */
  ensureRange?: (startIndex: number, endIndex: number) => void;
  /** Initial scroll offset for scroll restoration */
  initialOffset?: number;
  /** Callback when scroll position changes */
  onScrollChange?: (offset: number) => void;
  /**
   * Auto-measure the scrollMargin from container position
   * This is useful when the virtualized grid is not at the top of the scroll container
   */
  autoScrollMargin?: boolean;
  /** Index to scroll to after initial render */
  scrollToIndex?: number;
  /** Called when the first visible item index changes (for cross-view scroll restoration) */
  onFirstVisibleIndexChange?: (index: number) => void;
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
  columns = { default: 3, sm: 3, md: 4, lg: 5, xl: 6 },
  overscan = 3,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  ensureRange,
  initialOffset = 0,
  onScrollChange,
  autoScrollMargin = false,
  scrollToIndex,
  onFirstVisibleIndexChange,
}: VirtualizedGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(columns.default);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Use ref for onScrollChange to avoid recreating virtualizer options
  const onScrollChangeRef = useRef(onScrollChange);
  onScrollChangeRef.current = onScrollChange;

  // Use ref for onFirstVisibleIndexChange to avoid effect dependency changes
  const onFirstVisibleIndexChangeRef = useRef(onFirstVisibleIndexChange);
  onFirstVisibleIndexChangeRef.current = onFirstVisibleIndexChange;
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

  // Scroll to a specific item index when requested
  const hasScrolledToIndexRef = useRef(false);
  useEffect(() => {
    if (scrollToIndex == null) return;
    if (scrollToIndex < 0 || scrollToIndex >= effectiveTotalCount) return;
    if (hasScrolledToIndexRef.current) return;

    const targetRow = Math.floor(scrollToIndex / columnCount);
    const timeoutId = setTimeout(() => {
      hasScrolledToIndexRef.current = true;
      virtualizer.scrollToIndex(targetRow, { align: "start" });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [
    scrollToIndex,
    effectiveTotalCount,
    virtualizer,
    columnCount,
    scrollMargin,
  ]);

  // Report first visible item index for cross-view scroll restoration
  useEffect(() => {
    if (!onFirstVisibleIndexChangeRef.current || virtualRows.length === 0)
      return;
    const firstVisibleRow = virtualRows[0];
    if (firstVisibleRow) {
      onFirstVisibleIndexChangeRef.current(firstVisibleRow.index * columnCount);
    }
  }, [virtualRows, columnCount]);

  // Ref to track last fetch to prevent duplicate calls
  const lastFetchedRowRef = useRef<number>(-1);

  // Sparse pagination: request loading of visible item range (debounced)
  useEffect(() => {
    if (!ensureRange) return;

    const debounceTimeout = setTimeout(() => {
      const firstVirtualRow = virtualRows[0];
      const lastVirtualRow = virtualRows[virtualRows.length - 1];
      if (!firstVirtualRow || !lastVirtualRow) return;

      const startIndex = firstVirtualRow.index * columnCount;
      const endIndex = (lastVirtualRow.index + 1) * columnCount - 1;
      ensureRange(startIndex, endIndex);
    }, ENSURE_RANGE_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimeout);
  }, [ensureRange, virtualRows, columnCount]);

  // Sequential pagination: fetch more when approaching the end of loaded data
  useEffect(() => {
    if (!fetchNextPage || !hasNextPage || isFetchingNextPage || ensureRange)
      return;

    const lastVirtualRow = virtualRows[virtualRows.length - 1];
    if (!lastVirtualRow) return;

    // If we're within 5 rows of the end of loaded data, fetch more
    if (lastVirtualRow.index >= loadedRows - 5) {
      // Guard against fetching same row range multiple times
      if (lastFetchedRowRef.current >= loadedRows) return;
      lastFetchedRowRef.current = loadedRows;
      fetchNextPage();
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    virtualRows,
    loadedRows,
    ensureRange,
  ]);

  // Reset fetch ref when data changes (allows fetching more after new data arrives)
  useEffect(() => {
    if (!isFetchingNextPage) {
      // Only reset if we've loaded more than we previously fetched
      if (loadedRows > lastFetchedRowRef.current) {
        lastFetchedRowRef.current = -1;
      }
    }
  }, [loadedRows, isFetchingNextPage]);

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
                {Array.from({ length: columnCount }).map((_, colIndex) => {
                  const globalIndex = startIndex + colIndex;
                  const item = items[globalIndex];
                  // Don't render cells beyond total count
                  if (globalIndex >= effectiveTotalCount) {
                    return <div key={`empty-${rowIndex}-${colIndex}`} />;
                  }
                  // Check if item is loaded (handles both sparse and sequential pagination)
                  if (item === undefined) {
                    return (
                      <div key={`skeleton-${rowIndex}-${colIndex}`}>
                        {renderSkeleton?.(globalIndex)}
                      </div>
                    );
                  }
                  return (
                    <div key={getItemKey(item, globalIndex)}>
                      {renderItem(item, globalIndex)}
                    </div>
                  );
                })}
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
  items: (T | undefined)[];
  /** Total count of items (for scroll height when using infinite scroll) */
  totalCount?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Render skeleton for unloaded items */
  renderSkeleton?: (index: number) => React.ReactNode;
  getItemKey: (item: T, index: number) => string | number;
  estimateItemHeight?: number;
  className?: string;
  overscan?: number;
  /** Infinite scroll support (sequential pagination) */
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  /** Sparse pagination support (random-access pagination) */
  ensureRange?: (startIndex: number, endIndex: number) => void;
  /** Initial scroll offset for scroll restoration */
  initialOffset?: number;
  /** Callback when scroll position changes */
  onScrollChange?: (offset: number) => void;
  /**
   * Auto-measure the scrollMargin from container position
   * This is useful when the virtualized list is not at the top of the scroll container
   */
  autoScrollMargin?: boolean;
  /** Index to scroll to after initial render */
  scrollToIndex?: number;
  /** Called when the first visible item index changes (for cross-view scroll restoration) */
  onFirstVisibleIndexChange?: (index: number) => void;
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
  ensureRange,
  initialOffset = 0,
  onScrollChange,
  autoScrollMargin = false,
  scrollToIndex,
  onFirstVisibleIndexChange,
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

  // Use ref for onFirstVisibleIndexChange to avoid effect dependency changes
  const onFirstVisibleIndexChangeRef = useRef(onFirstVisibleIndexChange);
  onFirstVisibleIndexChangeRef.current = onFirstVisibleIndexChange;

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

  // Scroll to a specific index when requested
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (scrollToIndex == null) return;
    if (scrollToIndex < 0 || scrollToIndex >= effectiveTotalCount) return;
    if (hasScrolledRef.current) return;

    // Use setTimeout to allow layout calculations (including scroll margin
    // from ResizeObserver) to settle before scrolling
    const timeoutId = setTimeout(() => {
      hasScrolledRef.current = true;
      virtualizer.scrollToIndex(scrollToIndex, { align: "center" });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [scrollToIndex, effectiveTotalCount, virtualizer, scrollMargin]);

  // Report first visible item index for cross-view scroll restoration
  useEffect(() => {
    if (!onFirstVisibleIndexChangeRef.current || virtualItems.length === 0)
      return;
    const firstVisibleItem = virtualItems[0];
    if (firstVisibleItem) {
      onFirstVisibleIndexChangeRef.current(firstVisibleItem.index);
    }
  }, [virtualItems]);

  // Ref to track last fetch to prevent duplicate calls
  const lastFetchedIndexRef = useRef<number>(-1);

  // Sparse pagination: request loading of visible item range (debounced)
  useEffect(() => {
    if (!ensureRange) return;

    const debounceTimeout = setTimeout(() => {
      const firstVirtualItem = virtualItems[0];
      const lastVirtualItem = virtualItems[virtualItems.length - 1];
      if (!firstVirtualItem || !lastVirtualItem) return;

      ensureRange(firstVirtualItem.index, lastVirtualItem.index);
    }, ENSURE_RANGE_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimeout);
  }, [ensureRange, virtualItems]);

  // Sequential pagination: fetch more when approaching the end of loaded data
  useEffect(() => {
    if (!fetchNextPage || !hasNextPage || isFetchingNextPage || ensureRange)
      return;

    const lastVirtualItem = virtualItems[virtualItems.length - 1];
    if (!lastVirtualItem) return;

    if (lastVirtualItem.index >= items.length - 10) {
      // Guard against fetching same index range multiple times
      if (lastFetchedIndexRef.current >= items.length) return;
      lastFetchedIndexRef.current = items.length;
      fetchNextPage();
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    virtualItems,
    items.length,
    ensureRange,
  ]);

  // Reset fetch ref when data changes (allows fetching more after new data arrives)
  useEffect(() => {
    if (!isFetchingNextPage) {
      // Only reset if we've loaded more than we previously fetched
      if (items.length > lastFetchedIndexRef.current) {
        lastFetchedIndexRef.current = -1;
      }
    }
  }, [items.length, isFetchingNextPage]);

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
                // Subtract scrollMargin when using autoScrollMargin per TanStack Virtual docs
                transform: `translateY(${virtualItem.start - (autoScrollMargin ? scrollMargin : 0)}px)`,
              }}
            >
              {item !== undefined
                ? renderItem(item, virtualItem.index)
                : renderSkeleton?.(virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
