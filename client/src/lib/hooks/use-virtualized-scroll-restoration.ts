"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Store scroll positions by route key + view mode
// Key format: "pathname:viewMode" where viewMode can be a string identifier
const scrollPositions = new Map<string, number>();

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
}

/**
 * Hook for scroll restoration with virtualized lists.
 *
 * Unlike regular scroll restoration, this works by providing an initialOffset
 * to @tanstack/react-virtual's useVirtualizer, which positions the virtual
 * list correctly before any content is rendered.
 *
 * @param containerId - ID of the scroll container element
 * @param viewMode - Optional view mode identifier (e.g., "grid" or "list").
 *                   When provided, scroll positions are stored separately per view mode,
 *                   preventing incorrect restoration when switching between different layouts.
 *
 * Usage:
 * ```tsx
 * const { getInitialOffset, saveOffset } = useVirtualizedScrollRestoration("main-scroll-container", viewMode);
 *
 * const virtualizer = useVirtualizer({
 *   count: items.length,
 *   getScrollElement: () => scrollRef.current,
 *   estimateSize: () => 50,
 *   initialOffset: getInitialOffset(),
 *   onChange: (instance) => saveOffset(instance.scrollOffset ?? 0),
 * });
 * ```
 */
export function useVirtualizedScrollRestoration(
  containerId: string = "main-scroll-container",
  viewMode?: string,
): UseVirtualizedScrollRestorationResult {
  const pathname = usePathname();
  // Include viewMode in key to store separate positions for different views
  const routeKey = viewMode ? `${pathname}:${viewMode}` : pathname;
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

  return { getInitialOffset, saveOffset };
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
