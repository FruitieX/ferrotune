import { useSyncExternalStore } from "react";

/**
 * Hook that returns whether a media query matches.
 * Returns false during SSR to prevent hydration mismatches.
 * Uses useSyncExternalStore for proper external state subscription.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (callback: () => void) => {
    const mediaQuery = window.matchMedia(query);
    mediaQuery.addEventListener("change", callback);
    return () => mediaQuery.removeEventListener("change", callback);
  };

  const getSnapshot = () => {
    return window.matchMedia(query).matches;
  };

  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Hook that returns true when viewport is desktop size (xl breakpoint: 1280px+)
 * Note: This was changed from lg (1024px) to xl (1280px) to give more space
 * for the main content area on smaller laptops/tablets when the queue sidebar is open.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1280px)");
}

/**
 * Hook that returns true when viewport is mobile/tablet size (below lg breakpoint)
 */
export function useIsMobile(): boolean {
  const isDesktop = useIsDesktop();
  return !isDesktop;
}

/**
 * Hook that returns true when viewport is below md breakpoint (768px).
 * Used for features that should only be active on small screens,
 * e.g., swipe gestures and compact now playing layout.
 */
export function useIsSmallScreen(): boolean {
  return !useMediaQuery("(min-width: 768px)");
}
