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
