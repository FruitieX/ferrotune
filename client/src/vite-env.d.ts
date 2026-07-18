declare const __FERROTUNE_BUILD_INFO__: {
  version: string;
  buildDate: string;
  gitCommit: string;
};

interface Window {
  /** Tauri's injected IPC bridge. */
  __TAURI_INTERNALS__?: unknown;
  /** Set synchronously by the Tauri shell before the web bundle executes. */
  __FERROTUNE_NATIVE_AUDIO__?: boolean;
}
