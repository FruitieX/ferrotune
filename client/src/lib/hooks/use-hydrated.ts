import { useState, useEffect } from "react";

/**
 * Hook that returns true only after the component has mounted on the client.
 * Use this to defer rendering of components that depend on client-only state
 * (like localStorage) to prevent hydration mismatches.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}
