"use client";

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { ClientResponse } from "@/lib/api/generated/ClientResponse";
import { isTauriMobile } from "@/lib/tauri";
import { accountKey, serverConnectionAtom } from "./auth";

const CLIENT_ID_STORAGE_KEY = "ferrotune-client-id";
const MOBILE_CLIENT_ID_STORAGE_KEY = "ferrotune-mobile-client-id";
const CLIENT_TAB_INSTANCE_STORAGE_KEY = "ferrotune-client-tab-instance-id";
const ACTIVE_CLIENT_TAB_STORAGE_PREFIX = "ferrotune-active-client-tab:";
const ACTIVE_CLIENT_TAB_REFRESH_MS = 5_000;

interface ActiveClientTabMarker {
  clientId: string;
  pageInstanceId: string;
  updatedAt: number;
}

const pageInstanceId =
  typeof crypto !== "undefined"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

let activeClientTab: { tabInstanceId: string; clientId: string } | null = null;
let activeClientTabRefreshInterval: ReturnType<typeof setInterval> | null =
  null;
let activeClientTabListenersInstalled = false;

function parseStoredString(value: string | null): string | null {
  if (!value || value === '""' || value === "null") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function readSessionString(key: string): string | null {
  if (typeof window === "undefined") return null;
  return parseStoredString(window.sessionStorage.getItem(key));
}

function writeSessionString(key: string, value: string): void {
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function getOrCreateMobileClientId(): string {
  if (typeof window === "undefined") return "";

  let clientId = parseStoredString(
    window.localStorage.getItem(MOBILE_CLIENT_ID_STORAGE_KEY),
  );
  if (!clientId) {
    clientId = crypto.randomUUID();
    window.localStorage.setItem(
      MOBILE_CLIENT_ID_STORAGE_KEY,
      JSON.stringify(clientId),
    );
  }

  // Keep the existing sessionStorage mirror because session and queue code
  // reads this key directly in a few browser-only integration paths. The
  // durable source of truth on mobile is localStorage so a WebView/process
  // recreation rejoins the same logical device client instead of registering
  // a second "ferrotune-mobile" entry.
  writeSessionString(CLIENT_ID_STORAGE_KEY, clientId);
  return clientId;
}

function getOrCreateClientId(): string {
  return isTauriMobile()
    ? getOrCreateMobileClientId()
    : getOrCreateTabClientId();
}

function parseActiveClientTabMarker(
  value: string | null,
): ActiveClientTabMarker | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const marker = parsed as Partial<ActiveClientTabMarker>;
    if (
      typeof marker.clientId !== "string" ||
      typeof marker.pageInstanceId !== "string" ||
      typeof marker.updatedAt !== "number"
    ) {
      return null;
    }
    return {
      clientId: marker.clientId,
      pageInstanceId: marker.pageInstanceId,
      updatedAt: marker.updatedAt,
    };
  } catch {
    return null;
  }
}

function activeClientTabStorageKey(tabInstanceId: string): string {
  return `${ACTIVE_CLIENT_TAB_STORAGE_PREFIX}${tabInstanceId}`;
}

function readActiveClientTabMarker(
  tabInstanceId: string,
): ActiveClientTabMarker | null {
  if (typeof window === "undefined") return null;
  return parseActiveClientTabMarker(
    window.localStorage.getItem(activeClientTabStorageKey(tabInstanceId)),
  );
}

function isPageReload(): boolean {
  if (typeof window === "undefined") return false;
  const navigationEntry = performance.getEntriesByType("navigation")[0];
  return (
    navigationEntry instanceof PerformanceNavigationTiming &&
    navigationEntry.type === "reload"
  );
}

function refreshActiveClientTabMarker(): void {
  if (typeof window === "undefined" || !activeClientTab) return;
  window.localStorage.setItem(
    activeClientTabStorageKey(activeClientTab.tabInstanceId),
    JSON.stringify({
      clientId: activeClientTab.clientId,
      pageInstanceId,
      updatedAt: Date.now(),
    } satisfies ActiveClientTabMarker),
  );
}

