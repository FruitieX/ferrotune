"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { useEffect, useRef, Suspense } from "react";
import { useAudioEngineInit, useMediaSession } from "@/lib/audio/hooks";
import { useKeyboardShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";
import { useDocumentTitle } from "@/lib/hooks/use-document-title";
import { usePreferencesSync } from "@/lib/hooks/use-preferences-sync";
import { useClearSelectionOnNavigate } from "@/lib/hooks/use-clear-selection-on-navigate";
import { useBackButtonClose } from "@/lib/hooks/use-back-button-close";
import { useAppResumeRepaint } from "@/lib/hooks/use-app-resume-repaint";
import { useAppResumeRefresh } from "@/lib/hooks/use-app-resume-refresh";
import { useScanProgressStream } from "@/lib/hooks/use-scan-progress-stream";
import { useSessionInit } from "@/lib/hooks/use-session-init";
import { useCastInit } from "@/lib/hooks/use-cast";
import { SessionEventHandler } from "@/components/session-event-handler";
import { DynamicFavicon } from "@/components/dynamic-favicon";
import {
  getAccountPersister,
  cleanupLegacyCache,
  PERSIST_MAX_AGE_MS,
  PERSIST_GC_TIME_MS,
  shouldPersistQuery,
} from "@/lib/query-persister";
import {
  accentColorAtom,
  customAccentHueAtom,
  customAccentLightnessAtom,
  customAccentChromaAtom,
  queuePanelOpenAtom,
} from "@/lib/store/ui";
import { accountKey, serverConnectionAtom } from "@/lib/store/auth";
import { starredItemsAtom } from "@/lib/store/starred";
import { waveformCacheAtom } from "@/lib/store/waveform";
import {
  resetServerPreferences,
  refreshServerPreferences,
} from "@/lib/store/server-storage";
import { needsDarkForeground } from "@/lib/utils/color";

// Component that handles clearing selection on navigation
// Wrapped in Suspense because useSearchParams triggers Suspense on initial render
function SelectionClearer() {
  useClearSelectionOnNavigate();
  return null;
}

// Component that initializes the audio engine and media session
function AudioEngineProvider({ children }: { children: React.ReactNode }) {
  useAudioEngineInit();
  useMediaSession();
  useKeyboardShortcuts();
  useDocumentTitle();
  usePreferencesSync(); // Load and sync user preferences from server
  useScanProgressStream(); // Monitor scan progress in background
  useSessionInit(); // Initialize playback session + heartbeat
  useBackButtonClose(); // Handle Android back button to close menus
  useAppResumeRepaint(); // Force Android WebView redraws after resume
  useAppResumeRefresh(); // Invalidate queries after Android resume
  useCastInit(); // Initialize Chromecast SDK
  return (
    <>
      <SessionEventHandler />
      {children}
    </>
  );
}

// Component that applies accent color
function AccentColorProvider({ children }: { children: React.ReactNode }) {
  const accentColor = useAtomValue(accentColorAtom);
  const customHue = useAtomValue(customAccentHueAtom);
  const customLightness = useAtomValue(customAccentLightnessAtom);
  const customChroma = useAtomValue(customAccentChromaAtom);

  useEffect(() => {
    const html = document.documentElement;
    // Remove any previous accent attribute
    html.removeAttribute("data-accent");

    // Clear any custom CSS variables
    html.style.removeProperty("--primary");
    html.style.removeProperty("--primary-foreground");
    html.style.removeProperty("--ring");
    html.style.removeProperty("--chart-1");
    html.style.removeProperty("--sidebar-primary");
    html.style.removeProperty("--sidebar-primary-foreground");
    html.style.removeProperty("--sidebar-ring");

    if (accentColor === "custom") {
      // Apply custom color via inline CSS variables
      const customColor = `oklch(${customLightness} ${customChroma} ${customHue})`;
      html.style.setProperty("--primary", customColor);
      html.style.setProperty("--ring", customColor);
      html.style.setProperty("--chart-1", customColor);
      html.style.setProperty("--sidebar-primary", customColor);
      html.style.setProperty("--sidebar-ring", customColor);

      // Adjust foreground color for contrast when using light custom colors
      if (needsDarkForeground(customLightness)) {
        const darkForeground = "oklch(0.1 0 0)";
        html.style.setProperty("--primary-foreground", darkForeground);
        html.style.setProperty("--sidebar-primary-foreground", darkForeground);
      }
    } else if (accentColor !== "rust") {
      // Set data attribute for preset themes (rust is the default, handled by CSS variables directly)
      html.setAttribute("data-accent", accentColor);
    }
  }, [accentColor, customHue, customLightness, customChroma]);

  return <>{children}</>;
}

/**
 * Resets user-specific Jotai atoms when the account changes.
 * Lives outside the per-account QueryClientProvider so it is NOT remounted
 * when the PersistQueryClientProvider key changes.
 */
function AccountSwitchStateResetter() {
  const connection = useAtomValue(serverConnectionAtom);
  const currentAccountKey = connection ? accountKey(connection) : null;
  const previousAccountKeyRef = useRef<string | null | undefined>(undefined);
  const setStarredItems = useSetAtom(starredItemsAtom);
  const setWaveformCache = useSetAtom(waveformCacheAtom);

  useEffect(() => {
    if (previousAccountKeyRef.current === undefined) {
      previousAccountKeyRef.current = currentAccountKey;
      return;
    }

    if (previousAccountKeyRef.current === currentAccountKey) {
      return;
    }

    previousAccountKeyRef.current = currentAccountKey;

    // Reset user-specific Jotai atoms
    setStarredItems(new Map());
    setWaveformCache(new Map());

    // Reset and reload server-stored preferences for the new account
    resetServerPreferences();
    void refreshServerPreferences();
  }, [currentAccountKey, setStarredItems, setWaveformCache]);

  return null;
}

/**
 * Creates a per-account QueryClient + IndexedDB persister.
 *
 * Each account gets its own QueryClient (keyed by accountKey) and its own
 * IndexedDB cache entry. When switching between accounts the in-memory
 * QueryClient is kept alive so switching back is instant.
 *
 * The React `key` on PersistQueryClientProvider forces a remount when the
 * account changes, which triggers a persistence restore for the new account.
 */

// Module-level map of per-account QueryClients so switching back is instant
const queryClientsByAccount = new Map<string, QueryClient>();

function getOrCreateQueryClient(key: string): QueryClient {
  let client = queryClientsByAccount.get(key);
  if (!client) {
    client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000,
          gcTime: PERSIST_GC_TIME_MS,
          refetchOnWindowFocus: false,
        },
      },
    });
    queryClientsByAccount.set(key, client);
  }
  return client;
}

function AccountScopedQueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const connection = useAtomValue(serverConnectionAtom);
  const currentKey = connection ? accountKey(connection) : "__no_account__";

  const queryClient = getOrCreateQueryClient(currentKey);
  const persister = getAccountPersister(currentKey);

  // One-time cleanup of the legacy unified cache key
  useEffect(() => {
    cleanupLegacyCache();
  }, []);

  return (
    // Outer QueryClientProvider ensures all app code resolves the same React
    // context.  pnpm strict isolation can cause PersistQueryClientProvider's
    // internal QueryClientProvider (resolved via react-query-persist-client's
    // peer dep) to use a different context object than useQueryClient() in
    // application code, breaking SSR prerendering.
    <QueryClientProvider client={queryClient}>
      <PersistQueryClientProvider
        key={currentKey}
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE_MS,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) =>
              query.state.status === "success" &&
              shouldPersistQuery(query.queryKey),
          },
        }}
        onSuccess={() => {
          // After restoring cached data from IndexedDB, trigger a
          // background refetch of all active queries so the cache gets
          // updated for the next visit.
          queryClient.invalidateQueries();
        }}
      >
        {children}
      </PersistQueryClientProvider>
    </QueryClientProvider>
  );
}

// Toaster with dynamic positioning based on queue panel state
function ResponsiveToaster() {
  const _queueOpen = useAtomValue(queuePanelOpenAtom);
  const _QUEUE_SIDEBAR_WIDTH = 360;
  const GAP_FROM_EDGE = 16;

  return (
    <Toaster
      position="bottom-right"
      richColors
      offset={100}
      style={{
        right: GAP_FROM_EDGE,
      }}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <JotaiProvider>
      <AccountSwitchStateResetter />
      <AccountScopedQueryProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={true}
          disableTransitionOnChange
        >
          <AccentColorProvider>
            <DynamicFavicon />
            <Suspense fallback={null}>
              <SelectionClearer />
            </Suspense>
            <AudioEngineProvider>{children}</AudioEngineProvider>
          </AccentColorProvider>
          <ResponsiveToaster />
        </ThemeProvider>
      </AccountScopedQueryProvider>
    </JotaiProvider>
  );
}
