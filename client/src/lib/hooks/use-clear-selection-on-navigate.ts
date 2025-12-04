"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSetAtom } from "jotai";
import { clearSelectionAtom } from "@/lib/store/selection";

/**
 * Hook that clears the selection state when the route changes.
 * This prevents selected items from persisting across views,
 * which could cause confusion when the same item IDs appear in different contexts.
 */
export function useClearSelectionOnNavigate() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const clearSelection = useSetAtom(clearSelectionAtom);
  
  // Track the previous path to detect navigation
  const previousPathRef = useRef<string | null>(null);
  
  useEffect(() => {
    // Build current full path including search params
    const currentPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    
    // Skip initial render (when previousPath is null)
    if (previousPathRef.current !== null && previousPathRef.current !== currentPath) {
      // Route changed, clear selection
      clearSelection();
    }
    
    // Update the previous path
    previousPathRef.current = currentPath;
  }, [pathname, searchParams, clearSelection]);
}
