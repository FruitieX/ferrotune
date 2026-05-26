"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  serverConnectionAtom,
  isConnectedAtom,
  isHydratedAtom,
  isClientInitializedAtom,
  authSessionUpdateAtom,
  isSessionExpired,
  type AuthSessionUpdate,
} from "@/lib/store/auth";
import {
  clearClient,
  FerrotuneApiError,
  initializeClient,
  type FerrotuneClient,
} from "@/lib/api/client";
import { appResumeRepaintEvent } from "@/lib/utils/app-resume-repaint";

async function refreshPersistedAuthSession(
  client: FerrotuneClient,
  persistAuthSessionUpdate: (update: AuthSessionUpdate) => void,
): Promise<void> {
  const session = await client.refreshSession();
  persistAuthSessionUpdate({ sessionExpiresAt: session.sessionExpiresAt });

  const urlToken = await client.ensureUrlToken();
  if (urlToken) {
    persistAuthSessionUpdate({
      sessionExpiresAt: urlToken.sessionExpiresAt,
      urlToken: urlToken.urlToken,
      urlTokenExpiresAt: urlToken.urlTokenExpiresAt,
    });
  }
}

function isInvalidSessionError(error: unknown): boolean {
  return error instanceof FerrotuneApiError && error.status === 401;
}

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
  const [connection, setConnection] = useAtom(serverConnectionAtom);
  const setClientInitialized = useSetAtom(isClientInitializedAtom);
  const persistAuthSessionUpdate = useSetAtom(authSessionUpdateAtom);
  const [isValidatingSession, setIsValidatingSession] = useState(false);

  // Mark as hydrated after first client-side render
  useEffect(() => {
    setIsHydrated(true);
  }, [setIsHydrated]);

  // Initialize client when connection exists
  useEffect(() => {
    if (!connection) {
      clearClient();
      setClientInitialized(false);
      setIsValidatingSession(false);
      return;
    }

    const client = initializeClient(connection);
    setClientInitialized(true);
    let cancelled = false;
    let refreshInFlight = false;

    const refreshAuthSession = async (blockWhileValidating: boolean) => {
      if (!connection.sessionToken || refreshInFlight) {
        return;
      }

      refreshInFlight = true;
      if (blockWhileValidating) {
        setIsValidatingSession(true);
      }

      try {
        await refreshPersistedAuthSession(client, persistAuthSessionUpdate);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isInvalidSessionError(error)) {
          setConnection(null);
        } else {
          console.warn("Failed to refresh auth session", error);
        }
      } finally {
        refreshInFlight = false;
        if (!cancelled && blockWhileValidating) {
          setIsValidatingSession(false);
        }
      }
    };

    const blockInitialRefresh = isSessionExpired(connection);
    if (!blockInitialRefresh) {
      setIsValidatingSession(false);
    }
    void refreshAuthSession(blockInitialRefresh);

    const refreshWithoutBlocking = () => {
      void refreshAuthSession(false);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshWithoutBlocking();
      }
    };

    window.addEventListener("focus", refreshWithoutBlocking);
    window.addEventListener(appResumeRepaintEvent, refreshWithoutBlocking);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshWithoutBlocking);
      window.removeEventListener(appResumeRepaintEvent, refreshWithoutBlocking);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    connection,
    persistAuthSessionUpdate,
    setClientInitialized,
    setConnection,
  ]);

  // Redirect to login if not connected (only after hydration)
  useEffect(() => {
    if (redirectToLogin && isHydrated && !isConnected && !isValidatingSession) {
      router.push("/login");
    }
  }, [redirectToLogin, isHydrated, isConnected, isValidatingSession, router]);

  return {
    isHydrated,
    isConnected,
    connection,
    // Only consider truly connected after hydration
    isReady: isHydrated && isConnected && !isValidatingSession,
    // Show loading state before hydration or when not connected but expecting redirect
    isLoading:
      !isHydrated || isValidatingSession || (redirectToLogin && !isConnected),
  };
}
