"use client";

import { useEffect } from "react";

/**
 * Hook that handles Android back button behavior for closing menus/dialogs.
 *
 * On Android, pressing the back button triggers a popstate event.
 * This hook listens for popstate and dispatches an Escape key event
 * to close any open context menus, dropdowns, or dialogs.
 *
 * It also pushes a dummy history entry so the back button doesn't
 * navigate away from the page when used to close menus.
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

    // Check if any menu/dialog is open and push state if so
    const checkForOpenMenus = () => {
      const hasOpenMenu = document.querySelector(
        '[data-state="open"][data-slot="context-menu-content"], ' +
          '[data-state="open"][data-slot="dropdown-menu-content"], ' +
          '[data-state="open"][data-slot="dialog-content"]',
      );
      if (hasOpenMenu) {
        pushDummyState();
      }
    };

    // Listen for DOM changes to detect when menus open
    const observer = new MutationObserver(checkForOpenMenus);
    observer.observe(document.body, { childList: true, subtree: true });

    const handlePopState = (event: PopStateEvent) => {
      // Check if there's an open menu/dialog
      const openMenu = document.querySelector(
        '[data-state="open"][data-slot="context-menu-content"], ' +
          '[data-state="open"][data-slot="dropdown-menu-content"], ' +
          '[data-state="open"][data-slot="dialog-content"]',
      );

      if (openMenu) {
        // Prevent default navigation by pushing state back
        event.preventDefault();

        // Dispatch Escape key to close the menu
        document.dispatchEvent(
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
