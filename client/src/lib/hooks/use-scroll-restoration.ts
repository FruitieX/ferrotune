"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

// Store scroll positions by route key
const scrollPositions = new Map<string, number>();

/**
 * Hook to save and restore scroll position for list pages.
 * Call this in pages that should remember their scroll position.
 *
 * Note: This hook only uses pathname for the route key to avoid
 * requiring Suspense boundaries (useSearchParams needs Suspense).
 *
 * @param containerId - The ID of the scrollable container (defaults to "main-scroll-container")
 */
export function useScrollRestoration(
  containerId: string = "main-scroll-container",
) {
  const pathname = usePathname();
  const hasRestoredRef = useRef(false);
  const attemptCountRef = useRef(0);

  // Use pathname as the route key (simpler, no Suspense needed)
  const routeKey = pathname;

  // Restore scroll position - may need multiple attempts for virtualized content
  const attemptRestoreScroll = useCallback(() => {
    const container = document.getElementById(containerId);
    if (!container) return false;

    const savedPosition = scrollPositions.get(routeKey);
    if (savedPosition === undefined || savedPosition === 0) return true; // Nothing to restore

    // Check if content is tall enough to scroll to the saved position
    const canScroll = container.scrollHeight > savedPosition;

    if (canScroll) {
      container.scrollTop = savedPosition;
      return true;
    }

    return false;
  }, [containerId, routeKey]);

  // Restore scroll position on mount - with retries for dynamic content
  useEffect(() => {
    // Only restore once per mount
    if (hasRestoredRef.current) return;

    const savedPosition = scrollPositions.get(routeKey);
    if (savedPosition === undefined || savedPosition === 0) {
      hasRestoredRef.current = true;
      return;
    }

    // Try immediately
    if (attemptRestoreScroll()) {
      hasRestoredRef.current = true;
      return;
    }

    // If immediate attempt fails, retry with exponential backoff
    // This handles virtualized content that needs time to render
    attemptCountRef.current = 0;
    const delays = [50, 100, 200, 400]; // Max ~750ms total wait

    const tryRestore = () => {
      if (attemptCountRef.current >= delays.length) {
        hasRestoredRef.current = true;
        return;
      }

      setTimeout(() => {
        if (attemptRestoreScroll()) {
          hasRestoredRef.current = true;
        } else {
          attemptCountRef.current++;
          tryRestore();
        }
      }, delays[attemptCountRef.current]);
    };

    tryRestore();
  }, [containerId, routeKey, attemptRestoreScroll]);

  // Save scroll position on unmount and during scroll
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;

    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          scrollPositions.set(routeKey, container.scrollTop);
          ticking = false;
        });
        ticking = true;
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    // Save position when component unmounts
    return () => {
      container.removeEventListener("scroll", handleScroll);
      scrollPositions.set(routeKey, container.scrollTop);
    };
  }, [containerId, routeKey]);
}

/**
 * Clear saved scroll position for a specific route.
 * Useful when you want fresh scroll on certain navigation actions.
 */
export function clearScrollPosition(routeKey: string) {
  scrollPositions.delete(routeKey);
}

/**
 * Clear all saved scroll positions.
 */
export function clearAllScrollPositions() {
  scrollPositions.clear();
}
