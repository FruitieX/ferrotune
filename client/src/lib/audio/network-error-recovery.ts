/**
 * Network error recovery and stall detection for Web Audio playback.
 *
 * Extracted from hooks.ts — manages automatic retry on network errors
 * and transitions to error state when streams stall without progress.
 */
import { toast } from "sonner";
import { audioElements, activeIndex, resumeAudioContext } from "./web-audio";
import { handlePreBufferError } from "./gapless-playback";
import { getClient } from "@/lib/api/client";

// Re-export for type safety of the deps interface
import type { PlaybackState } from "@/lib/store/player";

export interface NetworkErrorDeps {
  stateRef: React.RefObject<{
    currentSong: { id: string; title: string; artist?: string } | null;
    playbackState: PlaybackState;
  }>;
  settersRef: React.RefObject<{
    setPlaybackState: (state: PlaybackState) => void;
    setPlaybackError: (
      error: {
        message: string;
        trackId?: string;
        trackTitle?: string;
        timestamp: number;
      } | null,
    ) => void;
  }>;
  isFromActive: (e: Event) => boolean;
  getIsIntentionalStop: () => boolean;
  setIsLoadingNewTrack: (v: boolean) => void;
  getCurrentStreamTimeOffset: () => number;
  setCurrentStreamTimeOffset: (v: number) => void;
}

export interface NetworkErrorHandlers {
  handleWaiting: (e: Event) => void;
  handleStalled: (e: Event) => void;
  handlePlaying: (e: Event) => void;
  handleError: (e: Event) => void;
  clearStallTimer: () => void;
}

const STALL_TIMEOUT_MS = 12_000;
const NETWORK_RETRY_DELAYS = [2000, 5000, 10000];

