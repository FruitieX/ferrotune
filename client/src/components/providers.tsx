"use client";

import {
  IsRestoringProvider,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type PersistQueryClientOptions,
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/react-query-persist-client";
import {
  atom,
  Provider as JotaiProvider,
  useAtomValue,
  useSetAtom,
  useStore,
} from "jotai";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { useEffect, useLayoutEffect, useRef, useState, Suspense } from "react";
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
import { useSessionOwnershipRecovery } from "@/lib/hooks/use-session-owner-state";
import { useCastInit } from "@/lib/hooks/use-cast";
import { SessionEventHandler } from "@/components/session-event-handler";
import { DynamicFavicon } from "@/components/dynamic-favicon";
import {
  getAccountPersister,
  cleanupLegacyCache,
  PERSIST_MAX_AGE_MS,
  PERSIST_GC_TIME_MS,
  PERSISTED_QUERY_CACHE_BUSTER,
  shouldPersistQuery,
} from "@/lib/query-persister";
import { cacheInit } from "@/lib/cache-store";
import {
  accentColorAtom,
  customAccentHueAtom,
  customAccentLightnessAtom,
  customAccentChromaAtom,
  fullscreenPlayerOpenAtom,
  queuePanelOpenAtom,
} from "@/lib/store/ui";
import { accountKey, serverConnectionAtom } from "@/lib/store/auth";
import { starredItemsAtom } from "@/lib/store/starred";
import { resetLocalQueueAtom } from "@/lib/store/server-queue";
import {
  bufferedAtom,
  currentTimeAtom,
  durationAtom,
  hasScrobbledAtom,
  playbackStateAtom,
} from "@/lib/store/player";
import { resetServerPreferences } from "@/lib/store/server-storage";
import { needsDarkForeground } from "@/lib/utils/color";
import { useQueueCacheSync } from "@/lib/hooks/use-queue-cache-sync";
import {
  useOfflineMode,
  useOnlineTransition,
} from "@/lib/hooks/use-offline-mode";
import { appResumeRepaintEvent } from "@/lib/utils/app-resume-repaint";

const NO_ACCOUNT_QUERY_KEY = "__no_account__";

export const cacheRestoreStateAtom = atom({
  accountKey: NO_ACCOUNT_QUERY_KEY,
  restored: false,
});

// Signals that the IndexedDB cache restore is done for the current account.
export const isCacheRestoredAtom = atom((get) => {
  const connection = get(serverConnectionAtom);
  const currentAccountKey = connection
    ? accountKey(connection)
    : NO_ACCOUNT_QUERY_KEY;
  const restoreState = get(cacheRestoreStateAtom);
  return restoreState.accountKey === currentAccountKey && restoreState.restored;
});

// Component that handles clearing selection on navigation
// Wrapped in Suspense because useSearchParams triggers Suspense on initial render
function SelectionClearer() {
  useClearSelectionOnNavigate();
  return null;
}

// Component that initializes the audio engine and media session
function AudioEngineProvider({ children }: { children: React.ReactNode }) {
  const isCacheRestored = useAtomValue(isCacheRestoredAtom);
  useOfflineLifecycle(); // Toggles isOfflineModeAtom + online-transition recovery
  useAudioEngineInit();
  useMediaSession();
  useKeyboardShortcuts();
  useDocumentTitle();
  usePreferencesSync(); // Load and sync user preferences from server
  useScanProgressStream(); // Monitor scan progress in background
  useSessionInit(); // Initialize playback session + heartbeat
  useSessionOwnershipRecovery(); // Refresh stale tab ownership on foreground
  useBackButtonClose(); // Handle Android back button to close menus
  useAppResumeRepaint(); // Force Android WebView redraws after resume
  useAppResumeRefresh(); // Invalidate queries after Android resume
  useCastInit(); // Initialize Chromecast SDK
  useQueueCacheSync(isCacheRestored); // Sync queue state ↔ React Query cache
  return (
    <>
      <SessionEventHandler />
      {children}
    </>
  );
}

/**
 * Single mount-point for offline-mode lifecycle:
 * - Listens to navigator online/offline + ping reachability probes via
 *   `useOfflineMode`.
 * - On `true → false` transition (back online after >3s offline), re-validates
 *   auth + invalidates stale React Query caches for queues/current-user only
 *   (targeted; avoids mid-test cache thrash for non-queue data).
 */
function useOfflineLifecycle() {
  useOfflineMode();

  const queryClient = useQueryClient();
  useOnlineTransition(() => {
    // Dispatch the resume event so `useAuth` re-validates the session
    // (refreshPersistedAuthSession round-trips + URL-token refresh).
    window.dispatchEvent(new Event(appResumeRepaintEvent));
    // Only invalidate the queries that genuinely need a fresh server fetch
    // after an offline window. Avoids blanket invalidation that could
    // surface stale-while-revalidate races for unrelated UI during tests.
    void queryClient
      .invalidateQueries({ queryKey: ["currentUser"] })
      .catch((err) => {
        console.warn("[offline] invalidateQueries failed", err);
      });
  });
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
  const setCacheRestoreState = useSetAtom(cacheRestoreStateAtom);
  const setQueuePanelOpen = useSetAtom(queuePanelOpenAtom);
  const setFullscreenPlayerOpen = useSetAtom(fullscreenPlayerOpenAtom);
  const resetLocalQueue = useSetAtom(resetLocalQueueAtom);
  const setPlaybackState = useSetAtom(playbackStateAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setBuffered = useSetAtom(bufferedAtom);
  const setHasScrobbled = useSetAtom(hasScrobbledAtom);

  useLayoutEffect(() => {
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
    setCacheRestoreState({
      accountKey: currentAccountKey ?? NO_ACCOUNT_QUERY_KEY,
      restored: false,
    });
    setQueuePanelOpen(false);
    setFullscreenPlayerOpen(false);
    resetLocalQueue();
    setPlaybackState("idle");
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setHasScrobbled(false);

    // Reset preference loading state; cached server preferences are scoped per
    // account and are reused immediately when switching back.
    resetServerPreferences();
  }, [
    currentAccountKey,
    setStarredItems,
    setCacheRestoreState,
    setQueuePanelOpen,
    setFullscreenPlayerOpen,
    resetLocalQueue,
    setPlaybackState,
    setCurrentTime,
    setDuration,
    setBuffered,
    setHasScrobbled,
  ]);

  return null;
}

/**
 * Creates a per-account QueryClient + IndexedDB persister.
 *
 * Each account gets its own QueryClient (keyed by accountKey) and its own
 * IndexedDB cache entry. When switching between accounts the in-memory
 * QueryClient is kept alive so switching back is instant.
 *
 * The custom persistence boundary restores whenever the account key changes
 * without remounting the app shell.
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
  const currentKey = connection ? accountKey(connection) : NO_ACCOUNT_QUERY_KEY;
  const jotaiStore = useStore();

  const queryClient = getOrCreateQueryClient(currentKey);
  const persister = getAccountPersister(currentKey);

  // Initialize LRU metadata for content-cache users. React Query persistence
  // uses an account-scoped storage adapter, so the app can stay mounted while
  // this finishes.
  useEffect(() => {
    cacheInit(currentKey);
  }, [currentKey]);

  // Initialize the offline download manager. On Tauri mobile it subscribes
  // to native download-state-changed events and asks for an initial
  // snapshot; on the web it's a no-op. Re-runs on account switch so the
  // persisted IndexedDB metadata is re-read under the new account key.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { initDownloadManager } =
          await import("@/lib/offline/download-manager");
        if (cancelled) return;
        await initDownloadManager(jotaiStore);
      } catch (err) {
        console.warn("[providers] download manager init failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentKey, jotaiStore]);

  // One-time cleanup of the legacy unified cache key
  useEffect(() => {
    cleanupLegacyCache();
  }, []);

  return (
    <AccountPersistenceBoundary
      accountKey={currentKey}
      queryClient={queryClient}
      persister={persister}
      jotaiStore={jotaiStore}
    >
      {children}
    </AccountPersistenceBoundary>
  );
}

function AccountPersistenceBoundary({
  accountKey: currentKey,
  queryClient,
  persister,
  jotaiStore,
  children,
}: {
  accountKey: string;
  queryClient: QueryClient;
  persister: ReturnType<typeof getAccountPersister>;
  jotaiStore: ReturnType<typeof useStore>;
  children: React.ReactNode;
}) {
  const [restoreStatus, setRestoreStatus] = useState({
    accountKey: currentKey,
    isRestoring: true,
  });
  const isRestoring =
    restoreStatus.accountKey !== currentKey || restoreStatus.isRestoring;

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let invalidationTimer: ReturnType<typeof setTimeout> | undefined;
    const persistOptions: PersistQueryClientOptions = {
      queryClient,
      persister,
      maxAge: PERSIST_MAX_AGE_MS,
      buster: PERSISTED_QUERY_CACHE_BUSTER,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" &&
          shouldPersistQuery(query.queryKey),
      },
    };

    setRestoreStatus({
      accountKey: currentKey,
      isRestoring: true,
    });
    jotaiStore.set(cacheRestoreStateAtom, {
      accountKey: currentKey,
      restored: false,
    });

    persistQueryClientRestore(persistOptions)
      .catch(() => {
        // Treat a failed restore as complete so the app can fetch fresh data.
      })
      .finally(() => {
        if (cancelled) return;

        jotaiStore.set(cacheRestoreStateAtom, {
          accountKey: currentKey,
          restored: true,
        });
        setRestoreStatus({
          accountKey: currentKey,
          isRestoring: false,
        });

        invalidationTimer = setTimeout(() => {
          if (cancelled) return;
          queryClient.invalidateQueries({
            predicate: (query) => shouldPersistQuery(query.queryKey),
          });
        }, 250);

        unsubscribe = persistQueryClientSubscribe(persistOptions);
      });

    return () => {
      cancelled = true;
      if (invalidationTimer) {
        clearTimeout(invalidationTimer);
      }
      unsubscribe?.();
    };
  }, [currentKey, queryClient, persister, jotaiStore]);

  return (
    <QueryClientProvider client={queryClient}>
      <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
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
