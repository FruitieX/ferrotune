"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue } from "jotai";
import { isOfflineModeAtom } from "@/lib/store/downloads";
import { getClient } from "@/lib/api/client";

const PING_INTERVAL_ONLINE_MS = 60_000;
const PING_INTERVAL_WHEN_OFFLINE_MS = 15_000;
const PING_PROBE_TIMEOUT_MS = 5_000;

/**
 * Network listener — toggles `isOfflineModeAtom` based on:
 *  - `window.online` / `window.offline` events (best-effort; `navigator.onLine`
 *    reports true whenever any network interface is up, e.g. captive portals).
 *  - A periodic `client.ping()` reachability probe — the only source of truth
 *    for whether the *Ferrotune server* is actually reachable.
 *
 * Rules:
 *  - On `offline` event: immediately flip `isOfflineModeAtom = true`.
 *  - On `online` event: schedule a `ping()`; only flip back to online after
 *    the ping succeeds. If the ping fails, keep the offline flag set and
 *    re-probe on the offline-interval cadence.
 *  - On `offline → online` transition: consumers `useOnlineTransition(...)`
 *    fire their recovery side-effects.
 */
export function useOfflineMode(): void {
  const [isOffline, setIsOffline] = useAtom(isOfflineModeAtom);
  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;
  const probingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function probe(triggeredByOnlineEvent: boolean): Promise<void> {
      if (cancelled || probingRef.current) return;
      probingRef.current = true;
      try {
        const client = getClient();
        if (!client) return;
        const result = await withTimeout(client.ping(), PING_PROBE_TIMEOUT_MS);
        if (cancelled) return;
        if (result) {
          if (isOfflineRef.current) setIsOffline(false);
        } else {
          if (!isOfflineRef.current) setIsOffline(true);
        }
      } catch (err) {
        if (cancelled) return;
        if (!isOfflineRef.current) setIsOffline(true);
        if (triggeredByOnlineEvent) {
          console.warn("[offline] ping failed after online event", err);
        }
      } finally {
        probingRef.current = false;
      }
    }

    function handleOffline() {
      setIsOffline(true);
      void probe(false);
    }

    function handleOnline() {
      void probe(true);
    }

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.onLine === "boolean" &&
      !navigator.onLine
    ) {
      setIsOffline(true);
    }

    void probe(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    interval = setInterval(
      () => void probe(false),
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
 * from `true → false`, fires `onOnline`. Returns the current flag so callers
 * can also short-circuit their own network-bound effects while offline.
 *
 * `onOnline` is wrapped in try/catch so the recovery can't crash callers;
 * log warnings only.
 */
export function useOnlineTransition(onOnline: () => void): boolean {
  const isOffline = useAtomValue(isOfflineModeAtom);
  const prevOfflineRef = useRef(isOffline);
  const onOnlineRef = useRef(onOnline);
  onOnlineRef.current = onOnline;

  useEffect(() => {
    const wasOffline = prevOfflineRef.current;
    if (wasOffline && !isOffline) {
      try {
        onOnlineRef.current();
      } catch (err) {
        console.warn("[offline] online-transition recovery threw", err);
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
