"use client";

import { useEffect } from "react";

// Counter for programmatic history.back() calls used to clean up stale
// pushState entries.  Other popstate handlers check this to avoid reacting
// to the synthetic popstate event.
let pendingHistoryCleanups = 0;

/**
 * Call history.back() to remove a previously pushed dummy history state,
 * marking it as a cleanup so other popstate handlers can ignore the
 * resulting popstate event.
 */
export function cleanUpHistoryState() {
  pendingHistoryCleanups++;
  window.history.back();
}

/**
 * Check if the current popstate event was triggered by a cleanup
 * history.back() call.  Returns true (and decrements the counter) if so —
 * the caller should ignore the event.
 */
export function isHistoryCleanup(): boolean {
  if (pendingHistoryCleanups > 0) {
    pendingHistoryCleanups--;
    return true;
  }
  return false;
}

/**
 * Hook that handles Android back button behavior for closing menus/dialogs.
 *
 * On Android, pressing the back button triggers a popstate event.
 * This hook listens for popstate and dispatches an Escape key event
 * to close any open context menus, dropdowns, or dialogs.
 *
 * It also pushes a dummy history entry so the back button doesn't
 * navigate away from the page when used to close menus.
 *
 * Note: Queue panel and fullscreen player are NOT handled here — they
 * manage their own history entries and popstate handlers.
 *
 * Priority order (highest first):
 * 1. Context menus, dropdown menus, popovers (temporary overlays)
 * 2. Dialogs and sheets (modal overlays)
 */
export function useBackButtonClose() {
  useEffect(() => {
    // Only needed on mobile/Android-like environments
    // Desktop browsers don't have a hardware back button
    const isMobileOrTablet =
      typeof window !== "undefined" &&
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );

    if (!isMobileOrTablet) return;

    // Push a dummy state so back button doesn't navigate away
    let hasPushedState = false;

    const pushDummyState = () => {
      if (!hasPushedState) {
        window.history.pushState({ closeMenu: true }, "");
        hasPushedState = true;
      }
    };

    // Overlay selectors in priority order (check highest priority first)
    // Note: queue panel and fullscreen player are excluded — they manage
    // their own history entries via dedicated effects.
    const overlaySelectors = [
      // Priority 1: Temporary overlays (menus, popovers)
      '[data-state="open"][data-slot="context-menu-content"]',
      '[data-state="open"][data-slot="dropdown-menu-content"]',
      '[data-state="open"][data-slot="popover-content"]',
      // Priority 2: Modal overlays (dialogs, sheets)
      '[data-state="open"][data-slot="dialog-content"]',
      '[data-state="open"][data-slot="sheet-content"]',
    ];

    // Combined selector for checking if any overlay is open
    const anyOverlaySelector = overlaySelectors.join(", ");

    // Check if any menu/dialog is open and push state if so
    const checkForOpenMenus = () => {
      const hasOpenMenu = document.querySelector(anyOverlaySelector);
      if (hasOpenMenu) {
        pushDummyState();
      }
    };

    // Listen for DOM changes to detect when menus open
    const observer = new MutationObserver(checkForOpenMenus);
    observer.observe(document.body, { childList: true, subtree: true });

    const handlePopState = (event: PopStateEvent) => {
      // Ignore synthetic popstate from history cleanup in other overlays
      if (isHistoryCleanup()) return;

      // Find the highest priority overlay that's open
      let targetElement: Element | null = null;

      for (const selector of overlaySelectors) {
        const element = document.querySelector(selector);
        if (element) {
          targetElement = element;
          break; // Stop at first match (highest priority)
        }
      }

      if (targetElement) {
        // Prevent default navigation by pushing state back
        event.preventDefault();

        // Dispatch Escape key to the specific element to close only that overlay
        targetElement.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );

        // Reset so we can handle the next back button press
        hasPushedState = false;
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      observer.disconnect();
    };
  }, []);
}
