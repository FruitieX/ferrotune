"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

/**
 * Configuration for sparse pagination
 */
export interface SparsePaginationConfig<T> {
  /** Unique query key for caching */
  queryKey: unknown[];
  /** Page size */
  pageSize: number;
  /** Total count of items (if known) */
  totalCount?: number;
  /** Function to fetch a page at a given offset */
  fetchPage: (offset: number) => Promise<{
    items: T[];
    total: number;
  }>;
  /** Whether the query is enabled */
  enabled?: boolean;
  /** Stale time for cache */
  staleTime?: number;
}

/**
 * Result of the sparse pagination hook
 */
export interface SparsePaginationResult<T> {
  /** Array of items, with undefined for unloaded indices */
  items: T[];
  /** Total count of items */
  totalCount: number;
  /** Whether initial data is loading */
  isLoading: boolean;
  /** Whether any page is currently being fetched */
  isFetching: boolean;
  /** Request loading of items in a range (called by virtualizer) */
  ensureRange: (startIndex: number, endIndex: number) => void;
}

/**
 * Hook for sparse pagination that only loads pages around the visible area.
 *
 * Unlike useInfiniteQuery which loads pages sequentially, this hook allows
 * jumping to any position and only loading the required pages. Previously
 * loaded pages are kept in cache.
 *
 * Usage:
 * ```tsx
 * const { items, totalCount, ensureRange } = useSparsePagination({
 *   queryKey: ['songs', filter],
 *   pageSize: 50,
 *   fetchPage: async (offset) => {
 *     const response = await api.getSongs({ offset, limit: 50 });
 *     return { items: response.songs, total: response.total };
 *   },
 * });
 *
 * // In virtualizer effect:
 * useEffect(() => {
 *   const firstVisible = virtualItems[0]?.index ?? 0;
 *   const lastVisible = virtualItems[virtualItems.length - 1]?.index ?? 0;
 *   ensureRange(firstVisible, lastVisible);
 * }, [virtualItems, ensureRange]);
 * ```
 */
export function useSparsePagination<T>({
  queryKey,
  pageSize,
  totalCount: initialTotalCount,
  fetchPage,
  enabled = true,
  staleTime = 60 * 1000,
}: SparsePaginationConfig<T>): SparsePaginationResult<T> {
  // Track loaded pages: Map<pageIndex, T[]>
  const [pages, setPages] = useState<Map<number, T[]>>(new Map());
  const [totalCount, setTotalCount] = useState(initialTotalCount ?? 0);

  // Track which pages are currently being fetched
  const fetchingPages = useRef<Set<number>>(new Set());

  // Track range that needs to be loaded
  const [pendingRange, setPendingRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Reset when query key changes
  const queryKeyRef = useRef(queryKey);
  useEffect(() => {
    const keyChanged =
      JSON.stringify(queryKey) !== JSON.stringify(queryKeyRef.current);
    if (keyChanged) {
      queryKeyRef.current = queryKey;
      setPages(new Map());
      setTotalCount(initialTotalCount ?? 0);
      fetchingPages.current.clear();
      // Reset pendingRange so initial page load effect will trigger
      setPendingRange(null);
    }
  }, [queryKey, initialTotalCount]);

  // Calculate which pages need to be loaded for a given range
  const getRequiredPages = (startIndex: number, endIndex: number): number[] => {
    const startPage = Math.floor(startIndex / pageSize);
    const endPage = Math.floor(endIndex / pageSize);
    const required: number[] = [];

    for (let page = startPage; page <= endPage; page++) {
      if (!pages.has(page) && !fetchingPages.current.has(page)) {
        required.push(page);
      }
    }

    return required;
  };

  // Primary query for fetching pending pages
  const { isLoading, isFetching } = useQuery({
    queryKey: [...queryKey, "sparse", pendingRange?.start, pendingRange?.end],
    queryFn: async () => {
      if (!pendingRange) return null;

      const requiredPages = getRequiredPages(
        pendingRange.start,
        pendingRange.end,
      );
      if (requiredPages.length === 0) return null;

      // Mark pages as fetching
      requiredPages.forEach((p) => fetchingPages.current.add(p));

      try {
        // Fetch all required pages in parallel
        const results = await Promise.all(
          requiredPages.map(async (pageIndex) => {
            const offset = pageIndex * pageSize;
            const { items, total } = await fetchPage(offset);
            return { pageIndex, items, total };
          }),
        );

        // Update state with fetched pages
        setPages((prev) => {
          const next = new Map(prev);
          results.forEach(({ pageIndex, items }) => {
            next.set(pageIndex, items);
          });
          return next;
        });

        // Update total count from the first result
        if (results.length > 0) {
          setTotalCount(results[0].total);
        }

        return results;
      } finally {
        // Clear fetching state
        requiredPages.forEach((p) => fetchingPages.current.delete(p));
      }
    },
    enabled: enabled && pendingRange !== null,
    staleTime,
  });

  // Function to request loading of a range
  const ensureRange = (startIndex: number, endIndex: number) => {
    // Add padding for smoother scrolling
    const padding = pageSize;
    const paddedStart = Math.max(0, startIndex - padding);
    const paddedEnd = endIndex + padding;

    const requiredPages = getRequiredPages(paddedStart, paddedEnd);
    if (requiredPages.length > 0) {
      setPendingRange({ start: paddedStart, end: paddedEnd });
    }
  };

  // Build flat items array from loaded pages
  const items: T[] = [];
  if (totalCount > 0) {
    // Pre-size array with undefined values
    items.length = totalCount;

    // Fill in loaded items
    pages.forEach((pageItems, pageIndex) => {
      const startIdx = pageIndex * pageSize;
      pageItems.forEach((item, i) => {
        if (startIdx + i < totalCount) {
          items[startIdx + i] = item;
        }
      });
    });
  }

  // Load initial page if nothing loaded yet
  useEffect(() => {
    if (enabled && pages.size === 0 && !isLoading && !pendingRange) {
      setPendingRange({ start: 0, end: pageSize - 1 });
    }
  }, [enabled, pages.size, isLoading, pendingRange, pageSize]);

  return {
    items,
    totalCount,
    isLoading: isLoading && pages.size === 0,
    isFetching,
    ensureRange,
  };
}
