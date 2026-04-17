"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  serverConnectionAtom,
  isConnectedAtom,
  isHydratedAtom,
  isClientInitializedAtom,
} from "@/lib/store/auth";
import { clearClient, initializeClient } from "@/lib/api/client";

/**
 * Hook that handles authentication state with proper hydration handling.
 *
 * This hook:
 * 1. Waits for localStorage hydration before checking auth state
 * 2. Initializes the API client when a connection exists
 * 3. Optionally redirects to login if not authenticated
 *
 * @param options.redirectToLogin - If true, redirects to /login when not authenticated
 * @returns { isHydrated, isConnected, connection }
 */
export function useAuth(options: { redirectToLogin?: boolean } = {}) {
  const { redirectToLogin = true } = options;
  const router = useRouter();

  const [isHydrated, setIsHydrated] = useAtom(isHydratedAtom);
  const isConnected = useAtomValue(isConnectedAtom);
  const connection = useAtomValue(serverConnectionAtom);
  const setClientInitialized = useSetAtom(isClientInitializedAtom);

  // Mark as hydrated after first client-side render
  useEffect(() => {
    setIsHydrated(true);
  }, [setIsHydrated]);

  // Initialize client when connection exists
  useEffect(() => {
    if (connection) {
      initializeClient(connection);
      setClientInitialized(true);
    } else {
      clearClient();
      setClientInitialized(false);
    }
  }, [connection, setClientInitialized]);

  // Redirect to login if not connected (only after hydration)
  useEffect(() => {
    if (redirectToLogin && isHydrated && !isConnected) {
      router.push("/login");
    }
  }, [redirectToLogin, isHydrated, isConnected, router]);

  return {
    isHydrated,
    isConnected,
    connection,
    // Only consider truly connected after hydration
    isReady: isHydrated && isConnected,
    // Show loading state before hydration or when not connected but expecting redirect
    isLoading: !isHydrated || (redirectToLogin && !isConnected),
  };
}
