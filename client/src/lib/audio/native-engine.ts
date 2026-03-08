/**
 * Native audio engine for Tauri mobile platforms.
 *
 * This module provides an audio engine that uses native Android/iOS audio
 * playback via the tauri-plugin-native-audio plugin. This enables:
 * - Background audio playback
 * - Lock screen controls
 * - Notification media controls
 * - Bluetooth metadata
 *
 * The API mirrors the browser's Audio API where possible to allow
 * the same UI code to work with both engines.
 */

import { isTauriMobile } from "@/lib/tauri";
import type { getClient } from "@/lib/api/client";
import type { PlaybackState as AppPlaybackState } from "@/lib/store/player";
import type { Song } from "@/lib/api/types";

// Types from the native plugin
interface NativeTrackInfo {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  coverArtUrl?: string;
  durationMs: number;
  replayGainDb?: number;
}

interface NativePlaybackState {
  status: "Idle" | "Buffering" | "Playing" | "Paused" | "Ended" | "Error";
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  track?: NativeTrackInfo;
  queueIndex: number;
  queueLength: number;
}

// Native audio API - dynamically imported only when needed
let nativeAudioApi: typeof import("tauri-plugin-native-audio-api") | null =
  null;

/**
 * Lazily load the native audio API.
 * This is async because we use dynamic imports.
 */
async function getNativeApi() {
  if (!isTauriMobile()) {
    throw new Error("Native audio is only available on Tauri mobile");
  }

  if (!nativeAudioApi) {
    nativeAudioApi = await import("tauri-plugin-native-audio-api");
  }

  return nativeAudioApi;
}

/**
 * Map native playback status to app playback state
 */
function mapNativeStatusToAppState(
  status: NativePlaybackState["status"],
): AppPlaybackState {
  switch (status) {
    case "Idle":
      return "idle";
    case "Buffering":
      return "loading";
    case "Playing":
      return "playing";
    case "Paused":
      return "paused";
    case "Ended":
      return "ended";
    case "Error":
      return "error";
    default:
      return "idle";
  }
}

/**
 * Native audio engine callbacks
 */
export interface NativeAudioCallbacks {
  onStateChange: (state: AppPlaybackState) => void;
  onProgress: (currentTime: number, duration: number, buffered: number) => void;
  onError: (message: string, trackId?: string) => void;
  onTrackChange: (
    track: NativeTrackInfo | undefined,
    queueIndex: number,
  ) => void;
  onSkipPrevious: () => void;
  onSkipNext: () => void;
  onToggleStar: (trackId: string, isStarred: boolean) => void;
  onShuffleModeChanged: (enabled: boolean) => void;
  onRepeatModeChanged: (mode: string) => void;
  onQueueStateChanged?: (state: {
    currentIndex: number;
    totalCount: number;
    isShuffled: boolean;
    repeatMode: string;
  }) => void;
  onScrobble?: (trackId: string) => void;
  onClipping?: (peakOverDb: number) => void;
}

/**
 * Native audio engine state
 */
interface NativeEngineState {
  initialized: boolean;
  callbacks: NativeAudioCallbacks | null;
}

const engineState: NativeEngineState = {
  initialized: false,
  callbacks: null,
};

/**
 * Initialize the native audio engine.
 * Sets up a global callback function that the Kotlin side calls via
 * WebView.evaluateJavascript() to deliver events. This bypasses Tauri's
 * plugin event system (trigger/addPluginListener) which doesn't reliably
 * deliver events from Android plugins to JS.
 *
 * @param callbacks Callback functions for audio events
 */
