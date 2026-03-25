"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  appResumeRepaintEvent,
  isAndroidTauriWebView,
} from "@/lib/utils/app-resume-repaint";
import { suppressNetworkErrorToasts } from "@/lib/api/client";

/**
 * Invalidates all React Query queries when the app resumes from background.
 * Also briefly suppresses network error toasts since the WebView's network
 * stack may not be immediately ready after resume.
 */
export function useAppResumeRefresh() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAndroidTauriWebView()) return;

    const handleResume = () => {
      // Suppress network error toasts for a brief window after resume,
      // since the first requests may fail before the network stack is ready
      suppressNetworkErrorToasts(3000);

      // Invalidate all queries to trigger fresh refetches
      queryClient.invalidateQueries();
    };

    window.addEventListener(appResumeRepaintEvent, handleResume);
    return () => {
      window.removeEventListener(appResumeRepaintEvent, handleResume);
    };
  }, [queryClient]);
}
