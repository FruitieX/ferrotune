import { invoke } from "@tauri-apps/api/core";
import type {
  PlaybackState,
  TrackInfo,
  QueueItem,
} from "./types";

// Re-export types
export * from "./types";

/**
 * Start or resume playback
 */
export async function play(): Promise<void> {
  await invoke("plugin:native-audio|play");
}

/**
 * Request that the next setQueue() call auto-starts playback.
 * Called from atom writes to decouple the play decision from React effects.
 */
export async function requestPlayback(): Promise<void> {
  await invoke("plugin:native-audio|request_playback");
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
 * Set the current track to play
 * @param track Track information
 */
export async function setTrack(track: TrackInfo): Promise<void> {
  await invoke("plugin:native-audio|set_track", { track });
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
 * Set the playback queue
 * @param items Queue items
 * @param startIndex Index to start playback from
 * @param queueOffset Offset of first item relative to full server queue
 * @param startPositionMs Position in ms to start from
 * @param playWhenReady Whether to start playback immediately
 */
export async function setQueue(
  items: QueueItem[],
  startIndex: number,
  queueOffset: number = 0,
  startPositionMs: number = 0,
  playWhenReady: boolean = false,
): Promise<void> {
  await invoke("plugin:native-audio|set_queue", { items, startIndex, queueOffset, startPositionMs, playWhenReady });
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
 * Set repeat mode
 * @param mode Repeat mode ("off", "one", "all")
 */
export async function setRepeatMode(mode: string): Promise<void> {
  await invoke("plugin:native-audio|set_repeat_mode", { mode });
}

/**
 * Append items to the end of the playback queue
 * @param items Queue items to append
 */
export async function appendToQueue(items: QueueItem[]): Promise<void> {
  await invoke("plugin:native-audio|append_to_queue", { items });
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
 * Must be called before startAutonomousPlayback().
 */
export async function initSession(config: {
  serverUrl: string;
  username: string;
  password?: string;
  apiKey?: string;
}): Promise<void> {
  await invoke("plugin:native-audio|init_session", {
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    apiKey: config.apiKey,
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
 * Start autonomous playback mode where Kotlin manages the queue.
 */
export async function startAutonomousPlayback(params: {
  totalCount: number;
  currentIndex: number;
  isShuffled: boolean;
  repeatMode: string;
  playWhenReady: boolean;
  startPositionMs: number;
}): Promise<void> {
  await invoke("plugin:native-audio|start_autonomous_playback", {
    totalCount: params.totalCount,
    currentIndex: params.currentIndex,
    isShuffled: params.isShuffled,
    repeatMode: params.repeatMode,
    playWhenReady: params.playWhenReady,
    startPositionMs: params.startPositionMs,
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
