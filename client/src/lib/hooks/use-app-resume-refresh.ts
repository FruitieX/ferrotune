"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  appResumeRepaintEvent,
  isAndroidTauriWebView,
} from "@/lib/utils/app-resume-repaint";
import { getClient, suppressNetworkErrorToasts } from "@/lib/api/client";

const RESUME_REACHABILITY_TIMEOUT_MS = 5_000;

/**
 * Invalidates all React Query queries when the app resumes from background.
 * Also briefly suppresses network error toasts since the WebView's network
 * stack may not be immediately ready after resume.
 */
export function useAppResumeRefresh() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAndroidTauriWebView()) return;

    let activeProbe: AbortController | null = null;

    const handleResume = () => {
      activeProbe?.abort();
      const controller = new AbortController();
      activeProbe = controller;

      // Suppress network error toasts for a brief window after resume,
      // since the first requests may fail before the network stack is ready
      suppressNetworkErrorToasts(3000);

      const timeout = window.setTimeout(
        () => controller.abort(),
        RESUME_REACHABILITY_TIMEOUT_MS,
      );

      void (async () => {
        try {
          const client = getClient();
          if (!client) return;

          // Restricted/captive Wi-Fi still reports navigator.onLine=true.
          // Confirm that Ferrotune itself is reachable before triggering a
          // potentially large batch of passive query refreshes.
          await client.ping({ signal: controller.signal, silent: true });
          if (controller.signal.aborted) return;

          suppressNetworkErrorToasts(3000);
          await queryClient.invalidateQueries();
        } catch {
          // Reachability is maintained by useOfflineMode. Resume refresh is
          // passive and should remain silent when the server is unavailable.
        } finally {
          window.clearTimeout(timeout);
          if (activeProbe === controller) activeProbe = null;
        }
      })();
    };

    window.addEventListener(appResumeRepaintEvent, handleResume);
    return () => {
      activeProbe?.abort();
      window.removeEventListener(appResumeRepaintEvent, handleResume);
    };
  }, [queryClient]);
}
