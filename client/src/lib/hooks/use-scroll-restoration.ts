"use client";

import { useEffect, useRef } from "react";
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
export function useScrollRestoration(containerId: string = "main-scroll-container") {
  const pathname = usePathname();
  const hasRestoredRef = useRef(false);
  
  // Use pathname as the route key (simpler, no Suspense needed)
  const routeKey = pathname;
  
  // Restore scroll position on mount
  useEffect(() => {
    // Only restore once per mount
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const savedPosition = scrollPositions.get(routeKey);
    if (savedPosition !== undefined) {
      // Use requestAnimationFrame to ensure the DOM has rendered
      requestAnimationFrame(() => {
        container.scrollTop = savedPosition;
      });
    }
  }, [containerId, routeKey]);
  
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
