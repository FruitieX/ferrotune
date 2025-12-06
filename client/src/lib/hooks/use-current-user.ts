"use client";

import { useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { getClient } from "@/lib/api/client";
import { isConnectedAtom, isHydratedAtom } from "@/lib/store/auth";
import { currentUserAtom, isCurrentUserAdminAtom } from "@/lib/store/user";

/**
 * Hook to get and manage the current user's info.
 * Automatically fetches the user when connected and updates the global state.
 */
export function useCurrentUser() {
  const isHydrated = useAtomValue(isHydratedAtom);
  const isConnected = useAtomValue(isConnectedAtom);
  const [currentUser, setCurrentUser] = useAtom(currentUserAtom);
  const isAdmin = useAtomValue(isCurrentUserAdminAtom);

  const { data, isLoading, error } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getCurrentUser();
    },
    enabled: isHydrated && isConnected,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Update global state when data changes
  useEffect(() => {
    if (data) {
      setCurrentUser(data);
    }
  }, [data, setCurrentUser]);

  // Clear current user when disconnected
  useEffect(() => {
    if (!isConnected) {
      setCurrentUser(null);
    }
  }, [isConnected, setCurrentUser]);

  return {
    user: currentUser,
    isAdmin,
    isLoading: !isHydrated || isLoading,
    error,
  };
}
