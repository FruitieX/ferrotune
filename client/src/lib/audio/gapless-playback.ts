import type { ReplayGainMode } from "@/lib/store/player";
import { getClient } from "@/lib/api/client";
import { setCurrentStreamTimeOffset } from "./seeking-control";
import {
  audioElements,
  activeIndex,
  preBufferReady,
  preBufferedTrackId,
  preBufferedStreamUrl,
  PRE_BUFFER_LEAD_TIME,
  setActiveIndex,
  setPreBufferedTrackId,
  setPreBufferedStreamUrl,
  setPreBufferReady,
  getGainNode,
  setReplayGain,
  getTrackReplayGain,
  resumeAudioContext,
} from "./web-audio";

interface SongWithReplayGain {
  id: string;
  replayGainTrackGain?: number | null;
  originalReplayGainTrackGain?: number | null;
  computedReplayGainTrackGain?: number | null;
  duration?: number | null;
}

interface GaplessHandoffSetters {
  setAudioElement: (el: HTMLAudioElement) => void;
  setHasScrobbled: (v: boolean) => void;
  setCurrentTime: (v: number) => void;
  setBuffered: (v: number) => void;
  setDuration: (v: number) => void;
  goToNext: () => void;
}

interface EngineStateCallbacks {
  setCurrentLoadedTrackId: (id: string | null) => void;
  setIsGaplessHandoff: (v: boolean) => void;
  setGaplessHandoffExpectedTrackId: (id: string | null) => void;
}

/**
 * Attempt a gapless handoff to the pre-buffered track.
 * Swaps the active audio element to the pre-buffered one, applies ReplayGain,
 * resets tracking state, and starts playback immediately.
 *
 * @returns true if handoff was performed, false if pre-buffer not ready.
 */
export function performGaplessHandoff(
  state: {
    nextSong: SongWithReplayGain | null;
    replayGainMode: ReplayGainMode;
    replayGainOffset: number;
  },
  setters: GaplessHandoffSetters,
  lastStreamUrlRef: { current: string | null },
  engineCallbacks: EngineStateCallbacks,
): boolean {
  if (!preBufferReady || !preBufferedTrackId) return false;

  console.log("[Audio] Gapless handoff: swapping to pre-buffered element");
  const handoffTrackId = preBufferedTrackId;
  engineCallbacks.setIsGaplessHandoff(true);
  engineCallbacks.setGaplessHandoffExpectedTrackId(handoffTrackId);

  // Swap active index
  const oldActiveIdx = activeIndex;
  const newActiveIdx: 0 | 1 = activeIndex === 0 ? 1 : 0;
  setActiveIndex(newActiveIdx);

  // Mute the old element
  const oldNode = getGainNode(oldActiveIdx);
  if (oldNode) {
    oldNode.gain.value = 0;
  }

  // Apply ReplayGain to the new active element
  if (state.nextSong && state.replayGainMode !== "disabled") {
    const trackGain = getTrackReplayGain(state.nextSong, state.replayGainMode);
    const totalGain = trackGain + state.replayGainOffset;
    setReplayGain(totalGain, newActiveIdx);
  } else {
    const newNode = getGainNode(newActiveIdx);
    if (newNode) {
      // ReplayGain disabled: set unity gain
      newNode.gain.value = 1;
    }
  }

  // Update the audio element atom so the rest of the app knows
  setters.setAudioElement(audioElements[activeIndex]!);

  // Reset tracking for the new active element
  engineCallbacks.setCurrentLoadedTrackId(handoffTrackId);
  setCurrentStreamTimeOffset(0);
  // Update lastStreamUrlRef so the track-load effect's SKIP check
  // catches the subsequent SSE-triggered re-run and avoids reloading
  lastStreamUrlRef.current = preBufferedStreamUrl;
  setPreBufferedTrackId(null);
  setPreBufferedStreamUrl(null);
  setPreBufferReady(false);

  // Reset scrobble tracking for new track
  setters.setHasScrobbled(false);
  setters.setCurrentTime(0);
  setters.setBuffered(0);
  if (state.nextSong) {
    setters.setDuration(state.nextSong.duration || 0);
  }

  // Play the pre-buffered element immediately (should be instant)
  resumeAudioContext().then(() => {
    audioElements[activeIndex]?.play().catch(console.error);
  });

  // Update server state asynchronously (fire-and-forget)
  setters.goToNext();

  // Clean up old element
  const oldElement = audioElements[oldActiveIdx];
  if (oldElement) {
    oldElement.pause();
    oldElement.removeAttribute("src");
    oldElement.load();
  }

  return true;
}

/**
 * Start pre-buffering the next track on the inactive audio element.
 * Should be called when the current track is within PRE_BUFFER_LEAD_TIME of ending.
 */
export function startPreBuffering(
  nextSongData: SongWithReplayGain,
  transcodingState: { transcodingEnabled: boolean; transcodingBitrate: number },
): void {
  const client = getClient();
  if (!client) return;

  const inactiveIdx = activeIndex === 0 ? 1 : 0;
  const inactiveAudio = audioElements[inactiveIdx];
  if (!inactiveAudio) return;

  console.log("[Audio] Pre-buffering next track:", nextSongData.id);
  setPreBufferedTrackId(nextSongData.id);
  setPreBufferReady(false);

  // Build stream URL for the next track
  const streamUrl = client.getStreamUrl(nextSongData.id, {
    maxBitRate: transcodingState.transcodingEnabled
      ? transcodingState.transcodingBitrate
      : undefined,
    format: transcodingState.transcodingEnabled ? "opus" : undefined,
  });
  setPreBufferedStreamUrl(streamUrl);

  // Keep inactive element gain at 0 until handoff
  const inactiveNode = getGainNode(inactiveIdx);
  if (inactiveNode) {
    inactiveNode.gain.value = 0;
  }

  // Load the stream
  inactiveAudio.src = streamUrl;
  inactiveAudio.load();
}

/**
 * Check if the current track is near the end and trigger pre-buffering.
 * Called from handleTimeUpdate.
 */
export function checkAndStartPreBuffering(
  activeAudio: HTMLAudioElement,
  duration: number,
  state: {
    nextSong: SongWithReplayGain | null;
    queueState: { repeatMode?: string } | null;
    transcodingEnabled: boolean;
    transcodingBitrate: number;
  },
): void {
  if (
    duration > 0 &&
    !preBufferedTrackId &&
    state.queueState?.repeatMode !== "one" &&
    activeAudio.currentTime > duration - PRE_BUFFER_LEAD_TIME
  ) {
    if (state.nextSong) {
      startPreBuffering(state.nextSong, state);
    }
  }
}
