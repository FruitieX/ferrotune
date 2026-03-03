"use client";

import { useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { getClient } from "@/lib/api/client";
import {
  accountKey,
  isConnectedAtom,
  isHydratedAtom,
  serverConnectionAtom,
} from "@/lib/store/auth";
import { currentUserAtom, isCurrentUserAdminAtom } from "@/lib/store/user";

/**
 * Hook to get and manage the current user's info.
 * Automatically fetches the user when connected and updates the global state.
 */
export function useCurrentUser() {
  const isHydrated = useAtomValue(isHydratedAtom);
  const isConnected = useAtomValue(isConnectedAtom);
  const connection = useAtomValue(serverConnectionAtom);
  const [currentUser, setCurrentUser] = useAtom(currentUserAtom);
  const isAdmin = useAtomValue(isCurrentUserAdminAtom);
  const currentAccountKey = connection ? accountKey(connection) : null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["currentUser", currentAccountKey],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getCurrentUser();
    },
    enabled: isHydrated && isConnected && currentAccountKey !== null,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Update global state when data changes
  useEffect(() => {
    if (data) {
      setCurrentUser(data);
    }
  }, [data, setCurrentUser]);

  // Clear stale user info immediately when account identity changes.
  useEffect(() => {
    setCurrentUser(null);
  }, [currentAccountKey, setCurrentUser]);

  return {
    user: currentUser,
    isAdmin,
    isLoading: !isHydrated || isLoading,
    error,
  };
}
