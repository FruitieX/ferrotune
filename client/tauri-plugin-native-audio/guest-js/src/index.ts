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
 * Set the playback queue
 * @param items Queue items
 * @param startIndex Index to start playback from
 */
export async function setQueue(
  items: QueueItem[],
  startIndex: number
): Promise<void> {
  await invoke("plugin:native-audio|set_queue", { items, startIndex });
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
 * Get safe area insets (top/bottom in dp) for edge-to-edge display
 */
export async function getSafeAreaInsets(): Promise<{ top: number; bottom: number }> {
  return await invoke<{ top: number; bottom: number }>("plugin:native-audio|get_safe_area_insets");
}
