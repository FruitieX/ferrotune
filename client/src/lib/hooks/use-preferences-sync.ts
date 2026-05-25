"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { getClient } from "@/lib/api/client";
import {
  accountKey,
  serverConnectionAtom,
  isClientInitializedAtom,
} from "@/lib/store/auth";
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
  refreshServerStorageCacheAtom,
  serverPreferencesLoadedAtom,
} from "@/lib/store/server-storage";

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
  const connection = useAtomValue(serverConnectionAtom);
  const currentAccountKey = connection ? accountKey(connection) : null;
  const isClientInitialized = useAtomValue(isClientInitializedAtom);
  const setPreferencesLoaded = useSetAtom(preferencesLoadedAtom);
  const setServerPreferencesLoaded = useSetAtom(serverPreferencesLoadedAtom);
  const refreshServerStorageCache = useSetAtom(refreshServerStorageCacheAtom);

  const previousAccountKeyRef = useRef<string | null | undefined>(undefined);
  // Track if we've already loaded preferences for this session - use state so it can be read during render
  const [hasLoadedFromServer, setHasLoadedFromServer] = useState(false);

  // Load server preferences (including generic preferences) when client is initialized
  // We check isClientInitialized (not just connection) because the client singleton
  // is only set after useAuth calls initializeClient()
  useEffect(() => {
    if (!isClientInitialized || hasLoadedFromServer) return;

    let cancelled = false;

    loadServerPreferences(currentAccountKey, () => {
      if (!cancelled) {
        refreshServerStorageCache();
      }
    }).finally(() => {
      if (!cancelled) {
        setHasLoadedFromServer(true);
        setPreferencesLoaded(true);
        setServerPreferencesLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    isClientInitialized,
    currentAccountKey,
    hasLoadedFromServer,
    refreshServerStorageCache,
    setPreferencesLoaded,
    setServerPreferencesLoaded,
  ]);

  // Reset loaded state whenever account identity changes.
  useEffect(() => {
    if (previousAccountKeyRef.current === undefined) {
      previousAccountKeyRef.current = currentAccountKey;
      return;
    }

    if (previousAccountKeyRef.current === currentAccountKey) {
      return;
    }

    previousAccountKeyRef.current = currentAccountKey;
    setHasLoadedFromServer(false);
    setPreferencesLoaded(false);
    setServerPreferencesLoaded(false);
    resetServerPreferences();
    refreshServerStorageCache();
  }, [
    currentAccountKey,
    refreshServerStorageCache,
    setPreferencesLoaded,
    setServerPreferencesLoaded,
  ]);

  return {
    isLoaded: hasLoadedFromServer,
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

  const syncToServer = async (
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
        customAccentLightness: color === "custom" ? (lightness ?? null) : null,
        customAccentChroma: color === "custom" ? (chroma ?? null) : null,
      });
    } catch (error) {
      console.warn("Failed to sync preferences to server:", error);
    }
  };

  // Debounced sync for custom color changes
  const debouncedSyncCustomColor = (
    hue: number,
    lightness: number,
    chroma: number,
  ) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      syncToServer("custom", hue, lightness, chroma);
      debounceTimerRef.current = null;
    }, CUSTOM_COLOR_DEBOUNCE_MS);
  };

  const setAccentColor = (color: AccentColor) => {
    setAccentColorAtom(color);
    // Immediate sync for preset changes
    syncToServer(color, customHue, customLightness, customChroma);
  };

  const setCustomHue = (hue: number) => {
    setCustomHueAtom(hue);
    if (accentColor === "custom") {
      debouncedSyncCustomColor(hue, customLightness, customChroma);
    }
  };

  const setCustomLightness = (lightness: number) => {
    setCustomLightnessAtom(lightness);
    if (accentColor === "custom") {
      debouncedSyncCustomColor(customHue, lightness, customChroma);
    }
  };

  const setCustomChroma = (chroma: number) => {
    setCustomChromaAtom(chroma);
    if (accentColor === "custom") {
      debouncedSyncCustomColor(customHue, customLightness, chroma);
    }
  };

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
