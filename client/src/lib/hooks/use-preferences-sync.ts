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
import type { UserPreferences, UpdatePreferencesRequest } from "@/lib/api/types";

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
  const [customLightness, setCustomLightness] = useAtom(customAccentLightnessAtom);
  const [customChroma, setCustomChroma] = useAtom(customAccentChromaAtom);
  const setPreferencesLoaded = useSetAtom(preferencesLoadedAtom);
  
  // Track if we're currently applying server values to prevent feedback loops
  const isApplyingServerValues = useRef(false);
  // Track if we've already loaded preferences for this session
  const hasLoadedFromServer = useRef(false);

  // Query to fetch preferences from server
  const { data: serverPreferences, isSuccess } = useQuery<UserPreferences>({
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
      if (serverPreferences.customAccentHue !== undefined) {
        setCustomHue(serverPreferences.customAccentHue);
      }
      if (serverPreferences.customAccentLightness !== undefined) {
        setCustomLightness(serverPreferences.customAccentLightness);
      }
      if (serverPreferences.customAccentChroma !== undefined) {
        setCustomChroma(serverPreferences.customAccentChroma);
      }
      
      setPreferencesLoaded(true);
      
      // Reset flag after a short delay to allow React to batch updates
      setTimeout(() => {
        isApplyingServerValues.current = false;
      }, 100);
    }
  }, [isSuccess, serverPreferences, setAccentColor, setCustomHue, setCustomLightness, setCustomChroma, setPreferencesLoaded]);

  // Function to sync current preferences to server
  const syncToServer = useCallback(() => {
    if (!connection || isApplyingServerValues.current) return;
    
    updateServerPreferences({
      accentColor,
      customAccentHue: accentColor === "custom" ? customHue : undefined,
      customAccentLightness: accentColor === "custom" ? customLightness : undefined,
      customAccentChroma: accentColor === "custom" ? customChroma : undefined,
    });
  }, [connection, accentColor, customHue, customLightness, customChroma, updateServerPreferences]);

  // Reset loaded state when connection changes (user logs out/in)
  useEffect(() => {
    if (!connection) {
      hasLoadedFromServer.current = false;
      setPreferencesLoaded(false);
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
  const [customLightness, setCustomLightnessAtom] = useAtom(customAccentLightnessAtom);
  const [customChroma, setCustomChromaAtom] = useAtom(customAccentChromaAtom);
  const connection = useAtomValue(serverConnectionAtom);

  const syncToServer = useCallback(
    async (
      color: AccentColor,
      hue?: number,
      lightness?: number,
      chroma?: number
    ) => {
      const client = getClient();
      if (!client || !connection) return;

      try {
        await client.updatePreferences({
          accentColor: color,
          customAccentHue: color === "custom" ? hue : undefined,
          customAccentLightness: color === "custom" ? lightness : undefined,
          customAccentChroma: color === "custom" ? chroma : undefined,
        });
      } catch (error) {
        console.warn("Failed to sync preferences to server:", error);
      }
    },
    [connection]
  );

  const setAccentColor = useCallback(
    (color: AccentColor) => {
      setAccentColorAtom(color);
      syncToServer(color, customHue, customLightness, customChroma);
    },
    [setAccentColorAtom, syncToServer, customHue, customLightness, customChroma]
  );

  const setCustomHue = useCallback(
    (hue: number) => {
      setCustomHueAtom(hue);
      if (accentColor === "custom") {
        syncToServer("custom", hue, customLightness, customChroma);
      }
    },
    [setCustomHueAtom, accentColor, syncToServer, customLightness, customChroma]
  );

  const setCustomLightness = useCallback(
    (lightness: number) => {
      setCustomLightnessAtom(lightness);
      if (accentColor === "custom") {
        syncToServer("custom", customHue, lightness, customChroma);
      }
    },
    [setCustomLightnessAtom, accentColor, syncToServer, customHue, customChroma]
  );

  const setCustomChroma = useCallback(
    (chroma: number) => {
      setCustomChromaAtom(chroma);
      if (accentColor === "custom") {
        syncToServer("custom", customHue, customLightness, chroma);
      }
    },
    [setCustomChromaAtom, accentColor, syncToServer, customHue, customLightness]
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