export function createNetworkErrorHandlers(
  deps: NetworkErrorDeps,
): NetworkErrorHandlers {
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let networkRetryCount = 0;

  const clearStallTimer = () => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };

  const startStallTimer = () => {
    if (stallTimer !== null) return; // already running
    stallTimer = setTimeout(() => {
      stallTimer = null;
      console.warn(
        "[Audio] Stall timeout: no progress after",
        STALL_TIMEOUT_MS,
        "ms",
      );
      deps.settersRef.current.setPlaybackState("error");
      deps.settersRef.current.setPlaybackError({
        message: "Stream stalled — server may be unavailable",
        trackId: deps.stateRef.current.currentSong?.id,
        trackTitle: deps.stateRef.current.currentSong?.title,
        timestamp: Date.now(),
      });
      const trackName =
        deps.stateRef.current.currentSong?.title || "Unknown track";
      toast.error(`Playback stalled: ${trackName}`, {
        description: "Stream stalled — server may be unavailable",
        duration: 5000,
      });
    }, STALL_TIMEOUT_MS);
  };

  const handleWaiting = (e: Event) => {
    if (!deps.isFromActive(e)) return;
    console.log("[Audio] waiting event (buffering)");
    const state = deps.stateRef.current;
    if (state.playbackState !== "ended" && state.playbackState !== "idle") {
      deps.settersRef.current.setPlaybackState("loading");
      startStallTimer();
    }
  };

  const handleStalled = (e: Event) => {
    if (!deps.isFromActive(e)) return;
    console.log("[Audio] stalled event (no data arriving)");
    const state = deps.stateRef.current;
    // Only start the stall timer if we're actually in a loading/waiting state.
    // The browser fires "stalled" when the network fetch stops receiving data,
    // which is normal when the file is fully buffered. If we're already playing,
    // timeupdate events prove playback is fine.
    if (
      state.playbackState !== "ended" &&
      state.playbackState !== "idle" &&
      state.playbackState !== "playing"
    ) {
      startStallTimer();
    }
  };

  const handlePlaying = (e: Event) => {
    if (!deps.isFromActive(e)) return;
    console.log("[Audio] playing event on active element");
    clearStallTimer();
    networkRetryCount = 0; // reset retry count on successful playback
    deps.settersRef.current.setPlaybackError(null);
    deps.settersRef.current.setPlaybackState("playing");
  };

  const handleError = (e: Event) => {
    // Skip errors from inactive (pre-buffer) element — recover via bounded
    // retry/backoff (with a token refresh) instead of spinning.
    if (!deps.isFromActive(e)) {
      console.warn(
        "[Audio] Error on inactive (pre-buffer) element, scheduling pre-buffer retry",
      );
      handlePreBufferError();
      return;
    }

    clearStallTimer();

    if (deps.getIsIntentionalStop()) {
      console.log("[Audio] Ignoring error during intentional stop");
      return;
    }

    const audioElement = e.target as HTMLAudioElement;
    const mediaError = audioElement?.error;
    const state = deps.stateRef.current;

    if (
      !audioElement?.src ||
      audioElement.src === "" ||
      audioElement.src === window.location.href
    ) {
      console.log("[Audio] Ignoring error from empty/cleared src");
      return;
    }

    let errorMessage = "Failed to play track";
    if (mediaError) {
      switch (mediaError.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMessage = "Playback was aborted";
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage = "Network error while loading track";
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage = "Could not decode audio file";
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = "Audio format not supported or file not found";
          break;
      }
    }

    console.error("[Audio] Playback error:", errorMessage, mediaError);

    // Auto-retry on recoverable errors:
    //  - MEDIA_ERR_NETWORK: server restart, dropped connection, wifi<->cellular
    //    handoff, etc.
    //  - MEDIA_ERR_SRC_NOT_SUPPORTED: a non-media response, which is what an
    //    expired/invalid URL token (HTTP 401) looks like to the audio element.
    // Both are retried with backoff and a forced URL-token refresh so playback
    // resumes once connectivity returns or the credential is renewed.
    const isRecoverableError =
      mediaError?.code === MediaError.MEDIA_ERR_NETWORK ||
      mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
    if (isRecoverableError && networkRetryCount < NETWORK_RETRY_DELAYS.length) {
      const delay = NETWORK_RETRY_DELAYS[networkRetryCount]!;
      networkRetryCount++;
      console.log(
        `[Audio] Recoverable playback error, auto-retrying in ${delay}ms (attempt ${networkRetryCount}/${NETWORK_RETRY_DELAYS.length})`,
      );
      deps.settersRef.current.setPlaybackState("loading");
      deps.settersRef.current.setPlaybackError({
        message: `Connection issue — retrying (${networkRetryCount}/${NETWORK_RETRY_DELAYS.length})…`,
        trackId: state.currentSong?.id,
        trackTitle: state.currentSong?.title,
        timestamp: Date.now(),
      });
      setTimeout(() => {
        void (async () => {
          // Only retry if we're still in loading/error state (user may have
          // navigated away or paused)
          const currentState = deps.stateRef.current.playbackState;
          if (currentState !== "loading" && currentState !== "error") {
            return;
          }

          const activeAudio = audioElements[activeIndex];
          if (!activeAudio?.src) {
            return;
          }

          // Force-refresh the URL token in case the failure was an expired
          // credential. Best-effort: a transient network outage will make this
          // throw, but reloading the existing URL still recovers once the
          // connection returns.
          const client = getClient();
          if (client) {
            try {
              await client.refreshUrlToken();
            } catch (error) {
              console.warn(
                "[Audio] Token refresh during retry failed (will retry with existing token)",
                error,
              );
            }
          }

          // Re-check state after the awaited refresh.
          const stateAfterRefresh = deps.stateRef.current.playbackState;
          if (
            stateAfterRefresh !== "loading" &&
            stateAfterRefresh !== "error"
          ) {
            return;
          }

          // Rebuild the source URL with the freshest token so an expired-token
          // failure isn't retried with the same stale credential.
          const currentSrc = client
            ? client.withFreshUrlToken(activeAudio.src)
            : activeAudio.src;
          const resumeTime = Number.isFinite(activeAudio.currentTime)
            ? activeAudio.currentTime
            : 0;
          const streamTimeOffset = deps.getCurrentStreamTimeOffset();
          const restoreRetryPosition = () => {
            if (resumeTime <= 0) return;
            try {
              activeAudio.currentTime = resumeTime;
            } catch (error) {
              console.warn("[Audio] Failed to restore retry position:", error);
            }
          };

          activeAudio.addEventListener("loadedmetadata", restoreRetryPosition, {
            once: true,
          });
          activeAudio.src = "";
          activeAudio.src = currentSrc;
          deps.setCurrentStreamTimeOffset(streamTimeOffset);
          deps.setIsLoadingNewTrack(true);
          activeAudio.load();
          resumeAudioContext().then(() => {
            activeAudio.play().catch(console.error);
          });
        })();
      }, delay);
      return;
    }

    deps.settersRef.current.setPlaybackError({
      message: errorMessage,
      trackId: state.currentSong?.id,
      trackTitle: state.currentSong?.title,
      timestamp: Date.now(),
    });
    deps.settersRef.current.setPlaybackState("error");

    const trackName = state.currentSong?.title || "Unknown track";
    toast.error(`Playback failed: ${trackName}`, {
      description: errorMessage,
      duration: 5000,
    });
  };

  return {
    handleWaiting,
    handleStalled,
    handlePlaying,
    handleError,
    clearStallTimer,
  };
}
