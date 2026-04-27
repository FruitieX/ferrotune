"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { serverConnectionAtom } from "@/lib/store/auth";
import type { SetupStatusResponse } from "@/lib/api/generated/SetupStatusResponse";

// Default backend URL for setup check
const DEFAULT_BACKEND_URL = import.meta.env.DEV ? "http://localhost:4040" : "";

/**
 * SetupGuard checks if initial setup is complete and redirects to /setup if not.
 * Excludes /setup and /login pages from the redirect to prevent loops.
 */
export function SetupGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const connection = useAtomValue(serverConnectionAtom);

  // Skip check on setup and login pages
  const shouldCheck = pathname !== "/setup" && pathname !== "/login";

  // Use stored connection URL or default backend URL
  const backendUrl = connection?.serverUrl || DEFAULT_BACKEND_URL;

  const { data: setupStatus, isError: _isError } = useQuery({
    queryKey: ["setupStatus", backendUrl],
    queryFn: async () => {
      try {
        const response = await fetch(`${backendUrl}/ferrotune/setup/status`);
        if (!response.ok) {
          // If endpoint doesn't exist (old server), assume setup is complete
          return {
            setupComplete: true,
            hasUsers: true,
            hasMusicFolders: true,
            version: "unknown",
          } as SetupStatusResponse;
        }
        return response.json() as Promise<SetupStatusResponse>;
      } catch (error) {
        // Network error or other issue - assume setup is complete to avoid blocking
        console.warn("Failed to check setup status, assuming complete:", error);
        return {
          setupComplete: true,
          hasUsers: true,
          hasMusicFolders: true,
          version: "unknown",
        } as SetupStatusResponse;
      }
    },
    enabled: shouldCheck,
    retry: false,
  });

  useEffect(() => {
    // Only redirect if we should check and setup is incomplete
    if (shouldCheck && setupStatus && !setupStatus.setupComplete) {
      router.push("/setup");
    }
  }, [shouldCheck, setupStatus, router]);

  return <>{children}</>;
}