export async function initNativeAudioEngine(
  callbacks: NativeAudioCallbacks,
): Promise<void> {
  if (!isTauriMobile()) {
    console.log("[NativeAudio] Not on Tauri mobile, skipping init");
    return;
  }

  if (engineState.initialized) {
    console.log("[NativeAudio] Already initialized");
    return;
  }

  console.log("[NativeAudio] Initializing native audio engine");

  try {
    // Ensure the native API module is loaded (validates Tauri environment)
    await getNativeApi();
    engineState.callbacks = callbacks;

    // Register a global callback that the Kotlin NativeAudioPlugin calls
    // via WebView.evaluateJavascript() to deliver events.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ferrotuneNativeAudio = (event: string, data: any) => {
      switch (event) {
        case "state-change": {
          const status = data?.state?.status as
            | NativePlaybackState["status"]
            | undefined;
          if (status) {
            console.log("[NativeAudio] State change:", status);
            const appState = mapNativeStatusToAppState(status);
            engineState.callbacks?.onStateChange(appState);
          }
          break;
        }
        case "progress":
          engineState.callbacks?.onProgress(
            (data?.positionMs ?? 0) / 1000,
            (data?.durationMs ?? 0) / 1000,
            (data?.bufferedMs ?? 0) / 1000,
          );
          break;
        case "error":
          console.error("[NativeAudio] Error:", data?.message);
          engineState.callbacks?.onError(
            data?.message ?? "Unknown error",
            data?.trackId,
          );
          break;
        case "track-change":
          console.log("[NativeAudio] Track change:", data?.track?.title);
          engineState.callbacks?.onTrackChange(data?.track, data?.queueIndex);
          break;
        case "skip-previous":
          console.log("[NativeAudio] Skip previous from notification");
          engineState.callbacks?.onSkipPrevious();
          break;
        case "skip-next":
          console.log("[NativeAudio] Skip next from notification");
          engineState.callbacks?.onSkipNext();
          break;
        case "toggle-star":
          console.log("[NativeAudio] Toggle star from external controller");
          if (data?.trackId) {
            engineState.callbacks?.onToggleStar(
              data.trackId,
              data.isStarred ?? false,
            );
          }
          break;
        case "shuffle-mode-changed":
          console.log("[NativeAudio] Shuffle mode changed:", data?.enabled);
          engineState.callbacks?.onShuffleModeChanged(data?.enabled ?? false);
          break;
        case "repeat-mode-changed":
          console.log("[NativeAudio] Repeat mode changed:", data?.mode);
          engineState.callbacks?.onRepeatModeChanged(data?.mode ?? "off");
          break;
        case "queue-state-changed":
          console.log("[NativeAudio] Queue state changed:", data);
          if (data) {
            engineState.callbacks?.onQueueStateChanged?.({
              currentIndex: data.currentIndex ?? 0,
              totalCount: data.totalCount ?? 0,
              isShuffled: data.isShuffled ?? false,
              repeatMode: data.repeatMode ?? "off",
            });
          }
          break;
        case "scrobble":
          console.log("[NativeAudio] Scrobble:", data?.trackId);
          if (data?.trackId) {
            engineState.callbacks?.onScrobble?.(data.trackId);
          }
          break;
        case "clipping":
          if (data?.peakOverDb != null) {
            engineState.callbacks?.onClipping?.(data.peakOverDb);
          }
          break;
        default:
          console.warn("[NativeAudio] Unknown event:", event);
      }
    };

    engineState.initialized = true;
    console.log("[NativeAudio] Native audio engine initialized");

    // Apply safe area insets that may have been missed during initial page load
    // (the native listener fires before the WebView loads the page)
    try {
      const api = await getNativeApi();
      const insets = await api.getSafeAreaInsets();
      if (insets.top > 0 || insets.bottom > 0) {
        document.documentElement.style.setProperty(
          "--safe-area-top",
          `${insets.top}px`,
        );
        document.documentElement.style.setProperty(
          "--safe-area-bottom",
          `${insets.bottom}px`,
        );
      }
    } catch (insetError) {
      console.warn("[NativeAudio] Failed to get safe area insets:", insetError);
    }

    // Sync current state in case the Kotlin side already has playback state
    // (e.g., service was already running from before the WebView loaded).
    try {
      const api = await getNativeApi();
      const currentState = await api.getState();
      const appState = mapNativeStatusToAppState(currentState.status);
      console.log("[NativeAudio] Post-init state sync:", currentState.status);
      callbacks.onStateChange(appState);
      if (currentState.positionMs > 0 || currentState.durationMs > 0) {
        callbacks.onProgress(
          currentState.positionMs / 1000,
          currentState.durationMs / 1000,
          0,
        );
      }
    } catch (syncError) {
      console.warn("[NativeAudio] Post-init state sync failed:", syncError);
    }
  } catch (error) {
    console.error("[NativeAudio] Failed to initialize:", error);
    throw error;
  }
}

/**
 * Clean up the native audio engine.
 * Removes the global callback and resets state.
 */
export async function cleanupNativeAudioEngine(): Promise<void> {
  console.log("[NativeAudio] Cleaning up native audio engine");

  // Remove global callback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__ferrotuneNativeAudio;

  engineState.callbacks = null;
  engineState.initialized = false;
}

/**
 * Options for converting a Song to native track info
 */
export interface NativeStreamOptions {
  transcodingEnabled: boolean;
  transcodingBitrate: number;
  replayGainMode: string;
  replayGainOffset: number;
}

