"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue } from "jotai";
import { isOfflineModeAtom } from "@/lib/store/downloads";
import { getClient } from "@/lib/api/client";

const PING_INTERVAL_ONLINE_MS = 60_000;
const PING_INTERVAL_WHEN_OFFLINE_MS = 15_000;
const PING_PROBE_TIMEOUT_MS = 5_000;
/**
 * Number of consecutive ping failures required before we flip offline while
 * `navigator.onLine` still reports true. Avoids transient single-ping blips
 * (server briefly busy, GC pause, etc.) from gray-outing the UI.
 */
const PING_FAILURE_THRESHOLD = 2;
/**
 * Minimum duration (ms) we must have been offline before the online-transition
 * recovery callback fires. Filters out sub-second blips where recovery would
 * just thrash the React Query cache needlessly.
 */
const MIN_OFFLINE_DURATION_FOR_RECOVERY_MS = 3_000;

/**
 * Network listener — toggles `isOfflineModeAtom` based on:
 *  - `window.online` / `window.offline` events. `navigator.onLine === false`
 *    is treated as authoritative and flips offline immediately.
 *  - A periodic `client.ping()` reachability probe — used to detect
 *    captive-portal / unreachable-server cases where the browser still
 *    reports "online". Requires `PING_FAILURE_THRESHOLD` consecutive failures
 *    before flipping offline, to absorb transient blips.
 *
 * On `offline → online` transition (after at least
 * `MIN_OFFLINE_DURATION_FOR_RECOVERY_MS`), consumers of
 * `useOnlineTransition(...)` fire their recovery side-effects.
 */
export function useOfflineMode(): void {
  const [isOffline, setIsOffline] = useAtom(isOfflineModeAtom);
  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;
  const probingRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function probe(): Promise<void> {
      if (cancelled || probingRef.current) return;
      probingRef.current = true;
      try {
        const client = getClient();
        if (!client) return;
        const result = await withTimeout(client.ping(), PING_PROBE_TIMEOUT_MS);
        if (cancelled) return;
        if (result) {
          consecutiveFailuresRef.current = 0;
          if (isOfflineRef.current) setIsOffline(false);
        } else {
          consecutiveFailuresRef.current += 1;
          if (
            !isOfflineRef.current &&
            consecutiveFailuresRef.current >= PING_FAILURE_THRESHOLD
          ) {
            setIsOffline(true);
          }
        }
      } catch (err) {
        if (cancelled) return;
        consecutiveFailuresRef.current += 1;
        if (
          !isOfflineRef.current &&
          consecutiveFailuresRef.current >= PING_FAILURE_THRESHOLD
        ) {
          setIsOffline(true);
        }
        if (consecutiveFailuresRef.current === 1) {
          console.warn("[offline] ping failed (transient)", err);
        }
      } finally {
        probingRef.current = false;
      }
    }

    function handleOffline() {
      // Authoritative — flip immediately.
      consecutiveFailuresRef.current = PING_FAILURE_THRESHOLD;
      setIsOffline(true);
    }

    function handleOnline() {
      // Browser says we're back; probe to confirm the server is reachable.
      void probe();
    }

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.onLine === "boolean" &&
      !navigator.onLine
    ) {
      handleOffline();
    }

    void probe();

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    interval = setInterval(
      () => void probe(),
      isOfflineRef.current
        ? PING_INTERVAL_WHEN_OFFLINE_MS
        : PING_INTERVAL_ONLINE_MS,
    );

    return () => {
      cancelled = true;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (interval) clearInterval(interval);
    };
  }, [setIsOffline]);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Online-transition recovery. When `isOfflineModeAtom` flips
 * from `true → false` *and* we were offline for at least
 * `MIN_OFFLINE_DURATION_FOR_RECOVERY_MS`, fires `onOnline`. Returns the
 * current flag so callers can also short-circuit their own network-bound
 * effects while offline.
 *
 * Sub-second blips (single transient ping failure that immediately recovered)
 * are filtered out so the recovery callback doesn't thrash the React Query
 * cache on noisy networks.
 */
export function useOnlineTransition(onOnline: () => void): boolean {
  const isOffline = useAtomValue(isOfflineModeAtom);
  const prevOfflineRef = useRef(isOffline);
  const wentOfflineAtRef = useRef<number | null>(null);
  const onOnlineRef = useRef(onOnline);
  onOnlineRef.current = onOnline;

  useEffect(() => {
    const wasOffline = prevOfflineRef.current;
    if (!wasOffline && isOffline) {
      // Going offline — stamp the time.
      wentOfflineAtRef.current = Date.now();
    } else if (wasOffline && !isOffline) {
      // Coming back online — only fire recovery if we were offline long
      // enough for it to matter.
      const wentOfflineAt = wentOfflineAtRef.current;
      const offlineDurationMs =
        wentOfflineAt !== null ? Date.now() - wentOfflineAt : 0;
      wentOfflineAtRef.current = null;
      if (offlineDurationMs >= MIN_OFFLINE_DURATION_FOR_RECOVERY_MS) {
        try {
          onOnlineRef.current();
        } catch (err) {
          console.warn("[offline] online-transition recovery threw", err);
        }
      }
    }
    prevOfflineRef.current = isOffline;
  }, [isOffline]);

  return isOffline;
}

/** Read-only accessor for the live offline flag. */
export function useOfflineModeState(): boolean {
  return useAtomValue(isOfflineModeAtom);
}
