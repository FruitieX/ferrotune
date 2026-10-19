import { useEffect } from "react";
import { toast } from "sonner";
import { isTauri } from "@/lib/tauri";
import {
  currentEntryScript,
  fetchLatestEntryScript,
} from "@/lib/utils/app-update";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MIN_CHECK_GAP_MS = 30 * 1000;
const TOAST_ID = "app-update-available";

function showUpdateToast() {
  toast("New version available", {
    id: TOAST_ID,
    description: "Reload to use the latest Ferrotune.",
    duration: Infinity,
    action: {
      label: "Reload",
      onClick: () => window.location.reload(),
    },
  });
}

/**
 * Offers a reload when the server starts serving a newer web client: checks
 * when the app is opened, focused or reconnected and every five minutes while
 * visible. Never reloads on its own, since that would cut off playback.
 */
export function AppUpdateNotifier() {
  useEffect(() => {
    // Tauri bundles the client with the app; only the served web client updates.
    const loadedEntry = isTauri() ? null : currentEntryScript();
    if (!loadedEntry) {
      return;
    }

    let lastCheck = 0;
    let notified = false;

    const notify = () => {
      if (!notified) {
        notified = true;
        showUpdateToast();
      }
    };

    const check = () => {
      if (
        notified ||
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        Date.now() - lastCheck < MIN_CHECK_GAP_MS
      ) {
        return;
      }
      lastCheck = Date.now();
      fetchLatestEntryScript()
        .then((latestEntry) => {
          if (latestEntry && latestEntry !== loadedEntry) {
            notify();
          }
        })
        .catch(() => {});
    };

    // Vite reports a failed chunk preload here before the import rejects.
    window.addEventListener("vite:preloadError", notify);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    check();

    return () => {
      clearInterval(interval);
      window.removeEventListener("vite:preloadError", notify);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return null;
}
