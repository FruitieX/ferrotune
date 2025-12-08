"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getClient } from "@/lib/api/client";
import { serverConnectionAtom } from "@/lib/store/auth";
import {
  accentColorAtom,
  customAccentHueAtom,
  customAccentLightnessAtom,
  customAccentChromaAtom,
  preferencesLoadedAtom,
  type AccentColor,
} from "@/lib/store/ui";
import {
  loadServerPreferences,
  resetServerPreferences,
  serverPreferencesLoadedAtom,
} from "@/lib/store/server-storage";
import type {
  UpdatePreferencesRequest,
  PreferencesResponse,
} from "@/lib/api/types";

// Debounce timeout for custom color changes (ms)
const CUSTOM_COLOR_DEBOUNCE_MS = 500;

/**
 * Hook that syncs user preferences between the server and local state.
 *
 * - Loads preferences from server when the user is authenticated
 * - Updates server when preferences change locally
 * - Falls back to localStorage when offline
 * - Uses React Query for caching and optimistic updates
 */
export function usePreferencesSync() {
  const queryClient = useQueryClient();
  const connection = useAtomValue(serverConnectionAtom);
  const [accentColor, setAccentColor] = useAtom(accentColorAtom);
  const [customHue, setCustomHue] = useAtom(customAccentHueAtom);
  const [customLightness, setCustomLightness] = useAtom(
    customAccentLightnessAtom,
  );
  const [customChroma, setCustomChroma] = useAtom(customAccentChromaAtom);
  const setPreferencesLoaded = useSetAtom(preferencesLoadedAtom);
  const setServerPreferencesLoaded = useSetAtom(serverPreferencesLoadedAtom);

  // Track if we're currently applying server values to prevent feedback loops
  const isApplyingServerValues = useRef(false);
  // Track if we've already loaded preferences for this session
  const hasLoadedFromServer = useRef(false);

  // Load server preferences (including generic preferences) when connected
  useEffect(() => {
    if (connection && !hasLoadedFromServer.current) {
      loadServerPreferences(() => {
        setServerPreferencesLoaded(true);
      });
    }
  }, [connection, setServerPreferencesLoaded]);

  // Query to fetch preferences from server
  const { data: serverPreferences, isSuccess } = useQuery<PreferencesResponse>({
    queryKey: ["preferences"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPreferences();
    },
    enabled: !!connection && !hasLoadedFromServer.current,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  });

  // Mutation to update preferences on server
  const { mutate: updateServerPreferences } = useMutation({
    mutationFn: async (prefs: UpdatePreferencesRequest) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.updatePreferences(prefs);
    },
    onSuccess: (data) => {
      // Update cache with new values
      queryClient.setQueryData(["preferences"], data);
    },
    onError: (error) => {
      // Silently fail - preferences are still stored locally
      console.warn("Failed to sync preferences to server:", error);
    },
  });

  // Apply server preferences to local state when loaded
  useEffect(() => {
    if (isSuccess && serverPreferences && !hasLoadedFromServer.current) {
      isApplyingServerValues.current = true;
      hasLoadedFromServer.current = true;

      if (serverPreferences.accentColor) {
        setAccentColor(serverPreferences.accentColor as AccentColor);
      }
      if (
        serverPreferences.customAccentHue !== undefined &&
        serverPreferences.customAccentHue !== null
      ) {
        setCustomHue(serverPreferences.customAccentHue);
      }
      if (
        serverPreferences.customAccentLightness !== undefined &&
        serverPreferences.customAccentLightness !== null
      ) {
        setCustomLightness(serverPreferences.customAccentLightness);
      }
      if (
        serverPreferences.customAccentChroma !== undefined &&
        serverPreferences.customAccentChroma !== null
      ) {
        setCustomChroma(serverPreferences.customAccentChroma);
      }

      setPreferencesLoaded(true);

      // Reset flag after a short delay to allow React to batch updates
      setTimeout(() => {
        isApplyingServerValues.current = false;
      }, 100);
    }
  }, [
    isSuccess,
    serverPreferences,
    setAccentColor,
    setCustomHue,
    setCustomLightness,
    setCustomChroma,
    setPreferencesLoaded,
  ]);

  // Function to sync current preferences to server
  const syncToServer = useCallback(() => {
    if (!connection || isApplyingServerValues.current) return;

    updateServerPreferences({
      accentColor,
      customAccentHue: accentColor === "custom" ? customHue : null,
      customAccentLightness: accentColor === "custom" ? customLightness : null,
      customAccentChroma: accentColor === "custom" ? customChroma : null,
    });
  }, [
    connection,
    accentColor,
    customHue,
    customLightness,
    customChroma,
    updateServerPreferences,
  ]);

  // Reset loaded state when connection changes (user logs out/in)
  useEffect(() => {
    if (!connection) {
      hasLoadedFromServer.current = false;
      setPreferencesLoaded(false);
      resetServerPreferences();
    }
  }, [connection, setPreferencesLoaded]);

  return {
    syncToServer,
    isLoaded: hasLoadedFromServer.current,
  };
}

