import type { ReplayGainMode } from "@/lib/store/player";
import { getClient } from "@/lib/api/client";
import { setCurrentStreamTimeOffset } from "./seeking-control";
import {
  audioElements,
  activeIndex,
  preBufferReady,
  preBufferedTrackId,
  preBufferedStreamUrl,
  preBufferBackoffUntil,
  PRE_BUFFER_LEAD_TIME,
  setActiveIndex,
  setPreBufferedTrackId,
  setPreBufferedStreamUrl,
  setPreBufferReady,
  setPreBufferBackoffUntil,
  getGainNode,
  setReplayGain,
  getTrackReplayGain,
  resumeAudioContext,
  invalidatePreBuffer,
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

// Bounded retry/backoff for pre-buffer failures. A failed pre-buffer load
// (expired URL token -> 401, or a transient network drop) must not re-fire on
// every timeupdate tick. We back off with increasing delays and force a token
// refresh between attempts in case the failure was an expired credential.
const PRE_BUFFER_RETRY_DELAYS = [1000, 2000, 4000, 8000];
const PRE_BUFFER_GIVE_UP_COOLDOWN_MS = 30_000;
let preBufferRetryCount = 0;

/** Reset pre-buffer retry/backoff state after a successful (re)buffer or handoff. */
export function resetPreBufferRetry(): void {
  preBufferRetryCount = 0;
  setPreBufferBackoffUntil(0);
}

/**
 * Handle a pre-buffer (inactive element) load error without spinning.
 * Invalidates the stale pre-buffer, schedules a backoff window so
 * checkAndStartPreBuffering retries later (not instantly), and force-refreshes
 * the URL token in case the failure was caused by token expiry.
 */
export function handlePreBufferError(): void {
  // Clear the failed pre-buffer; this resets preBufferedTrackId so a retry can
  // start once the backoff window elapses.
  invalidatePreBuffer();

  if (preBufferRetryCount >= PRE_BUFFER_RETRY_DELAYS.length) {
    console.warn(
      "[Audio] Pre-buffer failed repeatedly; backing off before retrying",
    );
    setPreBufferBackoffUntil(Date.now() + PRE_BUFFER_GIVE_UP_COOLDOWN_MS);
    preBufferRetryCount = 0;
    return;
  }

  const delay = PRE_BUFFER_RETRY_DELAYS[preBufferRetryCount]!;
  preBufferRetryCount += 1;
  setPreBufferBackoffUntil(Date.now() + delay);
  console.log(
    `[Audio] Pre-buffer error; retrying in ${delay}ms (attempt ${preBufferRetryCount}/${PRE_BUFFER_RETRY_DELAYS.length})`,
  );

  // Best-effort token refresh so the retry uses a fresh credential. Safe to
  // call repeatedly; it no-ops while a refresh is unnecessary on the server.
  const client = getClient();
  void client?.refreshUrlToken().catch((error) => {
    console.warn("[Audio] Token refresh after pre-buffer error failed", error);
  });
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
  resetPreBufferRetry();

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
    Date.now() >= preBufferBackoffUntil &&
    state.queueState?.repeatMode !== "one" &&
    activeAudio.currentTime > duration - PRE_BUFFER_LEAD_TIME
  ) {
    if (state.nextSong) {
      startPreBuffering(state.nextSong, state);
    }
  }
}
