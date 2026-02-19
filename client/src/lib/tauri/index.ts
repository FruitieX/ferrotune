/**
 * Tauri platform detection and bridge utilities.
 *
 * This module provides helpers for:
 * - Detecting if we're running in a Tauri environment
 * - Conditionally importing Tauri APIs
 * - Providing fallbacks for browser environments
 */

// Cache the detection results
let _isTauri: boolean | null = null;
let _isEmbeddedServer: boolean | null = null;

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
 * Check if we're running on a desktop platform in Tauri.
 * Desktop platforms have the embedded server.
 *
 * @returns true if running on desktop in Tauri
 */
export function isTauriDesktop(): boolean {
  if (!isTauri()) {
    return false;
  }

  // Check user agent for mobile platforms
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileUA =
    /android/.test(userAgent) || /iphone|ipad|ipod/.test(userAgent);

  return !isMobileUA;
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

/**
 * Check if the embedded server is available.
 * This is true on Tauri desktop platforms.
 *
 * @returns Promise that resolves to true if embedded server is available
 */
export async function hasEmbeddedServer(): Promise<boolean> {
  if (_isEmbeddedServer !== null) {
    return _isEmbeddedServer;
  }

  if (!isTauri()) {
    _isEmbeddedServer = false;
    return false;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    _isEmbeddedServer = await invoke<boolean>("is_embedded_server");
    return _isEmbeddedServer;
  } catch {
    _isEmbeddedServer = false;
    return false;
  }
}

/**
 * Get the embedded server admin password.
 * Only available on Tauri desktop platforms.
 *
 * @returns Promise that resolves to the admin password, or null if not available
 */
export async function getEmbeddedAdminPassword(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("get_embedded_admin_password");
  } catch {
    return null;
  }
}

/**
 * Get the base URL for API requests.
 * On Tauri desktop, this returns the custom protocol URL.
 * Otherwise, returns the provided server URL or empty string for same-origin.
 *
 * @param serverUrl - Optional server URL to use
 * @returns The base URL to use for API requests
 */
export function getApiBaseUrl(serverUrl?: string): string {
  // If a server URL is explicitly provided, use it
  if (serverUrl) {
    return serverUrl;
  }

  // On Tauri desktop, use the custom protocol
  if (isTauriDesktop()) {
    // Platform-specific URL format:
    // - macOS/iOS/Linux: ferrotune://localhost
    // - Windows/Android: http://ferrotune.localhost
    const isWindowsOrAndroid =
      typeof navigator !== "undefined" &&
      (navigator.userAgent.includes("Windows") ||
        navigator.userAgent.includes("Android"));

    return isWindowsOrAndroid
      ? "http://ferrotune.localhost"
      : "ferrotune://localhost";
  }

  // Default: use same origin (empty string)
  return "";
}
