/**
 * Shared type interfaces for audio engine callbacks and handlers.
 *
 * These define the shapes of the state/setter refs that are passed
 * into factory functions (createNativeCallbacks, createWebAudioHandlers, etc.)
 * to avoid stale closures in event handlers and callbacks.
 */

import type {
  PlaybackState,
  PlaybackError,
  ReplayGainMode,
} from "@/lib/store/player";
import type { Song } from "@/lib/api/types";
import type { ServerQueueState } from "@/lib/store/server-queue";
import type { QueueWindow } from "@/lib/api/generated/QueueWindow";
import type { ServerConnection } from "@/lib/api/types";
import type { NativeStreamOptions } from "@/lib/audio/native-engine";

/** Snapshot of reactive state, kept in sync via ref for use in callbacks. */
export interface EngineStateSnapshot {
  playbackState: PlaybackState;
  hasScrobbled: boolean;
  scrobbleThreshold: number;
  currentSong: Song | null;
  nextSong: Song | null;
  queueState: ServerQueueState | null;
  queueWindow: QueueWindow | null;
  isRestoringQueue: boolean;
  transcodingEnabled: boolean;
  transcodingBitrate: number;
  replayGainMode: ReplayGainMode;
  replayGainOffset: number;
  clippingDetectionEnabled: boolean;
  starredItems: Map<string, boolean>;
  serverConnection: ServerConnection | null;
  currentSessionId: string | null;
}

/** Setter functions, kept in sync via ref for use in callbacks. */
export interface EngineSetters {
  setPlaybackState: (state: PlaybackState) => void;
  setPlaybackError: (error: PlaybackError | null) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setBuffered: (buffered: number) => void;
  setHasScrobbled: (v: boolean) => void;
  setAudioElement: (el: HTMLAudioElement) => void;
  setClippingState: (
    state: { peakOverDbAt100: number; lastClipTime: number } | null,
  ) => void;
  invalidatePlayCountQueries: () => void;
  goToNext: () => void;
  goToPrevious: () => void;
  setServerQueueState: (
    updater:
      | ServerQueueState
      | null
      | ((prev: ServerQueueState | null) => ServerQueueState | null),
  ) => void;
  setQueueWindow: (
    updater:
      | QueueWindow
      | null
      | ((prev: QueueWindow | null) => QueueWindow | null),
  ) => void;
  setStarredItems: (
    updater:
      | Map<string, boolean>
      | ((prev: Map<string, boolean>) => Map<string, boolean>),
  ) => void;
}

/** Build NativeStreamOptions from the current state snapshot. */
export function getNativeStreamOptions(state: {
  transcodingEnabled: boolean;
  transcodingBitrate: number;
  replayGainMode: ReplayGainMode;
  replayGainOffset: number;
}): NativeStreamOptions {
  return {
    transcodingEnabled: state.transcodingEnabled,
    transcodingBitrate: state.transcodingBitrate,
    replayGainMode: state.replayGainMode,
    replayGainOffset: state.replayGainOffset,
  };
}