function clearActiveClientTabMarker(): void {
  if (typeof window === "undefined" || !activeClientTab) return;
  const key = activeClientTabStorageKey(activeClientTab.tabInstanceId);
  const marker = parseActiveClientTabMarker(window.localStorage.getItem(key));
  if (marker?.pageInstanceId === pageInstanceId) {
    window.localStorage.removeItem(key);
  }
}

function installActiveClientTabLifecycle(): void {
  if (typeof window === "undefined" || activeClientTabListenersInstalled) {
    return;
  }
  activeClientTabListenersInstalled = true;
  window.addEventListener("pagehide", clearActiveClientTabMarker);
  window.addEventListener("beforeunload", clearActiveClientTabMarker);
}

function markActiveClientTab(tabInstanceId: string, clientId: string): void {
  activeClientTab = { tabInstanceId, clientId };
  refreshActiveClientTabMarker();
  installActiveClientTabLifecycle();
  if (!activeClientTabRefreshInterval) {
    activeClientTabRefreshInterval = setInterval(
      refreshActiveClientTabMarker,
      ACTIVE_CLIENT_TAB_REFRESH_MS,
    );
  }
}

function getOrCreateTabClientId(): string {
  if (typeof window === "undefined") return "";

  let tabInstanceId = readSessionString(CLIENT_TAB_INSTANCE_STORAGE_KEY);
  let clientId = readSessionString(CLIENT_ID_STORAGE_KEY);
  const activeMarker = tabInstanceId
    ? readActiveClientTabMarker(tabInstanceId)
    : null;

  if (
    activeMarker &&
    activeMarker.pageInstanceId !== pageInstanceId &&
    !isPageReload()
  ) {
    tabInstanceId = null;
    clientId = null;
    window.sessionStorage.setItem(
      "ferrotune-is-audio-owner",
      JSON.stringify(false),
    );
  }

  if (!tabInstanceId) {
    tabInstanceId = crypto.randomUUID();
    writeSessionString(CLIENT_TAB_INSTANCE_STORAGE_KEY, tabInstanceId);
  }

  if (!clientId) {
    clientId = crypto.randomUUID();
    writeSessionString(CLIENT_ID_STORAGE_KEY, clientId);
  }

  markActiveClientTab(tabInstanceId, clientId);
  return clientId;
}

// ============================================================================
// Persistent atoms (sessionStorage — per tab)
// ============================================================================

/**
 * The current session ID for this tab.
 * Stored in sessionStorage so it survives page refresh.
 * With single-session-per-user, all tabs share the same session ID.
 */
export const currentSessionIdAtom = atomWithStorage<string | null>(
  "ferrotune-session-id",
  null,
  typeof window !== "undefined"
    ? {
        getItem: (key) => {
          const v = sessionStorage.getItem(key);
          return v ? JSON.parse(v) : null;
        },
        setItem: (key, value) =>
          sessionStorage.setItem(key, JSON.stringify(value)),
        removeItem: (key) => sessionStorage.removeItem(key),
      }
    : undefined,
  { getOnInit: true },
);

/**
 * Account key for the stored session ID. Session storage is per tab but not
 * per account, so this prevents a freshly selected account from briefly using
 * the previous account's session ID while reconnecting.
 */
export const currentSessionAccountKeyAtom = atomWithStorage<string | null>(
  "ferrotune-session-account-key",
  null,
  typeof window !== "undefined"
    ? {
        getItem: (key) => {
          const v = sessionStorage.getItem(key);
          return v ? JSON.parse(v) : null;
        },
        setItem: (key, value) =>
          sessionStorage.setItem(key, JSON.stringify(value)),
        removeItem: (key) => sessionStorage.removeItem(key),
      }
    : undefined,
  { getOnInit: true },
);

/**
 * Whether this tab owns audio playback (true) or is a follower (false).
 * Stored in sessionStorage so it survives page refresh.
 */
