/**
 * Tauri platform detection and bridge utilities.
 *
 * This module provides helpers for:
 * - Detecting if we're running in a Tauri environment
 * - Conditionally importing Tauri APIs
 * - Providing fallbacks for browser environments
 */

// Cache the detection result
let _isTauri: boolean | null = null;

/**
 * Check if we're running in a Tauri environment.
 * This checks for the presence of window.__TAURI_INTERNALS__ which
 * is injected by Tauri at runtime.
 *
 * @returns true if running in Tauri, false otherwise
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (_isTauri === null) {
    // Check for Tauri IPC internals
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _isTauri = !!(window as any).__TAURI_INTERNALS__;
  }

  return _isTauri;
}

/**
 * Check if we're running on a mobile platform (Android/iOS) in Tauri.
 * On mobile, we use native audio playback instead of the web Audio API.
 *
 * @returns true if running on mobile in Tauri
 */
export function isTauriMobile(): boolean {
  if (!isTauri()) {
    return false;
  }

  // In Tauri, we can check the platform
  // For now, we assume mobile if:
  // 1. We're in Tauri
  // 2. The viewport hints at mobile OR touch is primary
  if (typeof window === "undefined") {
    return false;
  }

  // Check for touch-primary device (common on mobile)
  const hasTouchScreen =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).msMaxTouchPoints > 0;

  // Check for mobile viewport
  const isMobileViewport = window.innerWidth <= 768;

  // On Tauri mobile, both should be true
  // But also check user agent for Android/iOS
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileUA =
    /android/.test(userAgent) ||
    /iphone|ipad|ipod/.test(userAgent) ||
    // Tauri Android WebView
    /wv/.test(userAgent);

  return hasTouchScreen && (isMobileViewport || isMobileUA);
}

/**
 * Check if native audio is available.
 * Native audio is only available on Tauri mobile platforms.
 *
 * @returns true if native audio should be used
 */
export function hasNativeAudio(): boolean {
  return isTauriMobile();
}
