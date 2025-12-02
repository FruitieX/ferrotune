"use client";

import { useState, useEffect } from "react";

/**
 * Hook that returns true after the component has mounted on the client.
 * 
 * This is useful for preventing hydration mismatches in Next.js when
 * you need to render different content on the server vs client.
 * 
 * The hook always returns false on the first render (matching SSR),
 * then true after the useEffect runs (client-side only).
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isMounted = useIsMounted();
 *   
 *   if (!isMounted) {
 *     return <Skeleton />;
 *   }
 *   
 *   return <ActualContent />;
 * }
 * ```
 */
export function useIsMounted(): boolean {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return isMounted;
}
