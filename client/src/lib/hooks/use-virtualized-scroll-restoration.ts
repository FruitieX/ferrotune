"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Store scroll positions by route key + view mode
// Key format: "pathname:viewMode" where viewMode can be a string identifier
const scrollPositions = new Map<string, number>();

// Store first visible item index by route (shared across view modes)
// This allows cross-view scroll restoration when toggling between grid/list
const firstVisibleIndices = new Map<string, number>();

interface UseVirtualizedScrollRestorationResult {
  /**
   * Get the initial scroll offset for the virtualizer.
   * Call this when creating the virtualizer to restore scroll position.
   */
  getInitialOffset: () => number;

  /**
   * Save the current scroll offset.
   * Call this from the virtualizer's onChange callback.
   */
  saveOffset: (offset: number) => void;

  /**
   * Get the item index to scroll to when switching view modes.
   * Returns undefined if there's already a saved offset for the current view mode
   * (i.e., when navigating back to a previously visited view, not when switching views).
   */
  getScrollToIndex: () => number | undefined;

  /**
   * Save the first visible item index (shared across view modes).
   * Call this from VirtualizedGrid/VirtualizedList's onFirstVisibleIndexChange.
   */
  saveFirstVisibleIndex: (index: number) => void;
}

/**
 * Hook for scroll restoration with virtualized lists.
 *
 * Unlike regular scroll restoration, this works by providing an initialOffset
 * to @tanstack/react-virtual's useVirtualizer, which positions the virtual
 * list correctly before any content is rendered.
 *
 * When switching between view modes (grid/list), pixel offsets don't translate
 * correctly. This hook also tracks the first visible item index so the new
 * view can scroll to the same item via scrollToIndex.
 *
 * @param containerId - ID of the scroll container element
 * @param viewMode - Optional view mode identifier (e.g., "grid" or "list").
 *                   When provided, scroll positions are stored separately per view mode,
 *                   preventing incorrect restoration when switching between different layouts.
 *
 * Usage:
 * ```tsx
 * const { getInitialOffset, saveOffset, getScrollToIndex, saveFirstVisibleIndex } =
 *   useVirtualizedScrollRestoration("main-scroll-container", viewMode);
 *
 * <VirtualizedGrid
 *   initialOffset={getInitialOffset()}
 *   onScrollChange={saveOffset}
 *   scrollToIndex={getScrollToIndex()}
 *   onFirstVisibleIndexChange={saveFirstVisibleIndex}
 * />
 * ```
 */
export function useVirtualizedScrollRestoration(
  containerId: string = "main-scroll-container",
  viewMode?: string,
): UseVirtualizedScrollRestorationResult {
  const pathname = usePathname();
  // Include viewMode in key to store separate positions for different views
  const routeKey = viewMode ? `${pathname}:${viewMode}` : pathname;
  // Route key without view mode for cross-view first visible index
  const baseRouteKey = pathname;
  const lastSavedOffsetRef = useRef<number>(0);

  // Get the initial offset for the virtualizer
  const getInitialOffset = () => {
    return scrollPositions.get(routeKey) ?? 0;
  };

  // Save the scroll offset - debounced via requestAnimationFrame
  const saveOffset = (offset: number) => {
    // Avoid redundant saves
    if (offset === lastSavedOffsetRef.current) return;
    lastSavedOffsetRef.current = offset;
    scrollPositions.set(routeKey, offset);
  };

  // Get scroll-to index for cross-view restoration
  // Only returns a value when there's no saved offset for the current view mode
  // (meaning we're switching TO this view mode for the first time or after a view toggle)
  const getScrollToIndex = () => {
    const hasSavedOffset = scrollPositions.has(routeKey);
    if (hasSavedOffset) return undefined;
    return firstVisibleIndices.get(baseRouteKey);
  };

  // Save the first visible item index (shared across view modes)
  const saveFirstVisibleIndex = (index: number) => {
    firstVisibleIndices.set(baseRouteKey, index);
  };

  // Also sync the actual scroll container position on route changes
  // This handles the case where the virtualizer sets scrollOffset but
  // the container needs to be scrolled accordingly
  useEffect(() => {
    const savedOffset = scrollPositions.get(routeKey);
    if (savedOffset && savedOffset > 0) {
      const container = document.getElementById(containerId);
      if (container) {
        // Use requestAnimationFrame to ensure the DOM is ready
        requestAnimationFrame(() => {
          container.scrollTop = savedOffset;
        });
      }
    }
  }, [routeKey, containerId]);

  // Clear the saved offset for the current view mode when switching views
  // so getScrollToIndex returns the cross-view index next time
  const prevRouteKeyRef = useRef(routeKey);
  useEffect(() => {
    if (prevRouteKeyRef.current !== routeKey && viewMode) {
      // View mode changed — clear the saved offset for the NEW view mode
      // so we use scrollToIndex instead of initialOffset
      scrollPositions.delete(routeKey);
    }
    prevRouteKeyRef.current = routeKey;
  }, [routeKey, viewMode]);

  return {
    getInitialOffset,
    saveOffset,
    getScrollToIndex,
    saveFirstVisibleIndex,
  };
}

/**
 * Clear saved scroll position for a specific route.
 */
export function clearVirtualizedScrollPosition(routeKey: string) {
  scrollPositions.delete(routeKey);
}

/**
 * Clear all saved virtualized scroll positions.
 */
export function clearAllVirtualizedScrollPositions() {
  scrollPositions.clear();
}