/**
 * Convert a Song to native track info
 */
function songToNativeTrack(
  song: Song,
  client: ReturnType<typeof getClient>,
  options?: NativeStreamOptions,
): NativeTrackInfo {
  if (!client) {
    throw new Error("Client not available");
  }

  // Compute per-track ReplayGain so native side can apply it during background playback
  let replayGainDb: number | undefined;
  if (options && options.replayGainMode !== "disabled") {
    const trackGain =
      options.replayGainMode === "original"
        ? (song.originalReplayGainTrackGain ?? 0)
        : (song.computedReplayGainTrackGain ??
          song.originalReplayGainTrackGain ??
          0);
    replayGainDb = trackGain + options.replayGainOffset;
  }

  return {
    id: song.id,
    url: client.getStreamUrl(song.id, {
      maxBitRate: options?.transcodingEnabled
        ? options.transcodingBitrate
        : undefined,
      format: options?.transcodingEnabled ? "opus" : undefined,
    }),
    title: song.title,
    artist: song.artist || "Unknown Artist",
    album: song.album || "Unknown Album",
    coverArtUrl: song.coverArt
      ? client.getCoverArtUrl(song.coverArt, 512)
      : undefined,
    durationMs: (song.duration || 0) * 1000,
    replayGainDb,
  };
}

/**
 * Play the current track
 */
export async function nativePlay(): Promise<void> {
  console.log("[NativeAudio] nativePlay() called");
  const api = await getNativeApi();
  await api.play();
}

/**
 * Request that the next setQueue() call auto-starts playback.
 * Fire-and-forget: call from atom writes before the queue is set.
 */
export function nativeRequestPlayback(): void {
  console.log("[NativeAudio] nativeRequestPlayback() called");
  getNativeApi()
    .then((api) => api.requestPlayback())
    .catch((err) =>
      console.error("[NativeAudio] requestPlayback failed:", err),
    );
}

/**
 * Pause playback
 */
export async function nativePause(): Promise<void> {
  console.log("[NativeAudio] nativePause() called");
  const api = await getNativeApi();
  await api.pause();
}

/**
 * Stop playback completely
 */
export async function nativeStop(): Promise<void> {
  console.log("[NativeAudio] nativeStop() called");
  const api = await getNativeApi();
  await api.stop();
}

/**
 * Seek to a position in seconds
 */
export async function nativeSeek(positionSeconds: number): Promise<void> {
  console.log("[NativeAudio] nativeSeek() called:", positionSeconds);
  const api = await getNativeApi();
  await api.seek(Math.round(positionSeconds * 1000));
}

/**
 * Set a single track to play
 */
export async function nativeSetTrack(
  song: Song,
  client: ReturnType<typeof getClient>,
  options?: NativeStreamOptions,
): Promise<void> {
  console.log("[NativeAudio] nativeSetTrack() called:", song.title);
  const api = await getNativeApi();
  const track = songToNativeTrack(song, client, options);
  console.log("[NativeAudio] nativeSetTrack() - track URL:", track.url);
  await api.setTrack(track);
  console.log("[NativeAudio] nativeSetTrack() completed");
}

/**
 * Set the playback queue
 */
export async function nativeSetQueue(
  songs: Song[],
  startIndex: number,
  client: ReturnType<typeof getClient>,
  queueOffset: number = 0,
  startPositionMs: number = 0,
  options?: NativeStreamOptions,
  playWhenReady: boolean = false,
): Promise<void> {
  const api = await getNativeApi();
  const tracks = songs.map((song) => songToNativeTrack(song, client, options));
  await api.setQueue(
    tracks,
    startIndex,
    queueOffset,
    startPositionMs,
    playWhenReady,
  );
}

/**
 * Skip to next track
 */
export async function nativeNextTrack(): Promise<void> {
  const api = await getNativeApi();
  await api.nextTrack();
}

/**
 * Skip to previous track
 */
export async function nativePreviousTrack(): Promise<void> {
  const api = await getNativeApi();
  await api.previousTrack();
}

/**
 * Set native player repeat mode
 */
export async function nativeSetRepeatMode(mode: string): Promise<void> {
  const api = await getNativeApi();
  await api.setRepeatMode(mode);
}

/**
 * Append songs to the end of the native playback queue
 */
export async function nativeAppendToQueue(
  songs: Song[],
  client: ReturnType<typeof getClient>,
  options?: NativeStreamOptions,
): Promise<void> {
  const api = await getNativeApi();
  const tracks = songs.map((song) => songToNativeTrack(song, client, options));
  await api.appendToQueue(tracks);
}

