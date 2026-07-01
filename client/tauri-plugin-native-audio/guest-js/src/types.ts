/**
 * Playback status enum
 */
export type PlaybackStatus =
  | "Idle"
  | "Buffering"
  | "Playing"
  | "Paused"
  | "Ended"
  | "Error";

/**
 * Track information for playback
 */
export interface TrackInfo {
  /** Unique identifier for the track */
  id: string;
  /** Stream URL for the audio */
  url: string;
  /** Track title */
  title: string;
  /** Artist name */
  artist: string;
  /** Album name */
  album: string;
  /** Cover art URL (optional) */
  coverArtUrl?: string;
  /** Track duration in milliseconds */
  durationMs: number;
  /** Pre-computed ReplayGain in dB (optional, applied natively on track transitions) */
  replayGainDb?: number;
}

/**
 * Queue item (same as TrackInfo for now)
 */
export type QueueItem = TrackInfo;

/**
 * Full playback state
 */
export interface PlaybackState {
  /** Current playback status */
  status: PlaybackStatus;
  /** Current position in milliseconds */
  positionMs: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Current volume (0.0 to 1.0) */
  volume: number;
  /** Whether playback is muted */
  muted: boolean;
  /** Current track info (if any) */
  track?: TrackInfo;
  /** Current index in the queue */
  queueIndex: number;
  /** Total queue length */
  queueLength: number;
}

/**
 * State change event payload
 */
export interface StateChangeEvent {
  state: PlaybackState;
}

/**
 * Progress update event payload
 */
export interface ProgressEvent {
  /** Current position in milliseconds */
  positionMs: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Buffered position in milliseconds */
  bufferedMs: number;
}

/**
 * Error event payload
 */
export interface ErrorEvent {
  /** Error message */
  message: string;
  /** ID of the track that caused the error (if applicable) */
  trackId?: string;
  /** Native playback error category */
  category?: "auth" | "network" | "http" | "source-missing" | "range" | "decode" | "unknown";
  /** HTTP response code when the failure came from an HTTP stream request */
  httpStatusCode?: number;
  /** Media3 PlaybackException error code */
  errorCode?: number;
  /** Whether native playback considered the error retryable */
  retryable?: boolean;
}

/**
 * Track change event payload
 */
export interface TrackChangeEvent {
  /** New track info (null if no track) */
  track?: TrackInfo;
  /** Current index in the queue */
  queueIndex: number;
}

export type CastConnectionState = "unavailable" | "available" | "connecting" | "connected";

export type CastPlayerState = "idle" | "playing" | "paused" | "buffering" | "unknown";

export type CastIdleReason = "finished" | "canceled" | "interrupted" | "error";

export interface CastMediaStatus {
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  playerState: CastPlayerState;
  idleReason?: CastIdleReason;
  songId?: string | null;
  queuePosition?: number;
  title?: string | null;
  artist?: string | null;
  volume?: number;
  isMuted?: boolean;
}

export interface CastStateSnapshot {
  state: CastConnectionState;
  deviceName?: string | null;
  mediaStatus?: CastMediaStatus;
}

export interface LoadCastMediaParams {
  url: string;
  contentType: string;
  songId: string;
  title: string;
  artist: string;
  album?: string | null;
  coverArtUrl?: string | null;
  durationMs: number;
  startTimeMs: number;
  currentIndex?: number;
  repeatMode?: "off" | "all" | "one";
  queueItems?: LoadCastMediaQueueItemParams[];
}

export interface LoadCastMediaQueueItemParams {
  url: string;
  contentType: string;
  songId: string;
  title: string;
  artist: string;
  album?: string | null;
  coverArtUrl?: string | null;
  durationMs: number;
  position: number;
}

// ===== Offline downloads =====

/**
 * Per-content download status. Matches the KotlinDownloadStatus enum
 * emitted by the native DownloadManager.
 */
export type DownloadStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "removing"
  | "paused";

/**
 * Download format options for offline tracks.
 * - "opus" transcodes to Opus at `maxBitRate` kbps (default 128).
 * - "original" downloads the source file as-is (no transcoding).
 */
export type DownloadFormat = "opus" | "original";

/**
 * Snapshot of a single download's state. Emitted individually within the
 * `DownloadStateEventPayload.downloads` array of `download-state-changed`
 * events, and also returned by `getDownloads()`.
 */
export interface DownloadInfo {
  /** Cache content id, e.g. `audio:<songId>` or `cover:<coverArtId>`. */
  contentId: string;
  /** Source song id (without the `audio:` prefix). */
  songId: string;
  /** Either "audio" or "cover". Phase 1 only emits audio downloads. */
  kind: "audio" | "cover" | "unknown";
  status: DownloadStatus;
  /** 0–100 (or -1 if total size unknown). */
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
  failureReason?: string;
}

/**
 * Payload of the `download-state-changed` event. Carries snapshots of all
 * downloads that changed state in this update plus the global pause /
 * not-met-requirements flags so JS can refresh atomically.
 */
export interface DownloadStateEventPayload {
  downloads: DownloadInfo[];
  paused: boolean;
  /**媒体3 RequirementFlags OR-mask; 0 means all requirements met. */
  notMetRequirements: number;
}

/** Response shape of `getDownloads()`. */
export interface GetDownloadsResponse {
  downloads: DownloadInfo[];
}
