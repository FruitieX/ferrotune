"use client";

import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

interface VirtualizedHorizontalScrollProps<T> {
  items: (T | undefined)[];
  /** Total count of items (enables scroll space for unloaded items) */
  totalCount?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  renderSkeleton?: (index: number) => React.ReactNode;
  getItemKey: (item: T, index: number) => string | number;
  /** Fixed item width in pixels */
  itemWidth: number;
  /** Gap between items in pixels */
  gap?: number;
  /** Extra items to render outside viewport */
  overscan?: number;
  /** Sequential infinite scroll support */
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  /** Horizontal padding in pixels (added as paddingStart/paddingEnd) */
  paddingX?: number;
  className?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Whether section is in initial loading state (no data yet) */
  isLoading?: boolean;
}

export function VirtualizedHorizontalScroll<T>({
  items,
  totalCount,
  renderItem,
  renderSkeleton,
  getItemKey,
  itemWidth,
  gap = 16,
  overscan = 3,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  paddingX = 16,
  className,
  emptyMessage = "No items found",
  isLoading = false,
}: VirtualizedHorizontalScrollProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const effectiveTotal = totalCount ?? items.length;
  // During initial loading, show skeleton items
  const displayCount = isLoading ? 6 : effectiveTotal;

  const virtualizer = useVirtualizer({
    count: displayCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => itemWidth,
    horizontal: true,
    overscan,
    gap,
    paddingStart: paddingX,
    paddingEnd: paddingX,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Ref to track last fetch to prevent duplicate calls
  const lastFetchedRef = useRef<number>(-1);

  // Fetch more when approaching the end of loaded data
  useEffect(() => {
    if (!fetchNextPage || !hasNextPage || isFetchingNextPage) return;

    const lastVirtual = virtualItems[virtualItems.length - 1];
    if (!lastVirtual) return;

    // If we're within 3 items of the end of loaded data, fetch more
    if (lastVirtual.index >= items.length - 3) {
      if (lastFetchedRef.current >= items.length) return;
      lastFetchedRef.current = items.length;
      fetchNextPage();
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    virtualItems,
    items.length,
  ]);

  // Reset fetch ref when data arrives
  useEffect(() => {
    if (!isFetchingNextPage && items.length > lastFetchedRef.current) {
      lastFetchedRef.current = -1;
    }
  }, [items.length, isFetchingNextPage]);

  // Show empty state when loaded and no items
  if (!isLoading && effectiveTotal === 0) {
    return (
      <p className="text-muted-foreground text-sm py-8 px-3 sm:px-4 lg:px-6">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        "overflow-x-auto overflow-y-hidden scrollbar-hide",
        className,
      )}
    >
      <div
        style={{
          width: virtualizer.getTotalSize(),
          position: "relative",
          // Height: square image + card padding + text area
          height: itemWidth + 80,
        }}
      >
        {virtualItems.map((virtualItem) => {
          const index = virtualItem.index;
          const item = isLoading ? undefined : items[index];
          const key =
            item !== undefined ? getItemKey(item, index) : `skeleton-${index}`;

          return (
            <div
              key={key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: itemWidth,
                transform: `translateX(${virtualItem.start}px)`,
              }}
            >
              {item !== undefined
                ? renderItem(item, index)
                : renderSkeleton?.(index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
