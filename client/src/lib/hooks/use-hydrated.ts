import { useSyncExternalStore } from "react";

// Store for tracking hydration state
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Hook that returns true only after the component has mounted on the client.
 * Use this to defer rendering of components that depend on client-only state
 * (like localStorage) to prevent hydration mismatches.
 *
 * Uses useSyncExternalStore which is the React-recommended approach for
 * handling hydration state without cascading renders.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
}
