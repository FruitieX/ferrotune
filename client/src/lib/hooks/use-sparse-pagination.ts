"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getCachedPage,
  setCachedPage,
  clearCachedPages,
} from "@/lib/content-cache";

interface PendingPageRequest {
  id: number;
  pageIndexes: number[];
  forceRefresh: boolean;
}

function normalizePageIndexes(pageIndexes: number[]): number[] {
  return [...new Set(pageIndexes)].filter((pageIndex) => pageIndex >= 0);
}

/**
 * Configuration for sparse pagination
 */
export interface SparsePaginationConfig<T, TMeta = Record<string, never>> {
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
    /** Optional metadata (e.g., totalDuration) returned from each page fetch */
    metadata?: TMeta;
  }>;
  /** Whether the query is enabled */
  enabled?: boolean;
}

/**
 * Result of the sparse pagination hook
 */
export interface SparsePaginationResult<T, TMeta = Record<string, never>> {
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
  /** Refetch currently loaded pages while keeping rendered items visible */
  refresh: () => void;
  /** Additional metadata from the fetch (e.g., totalDuration) */
  metadata: TMeta | null;
  /** Reset all cached data and refetch from the beginning */
  reset: () => void;
}

/**
 * Hook for sparse pagination that only loads pages around the visible area.
 *
 * Unlike useInfiniteQuery which loads pages sequentially, this hook allows
 * jumping to any position and only loading the required pages. Previously
 * loaded pages are kept in cache.
 *
 * Pages are persisted to IndexedDB via the content cache so navigating back
 * to a previously visited view renders instantly from cache.
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
export function useSparsePagination<T, TMeta = Record<string, never>>({
  queryKey,
  pageSize,
  totalCount: initialTotalCount,
  fetchPage,
  enabled = true,
}: SparsePaginationConfig<T, TMeta>): SparsePaginationResult<T, TMeta> {
  // Track loaded pages: Map<pageIndex, T[]>
  const [pages, setPages] = useState<Map<number, T[]>>(new Map());
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const [totalCount, setTotalCount] = useState(initialTotalCount ?? 0);
  // Track metadata from the last fetch (e.g., totalDuration)
  const [metadata, setMetadata] = useState<TMeta | null>(null);
  // Track if we've completed at least one successful fetch or cache restore
  // Used to avoid showing empty state before initial data loads
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Track which pages are currently being fetched
  const fetchingPages = useRef<Set<number>>(new Set());

  // Track the next page request so cached pages can be shown first and then refreshed.
  const requestIdRef = useRef(0);
  const [pendingRequest, setPendingRequest] =
    useState<PendingPageRequest | null>(null);

  // Stable serialized query key for comparisons and IndexedDB cache key
  const serializedQueryKey = JSON.stringify(queryKey);

  // Reset when query key changes + try to restore from IndexedDB content cache
  const prevSerializedKeyRef = useRef(serializedQueryKey);
  useEffect(() => {
    const keyChanged = serializedQueryKey !== prevSerializedKeyRef.current;
    if (!keyChanged) return;

    prevSerializedKeyRef.current = serializedQueryKey;
    setPages(new Map());
    // Don't reset totalCount or metadata - keep previous values to prevent header flicker
    // They will be updated when new data arrives
    fetchingPages.current.clear();
    setPendingRequest(null);

    // Try to restore first page from content cache for instant render
    getCachedPage<T>(queryKey, 0).then((cached) => {
      if (
        cached &&
        // Ensure the query key hasn't changed again while we were reading
        JSON.stringify(queryKey) === prevSerializedKeyRef.current
      ) {
        setPages(new Map([[0, cached.items]]));
        setTotalCount(cached.total);
        if (cached.metadata) {
          setMetadata(cached.metadata as TMeta);
        }
        setHasLoadedOnce(true);
      }
      // Cached data should render first, then be replaced by fresh server data.
      requestIdRef.current += 1;
      setPendingRequest({
        id: requestIdRef.current,
        pageIndexes: [0],
        forceRefresh: true,
      });
    });
  }, [serializedQueryKey, queryKey, pageSize]);

  // Calculate which pages need to be loaded for a given range
  const getRequiredPages = (startIndex: number, endIndex: number): number[] => {
    const startPage = Math.floor(startIndex / pageSize);
    const endPage = Math.floor(endIndex / pageSize);
    const required: number[] = [];

    for (let page = startPage; page <= endPage; page++) {
      if (!pagesRef.current.has(page) && !fetchingPages.current.has(page)) {
        required.push(page);
      }
    }

    return required;
  };

  const queuePageRequest = (pageIndexes: number[], forceRefresh = false) => {
    const normalizedPageIndexes = normalizePageIndexes(pageIndexes).filter(
      (pageIndex) =>
        forceRefresh
          ? !fetchingPages.current.has(pageIndex)
          : !pagesRef.current.has(pageIndex) &&
            !fetchingPages.current.has(pageIndex),
    );

    if (normalizedPageIndexes.length === 0) {
      return;
    }

    requestIdRef.current += 1;
    setPendingRequest({
      id: requestIdRef.current,
      pageIndexes: normalizedPageIndexes,
      forceRefresh,
    });
  };

  // Primary query for fetching pending pages
  // NOTE: staleTime: 0 is critical here because our local `pages` Map is the real cache.
  // If React Query caches the result and we navigate away then back, the local state
  // gets reset but React Query returns cached data without calling queryFn, causing
  // the loading state to get stuck.
  const { isLoading: _isLoading, isFetching } = useQuery({
    queryKey: [
      ...queryKey,
      "sparse",
      pendingRequest?.forceRefresh ? "refresh" : "load",
      pendingRequest?.id ?? "idle",
    ],
    queryFn: async () => {
      if (!pendingRequest) return null;

      const request = pendingRequest;
      const requestedPages = request.pageIndexes.filter((pageIndex) =>
        request.forceRefresh
          ? !fetchingPages.current.has(pageIndex)
          : !pagesRef.current.has(pageIndex) &&
            !fetchingPages.current.has(pageIndex),
      );
      if (requestedPages.length === 0) return null;

      // Mark pages as fetching
      requestedPages.forEach((pageIndex) =>
        fetchingPages.current.add(pageIndex),
      );

      try {
        // Fetch all required pages in parallel
        const results = await Promise.all(
          requestedPages.map(async (pageIndex) => {
            const offset = pageIndex * pageSize;
            const {
              items,
              total,
              metadata: pageMeta,
            } = await fetchPage(offset);
            return { pageIndex, items, total, metadata: pageMeta };
          }),
        );

        // Update state with fetched pages
        setPages((prev) => {
          const next = new Map(prev);
          results.forEach(({ pageIndex, items }) => {
            next.set(pageIndex, items);
          });

          if (results.length > 0) {
            const nextTotal = results[0].total;
            const maxPageIndex =
              nextTotal > 0 ? Math.ceil(nextTotal / pageSize) - 1 : -1;
            for (const existingPageIndex of next.keys()) {
              if (existingPageIndex > maxPageIndex) {
                next.delete(existingPageIndex);
              }
            }
          }

          return next;
        });

        // Update total count and metadata from the first result
        if (results.length > 0) {
          setTotalCount(results[0].total);
          if (results[0].metadata) {
            setMetadata(results[0].metadata);
          }
          setHasLoadedOnce(true);
        }

        // Write fetched pages to IndexedDB content cache (fire-and-forget)
        for (const { pageIndex, items, total, metadata: pageMeta } of results) {
          void setCachedPage(queryKey, pageIndex, {
            items,
            total,
            metadata: pageMeta,
          });
        }

        return results;
      } finally {
        // Clear fetching state
        requestedPages.forEach((pageIndex) =>
          fetchingPages.current.delete(pageIndex),
        );
        setPendingRequest((current) =>
          current?.id === request.id ? null : current,
        );
      }
    },
    enabled: enabled && pendingRequest !== null,
    staleTime: 0, // Always refetch - our local `pages` Map is the real cache
    gcTime: 0, // Don't keep old results in memory
  });

  // Function to request loading of a range.
  // For pages that are not in local state, try the content cache first.
  const ensureRange = (startIndex: number, endIndex: number) => {
    // Add padding for smoother scrolling
    const padding = pageSize;
    const paddedStart = Math.max(0, startIndex - padding);
    const paddedEnd = endIndex + padding;

    const requiredPages = getRequiredPages(paddedStart, paddedEnd);
    if (requiredPages.length === 0) return;

    // Try restoring from content cache first, then fetch remaining from network
    const cachePromises = requiredPages.map(async (pageIndex) => {
      const cached = await getCachedPage<T>(queryKey, pageIndex);
      return { pageIndex, cached };
    });

    void Promise.all(cachePromises).then((results) => {
      const restored = new Map<number, T[]>();
      const stillNeeded: number[] = [];
      let restoredTotal: number | null = null;
      let restoredMeta: TMeta | null = null;

      for (const { pageIndex, cached } of results) {
        if (cached) {
          restored.set(pageIndex, cached.items);
          restoredTotal = cached.total;
          if (cached.metadata) {
            restoredMeta = cached.metadata as TMeta;
          }
        } else {
          stillNeeded.push(pageIndex);
        }
      }

      if (restored.size > 0) {
        setPages((prev) => {
          const next = new Map(prev);
          for (const [idx, items] of restored) {
            if (!next.has(idx)) {
              next.set(idx, items);
            }
          }
          return next;
        });
        if (restoredTotal !== null) {
          setTotalCount(restoredTotal);
        }
        if (restoredMeta !== null) {
          setMetadata(restoredMeta);
        }
        if (!hasLoadedOnce) {
          setHasLoadedOnce(true);
        }
      }

      // Always trigger network fetch so data stays fresh
      queuePageRequest(requiredPages, true);
    });
  };

  const refresh = () => {
    const loadedPageIndexes = normalizePageIndexes(
      Array.from(pagesRef.current.keys()),
    );
    queuePageRequest(
      loadedPageIndexes.length > 0 ? loadedPageIndexes : [0],
      true,
    );
  };

  // Reset all cached data and refetch from the beginning
  const reset = () => {
    setPages(new Map());
    // Don't reset metadata - keep previous values to prevent header flicker
    setTotalCount(0);
    setHasLoadedOnce(false);
    fetchingPages.current.clear();
    setPendingRequest(null);
    // Clear content cache for this query key
    void clearCachedPages(queryKey);
    // Trigger a refetch of the first page
    requestIdRef.current += 1;
    setPendingRequest({
      id: requestIdRef.current,
      pageIndexes: [0],
      forceRefresh: true,
    });
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

  // Load initial page when we haven't loaded any data yet
  // This triggers on mount and after query key changes (which resets hasLoadedOnce)
  useEffect(() => {
    if (enabled && !hasLoadedOnce && pages.size === 0) {
      // Try to restore from content cache before network fetch
      getCachedPage<T>(queryKey, 0).then((cached) => {
        if (
          cached &&
          JSON.stringify(queryKey) === prevSerializedKeyRef.current
        ) {
          setPages(new Map([[0, cached.items]]));
          setTotalCount(cached.total);
          if (cached.metadata) {
            setMetadata(cached.metadata as TMeta);
          }
          setHasLoadedOnce(true);
        }
        // Always trigger network fetch for fresh data
        requestIdRef.current += 1;
        setPendingRequest({
          id: requestIdRef.current,
          pageIndexes: [0],
          forceRefresh: true,
        });
      });
    }
  }, [enabled, hasLoadedOnce, pages.size, pageSize, queryKey]);

  return {
    items,
    totalCount,
    isLoading: !hasLoadedOnce,
    isFetching,
    ensureRange,
    refresh,
    metadata,
    reset,
  };
}
