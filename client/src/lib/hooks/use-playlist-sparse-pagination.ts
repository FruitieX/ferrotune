"use client";

import type { PlaylistSongsResponse } from "@/lib/api/generated/PlaylistSongsResponse";
import type { PlaylistSongEntry } from "@/lib/api/generated/PlaylistSongEntry";
import { useSparsePagination } from "./use-sparse-pagination";

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
 * Thin wrapper around useSparsePagination for playlist entries.
 *
 * Adapts PlaylistSongsResponse into the generic items + metadata format
 * used by the unified sparse pagination hook, extracting PlaylistMetadata
 * from each response.
 */
export function usePlaylistSparsePagination({
  queryKey,
  pageSize,
  fetchPage,
  enabled = true,
}: PlaylistSparsePaginationConfig): PlaylistSparsePaginationResult {
  const {
    items: entries,
    totalCount,
    isLoading,
    isFetching,
    ensureRange,
    metadata,
    reset,
  } = useSparsePagination<PlaylistSongEntry, PlaylistMetadata>({
    queryKey,
    pageSize,
    fetchPage: async (offset) => {
      const response = await fetchPage(offset);
      return {
        items: response.entries,
        total: response.filteredCount,
        metadata: {
          id: response.id,
          name: response.name,
          comment: response.comment,
          owner: response.owner,
          public: response.public,
          totalEntries: response.totalEntries,
          matchedCount: response.matchedCount,
          missingCount: response.missingCount,
          duration: response.duration,
          filteredCount: response.filteredCount,
          created: response.created,
          changed: response.changed,
          coverArt: response.coverArt,
          sharedWithMe: response.sharedWithMe,
          canEdit: response.canEdit,
        },
      };
    },
    enabled,
  });

  return {
    entries,
    metadata,
    totalCount,
    isLoading,
    isFetching,
    ensureRange,
    reset,
  };
}