/**
 * Hook to update accent color and sync to server
 */
export function useAccentColor() {
  const [accentColor, setAccentColorAtom] = useAtom(accentColorAtom);
  const [customHue, setCustomHueAtom] = useAtom(customAccentHueAtom);
  const [customLightness, setCustomLightnessAtom] = useAtom(
    customAccentLightnessAtom,
  );
  const [customChroma, setCustomChromaAtom] = useAtom(customAccentChromaAtom);
  const connection = useAtomValue(serverConnectionAtom);

  // Ref to track debounce timer for custom color changes
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncToServer = useCallback(
    async (
      color: AccentColor,
      hue?: number,
      lightness?: number,
      chroma?: number,
    ) => {
      const client = getClient();
      if (!client || !connection) return;

      try {
        await client.updatePreferences({
          accentColor: color,
          customAccentHue: color === "custom" ? (hue ?? null) : null,
          customAccentLightness:
            color === "custom" ? (lightness ?? null) : null,
          customAccentChroma: color === "custom" ? (chroma ?? null) : null,
        });
      } catch (error) {
        console.warn("Failed to sync preferences to server:", error);
      }
    },
    [connection],
  );

  // Debounced sync for custom color changes
  const debouncedSyncCustomColor = useCallback(
    (hue: number, lightness: number, chroma: number) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        syncToServer("custom", hue, lightness, chroma);
        debounceTimerRef.current = null;
      }, CUSTOM_COLOR_DEBOUNCE_MS);
    },
    [syncToServer],
  );

  const setAccentColor = useCallback(
    (color: AccentColor) => {
      setAccentColorAtom(color);
      // Immediate sync for preset changes
      syncToServer(color, customHue, customLightness, customChroma);
    },
    [
      setAccentColorAtom,
      syncToServer,
      customHue,
      customLightness,
      customChroma,
    ],
  );

  const setCustomHue = useCallback(
    (hue: number) => {
      setCustomHueAtom(hue);
      if (accentColor === "custom") {
        debouncedSyncCustomColor(hue, customLightness, customChroma);
      }
    },
    [
      setCustomHueAtom,
      accentColor,
      debouncedSyncCustomColor,
      customLightness,
      customChroma,
    ],
  );

  const setCustomLightness = useCallback(
    (lightness: number) => {
      setCustomLightnessAtom(lightness);
      if (accentColor === "custom") {
        debouncedSyncCustomColor(customHue, lightness, customChroma);
      }
    },
    [
      setCustomLightnessAtom,
      accentColor,
      debouncedSyncCustomColor,
      customHue,
      customChroma,
    ],
  );

  const setCustomChroma = useCallback(
    (chroma: number) => {
      setCustomChromaAtom(chroma);
      if (accentColor === "custom") {
        debouncedSyncCustomColor(customHue, customLightness, chroma);
      }
    },
    [
      setCustomChromaAtom,
      accentColor,
      debouncedSyncCustomColor,
      customHue,
      customLightness,
    ],
  );

  return {
    accentColor,
    customHue,
    customLightness,
    customChroma,
    setAccentColor,
    setCustomHue,
    setCustomLightness,
    setCustomChroma,
  };
}
