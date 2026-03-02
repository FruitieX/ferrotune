"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PlaylistSongsResponse } from "@/lib/api/generated/PlaylistSongsResponse";
import type { PlaylistSongEntry } from "@/lib/api/generated/PlaylistSongEntry";

/**
 * Configuration for playlist sparse pagination
 */
export interface PlaylistSparsePaginationConfig {
  /** Unique query key for caching */
  queryKey: unknown[];
  /** Page size */
  pageSize: number;
  /** Function to fetch a page at a given offset */
  fetchPage: (offset: number) => Promise<PlaylistSongsResponse>;
  /** Whether the query is enabled */
  enabled?: boolean;
}

/**
 * Playlist metadata extracted from responses
 */
export interface PlaylistMetadata {
  id: string;
  name: string;
  comment: string | null;
  owner: string;
  public: boolean;
  totalEntries: number;
  matchedCount: number;
  missingCount: number;
  duration: number;
  filteredCount: number;
  created: string;
  changed: string;
  coverArt: string | null;
  sharedWithMe: boolean;
  canEdit: boolean;
}

/**
 * Result of the playlist sparse pagination hook
 */
export interface PlaylistSparsePaginationResult {
  /** Array of entries, with undefined for unloaded indices */
  entries: PlaylistSongEntry[];
  /** Playlist metadata (from first loaded page) */
  metadata: PlaylistMetadata | null;
  /** Total count of items (filteredCount) */
  totalCount: number;
  /** Whether initial data is loading */
  isLoading: boolean;
  /** Whether any page is currently being fetched */
  isFetching: boolean;
  /** Request loading of items in a range (called by virtualizer) */
  ensureRange: (startIndex: number, endIndex: number) => void;
  /** Reset all cached data and refetch from the beginning */
  reset: () => void;
}

/**
 * Hook for sparse pagination of playlist entries.
 *
 * Unlike useInfiniteQuery which loads pages sequentially, this hook allows
 * jumping to any position and only loading the required pages.
 */
export function usePlaylistSparsePagination({
  queryKey,
  pageSize,
  fetchPage,
  enabled = true,
}: PlaylistSparsePaginationConfig): PlaylistSparsePaginationResult {
  // Track loaded pages: Map<pageIndex, PlaylistSongEntry[]>
  const [pages, setPages] = useState<Map<number, PlaylistSongEntry[]>>(
    new Map(),
  );
  const [metadata, setMetadata] = useState<PlaylistMetadata | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  // Track if we've completed at least one successful fetch
  // Used to avoid showing empty state before initial data loads
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Track which pages are currently being fetched
  const fetchingPages = useRef<Set<number>>(new Set());

  // Counter incremented on reset() to force a new query key, preventing stale cache hits
  const [resetCounter, setResetCounter] = useState(0);

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
      // Don't reset metadata - keep previous values to prevent header flicker
      // Metadata will be updated when new data arrives
      setTotalCount(0);
      // Only reset hasLoadedOnce if we don't have any metadata yet
      // This prevents the header from showing loading state during filter changes
      if (!metadata) {
        setHasLoadedOnce(false);
      }
      fetchingPages.current.clear();
      setPendingRange(null);
    }
  }, [queryKey, metadata]);

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
  // NOTE: staleTime: 0 is critical here because our local `pages` Map is the real cache.
  // If React Query caches the result and we navigate away then back, the local state
  // gets reset but React Query returns cached data without calling queryFn, causing
  // the loading state to get stuck.
  const { isLoading: _isLoading, isFetching } = useQuery({
    queryKey: [
      ...queryKey,
      "sparse",
      pendingRange?.start,
      pendingRange?.end,
      resetCounter,
    ],
    queryFn: async () => {
      if (!pendingRange) {
        setHasLoadedOnce(true);
        return null;
      }

      const requiredPages = getRequiredPages(
        pendingRange.start,
        pendingRange.end,
      );
      if (requiredPages.length === 0) {
        setHasLoadedOnce(true);
        return null;
      }

      // Mark pages as fetching
      requiredPages.forEach((p) => fetchingPages.current.add(p));

      try {
        // Fetch all required pages in parallel
        const results = await Promise.all(
          requiredPages.map(async (pageIndex) => {
            const offset = pageIndex * pageSize;
            const response = await fetchPage(offset);
            return { pageIndex, response };
          }),
        );

        // Update state with fetched pages
        setPages((prev) => {
          const next = new Map(prev);
          results.forEach(({ pageIndex, response }) => {
            next.set(pageIndex, response.entries);
          });
          return next;
        });

        // Update metadata and total count from the first result
        if (results.length > 0) {
          const firstResponse = results[0].response;
          setTotalCount(firstResponse.filteredCount);
          setHasLoadedOnce(true);

          // Update metadata from response
          // Always update to get the current filteredCount, but keep stable fields if unchanged
          setMetadata({
            id: firstResponse.id,
            name: firstResponse.name,
            comment: firstResponse.comment,
            owner: firstResponse.owner,
            public: firstResponse.public,
            totalEntries: firstResponse.totalEntries,
            matchedCount: firstResponse.matchedCount,
            missingCount: firstResponse.missingCount,
            duration: firstResponse.duration,
            filteredCount: firstResponse.filteredCount,
            created: firstResponse.created,
            changed: firstResponse.changed,
            coverArt: firstResponse.coverArt,
            sharedWithMe: firstResponse.sharedWithMe,
            canEdit: firstResponse.canEdit,
          });
        }

        return results;
      } finally {
        // Clear fetching state
        requiredPages.forEach((p) => fetchingPages.current.delete(p));
      }
    },
    enabled: enabled && pendingRange !== null,
    staleTime: 0, // Always refetch - our local `pages` Map is the real cache
    gcTime: 0, // Don't keep old results in memory
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

  // Function to reset all cached data and refetch from the beginning
  const reset = () => {
    setPages(new Map());
    // Don't reset metadata - keep previous values to prevent header flicker
    // and avoid unmounting components guarded by playlist != null
    setTotalCount(0);
    setHasLoadedOnce(false);
    fetchingPages.current.clear();
    // Increment reset counter to change query key, ensuring a fresh fetch
    setResetCounter((c) => c + 1);
    // Trigger a refetch of the first page
    setPendingRange({ start: 0, end: pageSize - 1 });
  };

  // Build flat entries array from loaded pages
  const entries: PlaylistSongEntry[] = [];
  if (totalCount > 0) {
    // Pre-size array with undefined values
    entries.length = totalCount;

    // Fill in loaded items
    pages.forEach((pageItems, pageIndex) => {
      const startIdx = pageIndex * pageSize;
      pageItems.forEach((item, i) => {
        if (startIdx + i < totalCount) {
          entries[startIdx + i] = item;
        }
      });
    });
  }

  // Load initial page when we haven't loaded any data yet
  // This triggers on mount and after query key changes (which resets hasLoadedOnce)
  useEffect(() => {
    if (enabled && !hasLoadedOnce && pages.size === 0) {
      setPendingRange({ start: 0, end: pageSize - 1 });
    }
  }, [enabled, hasLoadedOnce, pages.size, pageSize]);

  return {
    entries,
    metadata,
    totalCount,
    isLoading: !hasLoadedOnce,
    isFetching,
    ensureRange,
    reset,
  };
}
