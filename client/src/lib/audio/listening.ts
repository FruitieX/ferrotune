import { getClient } from "@/lib/api/client";

const LISTENING_UPDATE_INTERVAL_MS = 60000; // Update every 60 seconds
const SCROBBLE_REQUEST_STALE_MS = 30000;

// Module-level state for listening time tracking
export let playbackStartTime: number | null = null;
export let playbackStartSongId: string | null = null;
export let accumulatedPlayTime: number = 0;
export let currentListeningSessionId: number | null = null;
let listeningUpdateInterval: ReturnType<typeof setInterval> | null = null;
let pendingScrobbleRequest: {
  requestId: number;
  songId: string;
  startedAtMs: number;
} | null = null;
let nextPendingScrobbleRequestId = 1;

function resetListeningTracking(): void {
  playbackStartTime = null;
  playbackStartSongId = null;
  accumulatedPlayTime = 0;
  currentListeningSessionId = null;
}

function hasPendingScrobbleRequestForSong(songId: string): boolean {
  if (!pendingScrobbleRequest) {
    return false;
  }

  if (
    Date.now() - pendingScrobbleRequest.startedAtMs >
    SCROBBLE_REQUEST_STALE_MS
  ) {
    pendingScrobbleRequest = null;
    return false;
  }

  return pendingScrobbleRequest.songId === songId;
}

function startPendingScrobbleRequest(songId: string): number {
  const requestId = nextPendingScrobbleRequestId++;
  pendingScrobbleRequest = {
    requestId,
    songId,
    startedAtMs: Date.now(),
  };
  return requestId;
}

function finishPendingScrobbleRequest(requestId: number): void {
  if (pendingScrobbleRequest?.requestId === requestId) {
    pendingScrobbleRequest = null;
  }
}

/** Calculates the total listening time for the current session. */
export function calculateTotalListeningSeconds(): number {
  let totalSeconds = accumulatedPlayTime;
  if (playbackStartTime !== null) {
    totalSeconds += (Date.now() - playbackStartTime) / 1000;
  }
  return totalSeconds;
}

/**
 * Updates the listening session with current accumulated time.
 * Called periodically during playback and on pause.
 */
export async function updateListeningSession(): Promise<void> {
  if (!playbackStartSongId) return;

  const totalSeconds = calculateTotalListeningSeconds();

  // Only update if listened for at least 5 seconds
  if (totalSeconds < 5) return;

  try {
    const client = getClient();
    if (client) {
      const response = await client.logListening(
        playbackStartSongId,
        Math.round(totalSeconds),
        currentListeningSessionId ?? undefined,
      );
      // Store the session ID for subsequent updates
      currentListeningSessionId = response.sessionId;
    }
  } catch (err) {
    console.warn("[Audio] Failed to update listening session:", err);
  }
}

/** Starts the periodic listening update interval. */
export function startListeningUpdateInterval(): void {
  // Clear any existing interval
  stopListeningUpdateInterval();

  listeningUpdateInterval = setInterval(() => {
    updateListeningSession();
  }, LISTENING_UPDATE_INTERVAL_MS);
}

/** Stops the periodic listening update interval. */
export function stopListeningUpdateInterval(): void {
  if (listeningUpdateInterval) {
    clearInterval(listeningUpdateInterval);
    listeningUpdateInterval = null;
  }
}

/**
 * Logs the listening time for the current song and resets tracking.
 * Should be called when:
 * - A track ends naturally
 * - User skips to next/previous track
 * - Track changes for any other reason
 *
 * Only logs if the user has listened for at least 5 seconds.
 *
 * @param skipped - Whether the song was skipped by the user
 */
export async function logListeningTimeAndReset(skipped = false): Promise<void> {
  // Stop the periodic update interval
  stopListeningUpdateInterval();

  const songId = playbackStartSongId;
  if (!songId) return;

  const totalSeconds = calculateTotalListeningSeconds();
  const sessionId = currentListeningSessionId;

  // Reset immediately so concurrent track-boundary handlers cannot submit the
  // same listening session multiple times while this request is in flight.
  resetListeningTracking();

  // Only log if listened for at least 5 seconds
  if (totalSeconds >= 5) {
    try {
      const client = getClient();
      if (client) {
        // Final update with the session ID
        await client.logListening(
          songId,
          Math.round(totalSeconds),
          sessionId ?? undefined,
          skipped,
        );
      }
    } catch (err) {
      console.warn("[Audio] Failed to log listening time:", err);
    }
  }
}

/**
 * Set the playback start time.
 * Exported to allow the main audio hook to manage listening state transitions.
 */
export function setPlaybackStartTime(time: number | null): void {
  playbackStartTime = time;
}

/** Set the song ID being tracked for listening. */
export function setPlaybackStartSongId(songId: string | null): void {
  playbackStartSongId = songId;
}

/** Set the accumulated play time. */
export function setAccumulatedPlayTime(time: number): void {
  accumulatedPlayTime = time;
}

/** Set the current listening session ID. */
export function setCurrentListeningSessionId(id: number | null): void {
  currentListeningSessionId = id;
}

/**
 * Check if the scrobble threshold has been reached and submit a scrobble if so.
 * Shared between native onProgress and web handleTimeUpdate paths.
 */
export function checkAndScrobble(
  state: {
    hasScrobbled: boolean;
    scrobbleThreshold: number;
    currentSong: { id: string } | null;
    queueState: { source?: { type?: string; id?: string | null } } | null;
  },
  duration: number,
  setHasScrobbled: (v: boolean) => void,
  invalidatePlayCountQueries: () => void,
): void {
  const currentSongId = state.currentSong?.id;

  if (
    state.hasScrobbled ||
    duration <= 0 ||
    !currentSongId ||
    hasPendingScrobbleRequestForSong(currentSongId)
  ) {
    return;
  }

  const totalListenedSeconds = calculateTotalListeningSeconds();
  const thresholdSeconds = duration * state.scrobbleThreshold;

  if (totalListenedSeconds >= thresholdSeconds) {
    setHasScrobbled(true);
    const client = getClient();
    if (!client) {
      return;
    }

    const requestId = startPendingScrobbleRequest(currentSongId);

    client
      .scrobble(
        currentSongId,
        undefined,
        true,
        state.queueState?.source?.type,
        state.queueState?.source?.id ?? undefined,
      )
      .then(() => {
        invalidatePlayCountQueries();
      })
      .catch(console.error)
      .finally(() => {
        finishPendingScrobbleRequest(requestId);
      });
  }
}
