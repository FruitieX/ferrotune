import { invoke } from "@tauri-apps/api/core";
import type { PlaybackState } from "./types";

// Re-export types
export * from "./types";

/**
 * Start or resume playback
 */
export async function play(): Promise<void> {
  await invoke("plugin:native-audio|play");
}

/**
 * Pause playback
 */
export async function pause(): Promise<void> {
  await invoke("plugin:native-audio|pause");
}

/**
 * Stop playback completely
 */
export async function stop(): Promise<void> {
  await invoke("plugin:native-audio|stop");
}

/**
 * Seek to a specific position
 * @param positionMs Position in milliseconds
 */
export async function seek(positionMs: number): Promise<void> {
  await invoke("plugin:native-audio|seek", { positionMs });
}

/**
 * Get the current playback state
 * @returns Current playback state
 */
export async function getState(): Promise<PlaybackState> {
  return await invoke<PlaybackState>("plugin:native-audio|get_state");
}

/**
 * Set the playback volume
 * @param volume Volume level (0.0 to 1.0)
 */
export async function setVolume(volume: number): Promise<void> {
  await invoke("plugin:native-audio|set_volume", { volume });
}

/**
 * Set ReplayGain boost/attenuation in millibels.
 * Uses Android's LoudnessEnhancer for digital gain.
 * @param gainMb Gain in millibels (e.g., -6500 for -6.5 dB, 3000 for +3 dB)
 */
export async function setReplayGain(gainMb: number): Promise<void> {
  await invoke("plugin:native-audio|set_replay_gain", { gainMb });
}

/**
 * Skip to the next track in the queue
 */
export async function nextTrack(): Promise<void> {
  await invoke("plugin:native-audio|next_track");
}

/**
 * Skip to the previous track in the queue
 */
export async function previousTrack(): Promise<void> {
  await invoke("plugin:native-audio|previous_track");
}

/**
 * Jump to a specific queue index and start playback.
 */
export async function playAtIndex(index: number): Promise<void> {
  await invoke("plugin:native-audio|play_at_index", { index });
}

/**
 * Set repeat mode
 * @param mode Repeat mode ("off", "one", "all")
 */
export async function setRepeatMode(mode: string): Promise<void> {
  await invoke("plugin:native-audio|set_repeat_mode", { mode });
}

/**
 * Update the starred state of the current track (for WearOS button icon)
 * @param starred Whether the current track is starred
 */
export async function updateStarredState(starred: boolean): Promise<void> {
  await invoke("plugin:native-audio|update_starred_state", { starred });
}

/**
 * Get safe area insets (top/bottom in dp) for edge-to-edge display
 */
export async function getSafeAreaInsets(): Promise<{ top: number; bottom: number }> {
  return await invoke<{ top: number; bottom: number }>("plugin:native-audio|get_safe_area_insets");
}

/**
 * Initialize session configuration for direct server API calls from native side.
 */
export async function initSession(config: {
  serverUrl: string;
  username: string;
  password?: string;
  apiKey?: string;
  sessionId?: string;
}): Promise<void> {
  await invoke("plugin:native-audio|init_session", {
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    apiKey: config.apiKey,
    sessionId: config.sessionId,
  });
}

/**
 * Update playback settings (ReplayGain, transcoding, scrobble threshold).
 */
export async function updateSettings(settings: {
  replayGainMode: string;
  replayGainOffset: number;
  scrobbleThreshold: number;
  transcodingEnabled: boolean;
  transcodingBitrate: number;
}): Promise<void> {
  await invoke("plugin:native-audio|update_settings", {
    replayGainMode: settings.replayGainMode,
    replayGainOffset: settings.replayGainOffset,
    scrobbleThreshold: settings.scrobbleThreshold,
    transcodingEnabled: settings.transcodingEnabled,
    transcodingBitrate: settings.transcodingBitrate,
  });
}

/**
 * Start playback where Kotlin manages the queue.
 */
export async function startPlayback(params: {
  totalCount: number;
  currentIndex: number;
  isShuffled: boolean;
  repeatMode: string;
  playWhenReady: boolean;
  startPositionMs: number;
  sessionId?: string;
  sourceType?: string;
  sourceId?: string;
}): Promise<void> {
  await invoke("plugin:native-audio|start_playback", {
    totalCount: params.totalCount,
    currentIndex: params.currentIndex,
    isShuffled: params.isShuffled,
    repeatMode: params.repeatMode,
    playWhenReady: params.playWhenReady,
    startPositionMs: params.startPositionMs,
    sessionId: params.sessionId,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
  });
}

/**
 * Invalidate the queue window and refetch from server.
 * Call after reordering, adding, or removing tracks.
 */
export async function invalidateQueue(): Promise<void> {
  await invoke("plugin:native-audio|invalidate_queue");
}

/**
 * Soft invalidate: update total count and prefetch without rebuilding
 * the ExoPlayer playlist. Use for add-to-queue operations to avoid
 * interrupting current playback.
 */
export async function softInvalidateQueue(totalCount: number): Promise<void> {
  await invoke("plugin:native-audio|soft_invalidate_queue", { totalCount });
}

/**
 * Toggle shuffle in autonomous mode.
 * Tells the server to shuffle/unshuffle, then refetches the queue window.
 */
export async function toggleShuffle(enabled: boolean): Promise<void> {
  await invoke("plugin:native-audio|toggle_shuffle", { enabled });
}

/**
 * Debug log: send a message from JS to native logcat.
 * Appears in logcat under the NativeAudioPlugin tag as "[JS] message".
 */
export async function debugLog(message: string): Promise<void> {
  await invoke("plugin:native-audio|debug_log", { message });
}