/**
 * Set playback volume (0.0 to 1.0)
 */
export async function nativeSetVolume(volume: number): Promise<void> {
  const api = await getNativeApi();
  await api.setVolume(volume);
}

/**
 * Set ReplayGain boost/attenuation in dB.
 * Converted to millibels for the native LoudnessEnhancer.
 */
export async function nativeSetReplayGain(gainDb: number): Promise<void> {
  const api = await getNativeApi();
  const gainMb = Math.round(gainDb * 100);
  await api.setReplayGain(gainMb);
}

/**
 * Get current playback state
 */
export async function nativeGetState(): Promise<{
  state: AppPlaybackState;
  positionSeconds: number;
  durationSeconds: number;
  volume: number;
  queueIndex: number;
  trackId?: string;
}> {
  const api = await getNativeApi();
  const nativeState = await api.getState();

  return {
    state: mapNativeStatusToAppState(nativeState.status),
    positionSeconds: nativeState.positionMs / 1000,
    durationSeconds: nativeState.durationMs / 1000,
    volume: nativeState.volume,
    queueIndex: nativeState.queueIndex,
    trackId: nativeState.track?.id,
  };
}

/**
 * Update the starred state of the current track (updates WearOS button icon)
 */
export async function nativeUpdateStarredState(
  starred: boolean,
): Promise<void> {
  const api = await getNativeApi();
  await api.updateStarredState(starred);
}

// ── Autonomous playback mode ────────────────────────────────────────────

/**
 * Initialize session configuration for autonomous playback.
 * Must be called once before startAutonomousPlayback().
 */
export async function nativeInitSession(config: {
  serverUrl: string;
  username: string;
  password?: string;
  apiKey?: string;
}): Promise<void> {
  console.log("[NativeAudio] nativeInitSession() called");
  try {
    const api = await getNativeApi();
    await api.initSession(config);
    console.log("[NativeAudio] nativeInitSession() SUCCEEDED");
  } catch (err) {
    console.error("[NativeAudio] nativeInitSession() FAILED:", String(err));
    throw err;
  }
}

/**
 * Update playback settings on the native side.
 */
export async function nativeUpdateSettings(settings: {
  replayGainMode: string;
  replayGainOffset: number;
  scrobbleThreshold: number;
  transcodingEnabled: boolean;
  transcodingBitrate: number;
}): Promise<void> {
  console.log(
    "[NativeAudio] nativeUpdateSettings() called:",
    JSON.stringify(settings),
  );
  try {
    const api = await getNativeApi();
    await api.updateSettings(settings);
    console.log("[NativeAudio] nativeUpdateSettings() SUCCEEDED");
  } catch (err) {
    console.error("[NativeAudio] nativeUpdateSettings() FAILED:", String(err));
    throw err;
  }
}

/**
 * Start autonomous playback: Kotlin takes over queue management.
 * The server queue must already be set up before calling this.
 */
export async function nativeStartAutonomousPlayback(params: {
  totalCount: number;
  currentIndex: number;
  isShuffled: boolean;
  repeatMode: string;
  playWhenReady: boolean;
  startPositionMs: number;
}): Promise<void> {
  console.log("[NativeAudio] nativeStartAutonomousPlayback() called", params);
  try {
    const api = await getNativeApi();
    await api.startAutonomousPlayback(params);
    console.log("[NativeAudio] nativeStartAutonomousPlayback() SUCCEEDED");
  } catch (err) {
    console.error(
      "[NativeAudio] nativeStartAutonomousPlayback() FAILED:",
      String(err),
    );
    throw err;
  }
}

/**
 * Invalidate the native queue window and refetch from server.
 */
export async function nativeInvalidateQueue(): Promise<void> {
  console.log("[NativeAudio] nativeInvalidateQueue() called");
  const api = await getNativeApi();
  await api.invalidateQueue();
}

/**
 * Toggle shuffle in autonomous mode.
 */
export async function nativeToggleShuffle(enabled: boolean): Promise<void> {
  console.log("[NativeAudio] nativeToggleShuffle() called:", enabled);
  const api = await getNativeApi();
  await api.toggleShuffle(enabled);
}

/**
 * Send a debug log message from JS to native logcat.
 * These appear under the NativeAudioPlugin tag as "[JS] message".
 * Works in both debug and release builds (unlike console.log).
 */
export async function nativeDebugLog(message: string): Promise<void> {
  try {
    const api = await getNativeApi();
    await api.debugLog(message);
  } catch {
    // Silently ignore if native audio isn't available
  }
}