export const isAudioOwnerAtom = atomWithStorage<boolean>(
  "ferrotune-is-audio-owner",
  true,
  typeof window !== "undefined"
    ? {
        getItem: (key) => {
          const v = sessionStorage.getItem(key);
          return v ? JSON.parse(v) : true;
        },
        setItem: (key, value) =>
          sessionStorage.setItem(key, JSON.stringify(value)),
        removeItem: (key) => sessionStorage.removeItem(key),
      }
    : undefined,
  { getOnInit: true },
);

/**
 * Unique playback client ID. Browser tabs use a per-tab sessionStorage ID;
 * the single mobile WebView uses an install-scoped localStorage ID so an
 * Activity/process recreation rejoins the existing native playback client.
 */
export const clientIdAtom = atomWithStorage<string>(
  CLIENT_ID_STORAGE_KEY,
  "",
  typeof window !== "undefined"
    ? {
        getItem: () => getOrCreateClientId(),
        setItem: (key, value) => {
          if (isTauriMobile()) {
            localStorage.setItem(
              MOBILE_CLIENT_ID_STORAGE_KEY,
              JSON.stringify(value),
            );
            sessionStorage.setItem(key, JSON.stringify(value));
            return;
          }

          const tabInstanceId =
            readSessionString(CLIENT_TAB_INSTANCE_STORAGE_KEY) ??
            crypto.randomUUID();
          writeSessionString(CLIENT_TAB_INSTANCE_STORAGE_KEY, tabInstanceId);
          sessionStorage.setItem(key, JSON.stringify(value));
          markActiveClientTab(tabInstanceId, value);
        },
        removeItem: (key) => {
          if (isTauriMobile()) {
            localStorage.removeItem(MOBILE_CLIENT_ID_STORAGE_KEY);
            sessionStorage.removeItem(key);
            return;
          }

          clearActiveClientTabMarker();
          sessionStorage.removeItem(key);
          sessionStorage.removeItem(CLIENT_TAB_INSTANCE_STORAGE_KEY);
        },
      }
    : undefined,
  { getOnInit: true },
);

// ============================================================================
// Module-level flags (bypass React closure/timing issues)
// ============================================================================

/**
 * Set when this client initiates a self-takeover (transferToClient targeting
 * itself). Lets the ownerChanged handler distinguish a deliberate local
 * takeover from a passive reconnect snapshot.
 * Read synchronously by ownership and queue-control code.
 */
let _selfTakeoverPending = false;
export const selfTakeoverPending = {
  get value() {
    return _selfTakeoverPending;
  },
  set value(v: boolean) {
    _selfTakeoverPending = v;
  },
};

/**
 * Write-only atom that sets the selfTakeoverPending module-level flag.
 * Use this from React components to avoid React Compiler immutability errors.
 */
export const markSelfTakeoverAtom = atom(null, () => {
  _selfTakeoverPending = true;
});

// ============================================================================
// In-memory atoms
// ============================================================================

/**
 * List of connected clients for the current session.
 * Updated via SSE clientListChanged events and periodic refreshes.
 */
export const connectedClientsAtom = atom<ClientResponse[]>([]);

/**
 * The client ID of the current session owner.
 * Updated from server responses and owner change events.
 */
export const ownerClientIdAtom = atom<string | null>(null);

/**
 * The client name (e.g., "ferrotune-web", "ferrotune-mobile") of the current owner.
 */
export const ownerClientNameAtom = atom<string | null>(null);

// ============================================================================
// Derived atoms
// ============================================================================

/**
 * Effective session ID — always the user's single session.
 */
export const effectiveSessionIdAtom = atom<string | null>((get) => {
  const sessionId = get(currentSessionIdAtom);
  const sessionAccountKey = get(currentSessionAccountKeyAtom);
  const connection = get(serverConnectionAtom);
  const currentAccountKey = connection ? accountKey(connection) : null;

  if (
    !sessionId ||
    !sessionAccountKey ||
    sessionAccountKey !== currentAccountKey
  ) {
    return null;
  }

  return sessionId;
});

