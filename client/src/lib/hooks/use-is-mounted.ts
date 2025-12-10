"use client";

import { useSyncExternalStore } from "react";

// Store for tracking mount state
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Hook that returns true after the component has mounted on the client.
 *
 * This is useful for preventing hydration mismatches in Next.js when
 * you need to render different content on the server vs client.
 *
 * Uses useSyncExternalStore which is the React-recommended approach for
 * handling mount state without cascading renders.
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
  return useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
}
