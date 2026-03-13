"use client";

import { useRouter } from "next/navigation";

/**
 * Provides a navigateBack function that falls back to the home page
 * when there's no browser history to go back to (e.g. after app resume
 * on Android/Tauri where the history stack may be empty).
 */
export function useNavigateBack() {
  const router = useRouter();

  const navigateBack = () => {
    // Modern Navigation API (available in Chrome/Android WebView)
    // provides a reliable way to check if we can go back
    const nav = (window as { navigation?: { canGoBack: boolean } }).navigation;

    if (nav && !nav.canGoBack) {
      router.push("/");
      return;
    }

    // Fallback: if the Navigation API is unavailable, check history length.
    // A length of 1 means this is the only entry (no back history).
    // On Tauri/Android resume with cleared history, this will be 1.
    if (!nav && window.history.length <= 1) {
      router.push("/");
      return;
    }

    router.back();
  };

  return navigateBack;
}