// ============================================================================
// Session readiness signaling
// ============================================================================
// The playback session is established asynchronously on startup via
// connectSession. The UI (including play buttons) becomes interactive before
// that resolves, so a playback-start action can fire while
// effectiveSessionIdAtom is still null — leading to a request with no session
// id (rejected by the backend) or a silently dropped play. These helpers let
// playback-start actions wait for the session instead of failing on the first
// attempt after a cold start.

let sessionReady = false;
let sessionReadyWaiters: Array<() => void> = [];

/** Mark the playback session as established and release any waiters. */
export function markSessionReady(): void {
  sessionReady = true;
  const waiters = sessionReadyWaiters;
  sessionReadyWaiters = [];
  for (const resolve of waiters) resolve();
}

/** Mark the playback session as not yet established (e.g. account switch). */
export function markSessionNotReady(): void {
  sessionReady = false;
}

/**
 * Resolve once the playback session is established, or after `timeoutMs` as a
 * safety net so callers never hang indefinitely if session init fails.
 */
export function waitForSessionReady(timeoutMs = 5000): Promise<void> {
  if (sessionReady) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const onReady = () => {
      if (settled) return;
      settled = true;
      sessionReadyWaiters = sessionReadyWaiters.filter((w) => w !== onReady);
      resolve();
    };
    sessionReadyWaiters.push(onReady);
    setTimeout(onReady, timeoutMs);
  });
}

/**
 * Whether this tab is a follower (not the audio owner).
 */
export const isRemoteControllingAtom = atom<boolean>((get) => {
  const ownerClientId = get(ownerClientIdAtom);
  const clientId = get(clientIdAtom);
  return (
    ownerClientId !== null &&
    ownerClientId !== clientId &&
    !get(isAudioOwnerAtom)
  );
});

/**
 * Tracks the remote session's playback state (received via SSE positionUpdate events).
 * Used to show correct play/pause state when following.
 */
export interface RemotePlaybackState {
  isPlaying: boolean;
  currentIndex: number;
  positionMs: number;
  /** Timestamp (Date.now()) when this state was received from the server */
  positionTimestamp: number;
  currentSongId?: string;
  currentSongTitle?: string;
  currentSongArtist?: string;
}

export const remotePlaybackStateAtom = atom<RemotePlaybackState | null>(null);

/**
 * Derived: the client name of the session owner.
 * Used to determine capabilities — e.g. whether in-app volume control is available.
 */
export const effectiveSessionClientNameAtom = atom<string | null>((get) => {
  return get(ownerClientNameAtom);
});

/**
 * Derived: whether in-app volume controls should be shown.
 * Volume controls are shown when the session owner is a web client
 * (adjustable in-app volume) and hidden when the owner is a native/mobile
 * client (uses system volume at 100%).
 */
export const shouldShowVolumeAtom = atom<boolean>((get) => {
  const clientName = get(effectiveSessionClientNameAtom);
  if (clientName) return clientName !== "ferrotune-mobile";
  return true;
});

/**
 * Derived: follower indicator info.
 * Returns the owner's display name when we're a follower, null when we're the owner.
 */
export const followerSessionNameAtom = atom<string | null>((get) => {
  const isRemote = get(isRemoteControllingAtom);
  if (!isRemote) return null;
  const ownerClientId = get(ownerClientIdAtom);
  const clients = get(connectedClientsAtom);
  if (!ownerClientId) return null;
  const owner = clients.find((c) => c.clientId === ownerClientId);
  return owner?.displayName ?? null;
});

/**
 * Derived: follower session owner client name.
 * Returns the client name (e.g. "ferrotune-mobile") when following,
 * null when we're the owner.
 */
export const followerSessionClientNameAtom = atom<string | null>((get) => {
  const isRemote = get(isRemoteControllingAtom);
  if (!isRemote) return null;
  return get(ownerClientNameAtom);
});
