import type { ClippingState } from "@/lib/store/player";

const CONSOLE_WARN_DEBOUNCE_MS = 1000;
const ANALYSIS_INTERVAL_MS = 50; // ~20Hz sampling (cheaper than rAF)
// Grace period after a volume change during which analysis is skipped.
// The AnalyserNode's time-domain buffer holds ~46ms (2048 samples) of history.
// After a volume change, those stale samples were rendered at the *previous*
// volume, so dividing them by the new volume produces a bogus peak (false
// clipping when lowering volume). Skip until the buffer has fully turned over.
const VOLUME_CHANGE_GRACE_MS = 150;
const VOLUME_EPSILON = 0.0001;

let animFrameId: ReturnType<typeof setInterval> | null = null;
let lastConsoleWarnTime = 0;
let timeDomainData: Float32Array<ArrayBuffer> | null = null;
let maxPeakAt100Linear = 0;
let lastVolume = -1;
let skipUntilMs = 0;

/**
 * Starts real-time clipping detection using an AnalyserNode.
 * Reads post-gain PCM samples and detects when peaks would exceed 0 dBFS
 * at 100% volume (normalizing out the current volume level).
 *
 * Console warnings are debounced to max once per second.
 * The clipping atom is updated on every detection for UI rendering.
 *
 * @param volumeGetter - Returns the current effective volume (0-1).
 *   Used to normalize peaks to what they'd be at 100% volume.
 */
export function startClippingDetection(
  analyserNode: AnalyserNode,
  setClippingState: (update: ClippingState | null) => void,
  volumeGetter: () => number,
): void {
  stopClippingDetection();

  if (!timeDomainData || timeDomainData.length !== analyserNode.fftSize) {
    timeDomainData = new Float32Array(analyserNode.fftSize);
  }

  animFrameId = setInterval(() => {
    const now = Date.now();
    const currentVolume = volumeGetter();
    // Can't normalize if volume is 0 (muted) — skip analysis
    if (currentVolume <= 0) return;

    // If the volume just changed, the analyser buffer still holds samples
    // rendered at the previous volume. Dividing those by the new volume would
    // produce a false clipping reading (esp. when lowering volume). Wait for
    // the buffer to fully turn over before analyzing again.
    if (Math.abs(currentVolume - lastVolume) > VOLUME_EPSILON) {
      lastVolume = currentVolume;
      skipUntilMs = now + VOLUME_CHANGE_GRACE_MS;
    }
    if (now < skipUntilMs) return;

    analyserNode.getFloatTimeDomainData(timeDomainData!);

    let maxAbsSample = 0;
    for (let i = 0; i < timeDomainData!.length; i++) {
      const abs = Math.abs(timeDomainData![i]);
      if (abs > maxAbsSample) maxAbsSample = abs;
    }

    // Normalize to 100% volume
    const peakAt100 = maxAbsSample / currentVolume;

    if (peakAt100 >= 1.0) {
      const peakOverDbAt100 = 20 * Math.log10(peakAt100);

      if (now - lastConsoleWarnTime >= CONSOLE_WARN_DEBOUNCE_MS) {
        console.warn(
          `[Audio] Clipping at 100% volume: peak +${peakOverDbAt100.toFixed(1)} dB over 0 dBFS — reduce ReplayGain offset by ${peakOverDbAt100.toFixed(1)} dB to fix`,
        );
        lastConsoleWarnTime = now;
      }

      maxPeakAt100Linear = Math.max(maxPeakAt100Linear, peakAt100);
      const maxPeakOverDbAt100 = 20 * Math.log10(maxPeakAt100Linear);
      setClippingState({
        peakOverDbAt100: maxPeakOverDbAt100,
        lastClipTime: now,
      });
    }
  }, ANALYSIS_INTERVAL_MS);
}

/**
 * Stops real-time clipping detection and cleans up the interval.
 */
export function stopClippingDetection(): void {
  if (animFrameId !== null) {
    clearInterval(animFrameId);
    animFrameId = null;
  }
}

/**
 * Resets the max peak tracker. Call when switching tracks.
 */
export function resetClippingPeak(): void {
  maxPeakAt100Linear = 0;
}
