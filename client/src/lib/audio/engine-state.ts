/**
 * Centralized module-level mutable state for the audio engine.
 *
 * These flags live outside React's state system for performance (no re-renders)
 * and because they need synchronous access from event handlers and callbacks.
 *
 * Extracted from hooks.ts to make the implicit state visible and organized.
 */

// ============================================================================
// NATIVE AUDIO ENGINE STATE
// ============================================================================
// Tracks the Kotlin/ExoPlayer bridge lifecycle.
// Set once during initNativeAudioEngine(), cleared on cleanup/account switch.

/** Whether we're using native (Tauri) audio vs web audio */
export let usingNativeAudio = false;
export function setUsingNativeAudio(v: boolean) {
  usingNativeAudio = v;
}

/** Resolves when native listeners are registered */
export let nativeAudioReady: Promise<void> | null = null;
export function setNativeAudioReady(v: Promise<void> | null) {
  nativeAudioReady = v;
}

/** Resolves when native session (API credentials) are configured in Kotlin */
export let nativeSessionReady: Promise<void> | null = null;
let nativeSessionReadyResolve: (() => void) | null = null;

export function createNativeSessionReadyPromise(): void {
  nativeSessionReady = new Promise<void>((resolve) => {
    nativeSessionReadyResolve = resolve;
  });
}

export function resolveNativeSessionReadyPromise(): void {
  if (nativeSessionReadyResolve) {
    nativeSessionReadyResolve();
    nativeSessionReadyResolve = null;
  }
}

// ============================================================================
// WEB AUDIO PLAYBACK STATE
// ============================================================================
// Tracks the HTML audio element lifecycle.
// Coordinates gapless handoffs, prevents duplicate loads, and manages
// edge cases like intentional stops vs unexpected errors.

/** Track ID currently set on the active audio element */
export let currentLoadedTrackId: string | null = null;
export function setCurrentLoadedTrackId(v: string | null) {
  currentLoadedTrackId = v;
}

/** Prevents handlePause from overwriting "ended" state */
export let isEndingQueue = false;
export function setIsEndingQueue(v: boolean) {
  isEndingQueue = v;
}

/** Suppresses "ended" state check during track load */
export let isLoadingNewTrack = false;
export function setIsLoadingNewTrack(v: boolean) {
  isLoadingNewTrack = v;
}

/** Suppresses error toasts during clear/stop */
export let isIntentionalStop = false;
export function setIsIntentionalStop(v: boolean) {
  isIntentionalStop = v;
}

/** True during swap from pre-buffered element */
export let isGaplessHandoff = false;
export function setIsGaplessHandoff(v: boolean) {
  isGaplessHandoff = v;
}

/** Expected track ID during handoff */
export let gaplessHandoffExpectedTrackId: string | null = null;
export function setGaplessHandoffExpectedTrackId(v: string | null) {
  gaplessHandoffExpectedTrackId = v;
}

// ============================================================================
// CHANGE DETECTION STATE
// ============================================================================
// Used to detect when transcoding settings change and need to be re-sent.

/** Last sent transcoding toggle */
export let lastNativeTranscodingEnabled = false;
export function setLastNativeTranscodingEnabled(v: boolean) {
  lastNativeTranscodingEnabled = v;
}

/** Last sent bitrate */
export let lastNativeTranscodingBitrate = 0;
export function setLastNativeTranscodingBitrate(v: number) {
  lastNativeTranscodingBitrate = v;
}

// ============================================================================
// RESET
// ============================================================================

/** Reset all module-level engine state to initial values. */
export function resetEngineState() {
  usingNativeAudio = false;
  nativeAudioReady = null;
  nativeSessionReady = null;
  nativeSessionReadyResolve = null;
  currentLoadedTrackId = null;
  isEndingQueue = false;
  isLoadingNewTrack = false;
  isIntentionalStop = false;
  isGaplessHandoff = false;
  gaplessHandoffExpectedTrackId = null;
  lastNativeTranscodingEnabled = false;
  lastNativeTranscodingBitrate = 0;
}
