import { useState, useEffect } from "react";

/**
 * Hook that returns whether a media query matches.
 * Returns false during SSR and initial hydration to prevent hydration mismatches.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);

    // Set initial value
    setMatches(mediaQuery.matches);

    // Listen for changes
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [query]);

  return matches;
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
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // During SSR and initial render, return false to prevent hydration issues
  if (!hasMounted) return false;

  return !isDesktop;
}
