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

interface StateChangeEvent {
  state: NativePlaybackState;
}

interface ProgressEvent {
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
}

interface ErrorEvent {
  message: string;
  trackId?: string;
}

interface TrackChangeEvent {
  track?: NativeTrackInfo;
  queueIndex: number;
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
  onTrackChange: (track: NativeTrackInfo | undefined, queueIndex: number) => void;
}

/**
 * Unsubscribe functions for event listeners
 */
type UnlistenFn = () => void;

/**
 * Native audio engine state
 */
interface NativeEngineState {
  initialized: boolean;
  unlisteners: UnlistenFn[];
  callbacks: NativeAudioCallbacks | null;
}

const engineState: NativeEngineState = {
  initialized: false,
  unlisteners: [],
  callbacks: null,
};

/**
 * Initialize the native audio engine.
 * Sets up event listeners for state changes, progress, errors, and track changes.
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
    const api = await getNativeApi();
    engineState.callbacks = callbacks;

    // Set up event listeners
    const stateUnlisten = await api.onStateChange((event: StateChangeEvent) => {
      console.log("[NativeAudio] State change:", event.state.status);
      const appState = mapNativeStatusToAppState(event.state.status);
      engineState.callbacks?.onStateChange(appState);
    });
    engineState.unlisteners.push(stateUnlisten);

    const progressUnlisten = await api.onProgress((event: ProgressEvent) => {
      engineState.callbacks?.onProgress(
        event.positionMs / 1000, // Convert to seconds
        event.durationMs / 1000,
        event.bufferedMs / 1000,
      );
    });
    engineState.unlisteners.push(progressUnlisten);

    const errorUnlisten = await api.onError((event: ErrorEvent) => {
      console.error("[NativeAudio] Error:", event.message);
      engineState.callbacks?.onError(event.message, event.trackId);
    });
    engineState.unlisteners.push(errorUnlisten);

    const trackUnlisten = await api.onTrackChange((event: TrackChangeEvent) => {
      console.log("[NativeAudio] Track change:", event.track?.title);
      engineState.callbacks?.onTrackChange(event.track, event.queueIndex);
    });
    engineState.unlisteners.push(trackUnlisten);

    engineState.initialized = true;
    console.log("[NativeAudio] Native audio engine initialized");
  } catch (error) {
    console.error("[NativeAudio] Failed to initialize:", error);
    throw error;
  }
}

/**
 * Clean up the native audio engine.
 * Removes all event listeners.
 */
export async function cleanupNativeAudioEngine(): Promise<void> {
  console.log("[NativeAudio] Cleaning up native audio engine");

  for (const unlisten of engineState.unlisteners) {
    unlisten();
  }

  engineState.unlisteners = [];
  engineState.callbacks = null;
  engineState.initialized = false;
}

/**
 * Convert a Song to native track info
 */
function songToNativeTrack(
  song: Song,
  client: ReturnType<typeof getClient>,
): NativeTrackInfo {
  if (!client) {
    throw new Error("Client not available");
  }

  return {
    id: song.id,
    url: client.getStreamUrl(song.id),
    title: song.title,
    artist: song.artist || "Unknown Artist",
    album: song.album || "Unknown Album",
    coverArtUrl: song.coverArt ? client.getCoverArtUrl(song.coverArt, 512) : undefined,
    durationMs: (song.duration || 0) * 1000,
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
): Promise<void> {
  console.log("[NativeAudio] nativeSetTrack() called:", song.title);
  const api = await getNativeApi();
  const track = songToNativeTrack(song, client);
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
): Promise<void> {
  const api = await getNativeApi();
  const tracks = songs.map((song) => songToNativeTrack(song, client));
  await api.setQueue(tracks, startIndex);
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
 * Set playback volume (0.0 to 1.0)
 */
export async function nativeSetVolume(volume: number): Promise<void> {
  const api = await getNativeApi();
  await api.setVolume(volume);
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
}> {
  const api = await getNativeApi();
  const nativeState = await api.getState();

  return {
    state: mapNativeStatusToAppState(nativeState.status),
    positionSeconds: nativeState.positionMs / 1000,
    durationSeconds: nativeState.durationMs / 1000,
    volume: nativeState.volume,
    queueIndex: nativeState.queueIndex,
  };
}
