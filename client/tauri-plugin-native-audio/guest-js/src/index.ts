import { invoke } from "@tauri-apps/api/core";
import type {
  CastMediaStatus,
  CastStateSnapshot,
  DownloadFormat,
  DownloadInfo,
  DownloadStateEventPayload,
  GetDownloadsResponse,
  LoadCastMediaParams,
  OfflineQueueResponse,
  PlaybackState,
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
 * Clear native playback/session state for an account or session boundary.
 */
export async function resetSession(): Promise<void> {
  await invoke("plugin:native-audio|reset_session");
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
  sessionToken?: string;
  sessionExpiresAt?: string;
  sessionId?: string;
  clientId?: string;
}): Promise<void> {
  await invoke("plugin:native-audio|init_session", {
    serverUrl: config.serverUrl,
    username: config.username,
    sessionToken: config.sessionToken,
    sessionExpiresAt: config.sessionExpiresAt,
    sessionId: config.sessionId,
    clientId: config.clientId,
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
 * Start playback from a JS-materialized queue without fetching the server queue.
 * Used for Android offline playback where the server is unreachable but Media3
 * already has completed downloads in its cache.
 */
export async function startOfflinePlayback(params: {
  response: OfflineQueueResponse;
  playWhenReady: boolean;
  startPositionMs: number;
  sessionId?: string;
  sourceType?: string;
  sourceId?: string;
}): Promise<void> {
  await invoke("plugin:native-audio|start_offline_playback", {
    response: params.response,
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
 *
 * @param playWhenReady If provided, forces the native player to start or stay
 * paused after reloading the queue. When omitted, the current playWhenReady
 * state is preserved.
 */
export async function invalidateQueue(playWhenReady?: boolean): Promise<void> {
  await invoke("plugin:native-audio|invalidate_queue", {
    playWhenReady,
  });
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

export async function getCastState(): Promise<CastStateSnapshot> {
  return await invoke<CastStateSnapshot>("plugin:native-audio|get_cast_state");
}

export async function requestCastSession(): Promise<void> {
  await invoke("plugin:native-audio|request_cast_session");
}

export async function stopCastSession(): Promise<void> {
  await invoke("plugin:native-audio|stop_cast_session");
}

export async function loadCastMedia(params: LoadCastMediaParams): Promise<void> {
  await invoke("plugin:native-audio|load_cast_media", {
    url: params.url,
    contentType: params.contentType,
    songId: params.songId,
    title: params.title,
    artist: params.artist,
    album: params.album,
    coverArtUrl: params.coverArtUrl,
    durationMs: params.durationMs,
    startTimeMs: params.startTimeMs,
    currentIndex: params.currentIndex,
    repeatMode: params.repeatMode,
    queueItems: params.queueItems,
  });
}

export async function playCastMedia(): Promise<void> {
  await invoke("plugin:native-audio|play_cast_media");
}

export async function pauseCastMedia(): Promise<void> {
  await invoke("plugin:native-audio|pause_cast_media");
}

export async function stopCastMedia(): Promise<void> {
  await invoke("plugin:native-audio|stop_cast_media");
}

export async function seekCastMedia(positionMs: number): Promise<void> {
  await invoke("plugin:native-audio|seek_cast_media", { positionMs });
}

export async function setCastVolume(volume: number, muted: boolean): Promise<void> {
  await invoke("plugin:native-audio|set_cast_volume", { volume, muted });
}

export async function getCastMediaStatus(): Promise<CastMediaStatus> {
  return await invoke<CastMediaStatus>("plugin:native-audio|get_cast_media_status");
}

// ===== Offline downloads =====

/**
 * Enqueue a song for offline download.
 *
 * @param songId Ferrotune song id (the value passed as `?id=` to `/api/stream`).
 * @param format `"opus"` for transcoded Opus at the given bitrate (default),
 *                or `"original"` to fetch the source file as-is.
 * @param maxBitRate Target bitrate in kbps when `format === "opus"`. Ignored
 *                   when `format === "original"`. Defaults to 128.
 */
export async function enqueueDownload(
  songId: string,
  format: DownloadFormat = "opus",
  maxBitRate: number = 128,
): Promise<void> {
  await invoke("plugin:native-audio|enqueue_download", {
    songId,
    format,
    maxBitRate,
  });
}

/**
 * Cancel an active download or remove a completed one from disk for the
 * given song. No-op if the song isn't downloaded.
 */
export async function removeDownload(songId: string): Promise<void> {
  await invoke("plugin:native-audio|remove_download", { songId });
}

/**
 * Remove all downloaded content from disk and clear the download index.
 */
export async function removeAllDownloads(): Promise<void> {
  await invoke("plugin:native-audio|remove_all_downloads");
}

/**
 * Pause all in-flight downloads. Already-completed downloads are untouched.
 */
export async function pauseDownloads(): Promise<void> {
  await invoke("plugin:native-audio|pause_downloads");
}

/**
 * Resume any paused or queued downloads.
 */
export async function resumeDownloads(): Promise<void> {
  await invoke("plugin:native-audio|resume_downloads");
}

/**
 * Snapshot of all known downloads (active + completed + failed). Includes
 * progress (bytesDownloaded / bytesTotal / percent) and current state.
 */
export async function getDownloads(): Promise<DownloadInfo[]> {
  const res = await invoke<GetDownloadsResponse>("plugin:native-audio|get_downloads");
  return res.downloads;
}

/**
 * Toggle Wi-Fi-only downloads. When enabled, downloads won't
 * progress over metered connections and will be auto-resumed once an
 * unmetered network is available.
 */
export async function setDownloadWifiOnly(wifiOnly: boolean): Promise<void> {
  await invoke("plugin:native-audio|set_download_wifi_only", { wifiOnly });
}

/**
 * Subscribe to download-state-changed events. The native plugin emits a
 * payload whenever any download's state or progress changes (throttled to
 * ~4 Hz per download id). Returns an unsubscribe function.
 *
 * Uses the same `ferrotune:native-audio-event` CustomEvent channel as the
 * playback events — Tauri's standard event system isn't used (the native
 * plugin deliberately bypasses it for reliability reasons; see
 * NativeAudioPlugin.triggerEvent comments).
 */
export function onDownloadStateChanged(
  handler: (payload: DownloadStateEventPayload) => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ event: string; data: unknown }>).detail;
    if (detail?.event !== "download-state-changed") return;
    handler(detail.data as DownloadStateEventPayload);
  };
  window.addEventListener("ferrotune:native-audio-event", listener);
  return () => window.removeEventListener("ferrotune:native-audio-event", listener);
}
