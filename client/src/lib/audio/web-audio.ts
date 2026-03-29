import type { ReplayGainMode } from "@/lib/store/player";

// ============================================================================
// Dual Audio Element System for Gapless Playback
// ============================================================================
// Two audio elements are used: one active (playing) and one inactive (pre-buffering).
// Each has its own MediaElementAudioSourceNode → GainNode, both feeding into a shared
// AnalyserNode → AudioContext.destination. The inactive element's gain is 0.
// When the active track ends, we swap: the pre-buffered element becomes active immediately.

// Dual audio elements for gapless playback
export const audioElements: [HTMLAudioElement | null, HTMLAudioElement | null] =
  [null, null];
export let activeIndex: 0 | 1 = 0;

// Web Audio API nodes - dual gain nodes, shared analyser
export let audioContext: AudioContext | null = null;
const sourceNodes: [
  MediaElementAudioSourceNode | null,
  MediaElementAudioSourceNode | null,
] = [null, null];
const gainNodes: [GainNode | null, GainNode | null] = [null, null];
export let analyserNode: AnalyserNode | null = null;

// Pre-buffering state
export let preBufferedTrackId: string | null = null;
export let preBufferedStreamUrl: string | null = null;
export let preBufferReady = false;
// Time in seconds before track end to start pre-buffering
export const PRE_BUFFER_LEAD_TIME = 15;

/**
 * Convert ReplayGain dB value to linear gain factor.
 * ReplayGain values are typically negative (e.g., -6.5 dB).
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Get the correct ReplayGain track gain value based on the current mode.
 * - "computed": prefer computed, fall back to original
 * - "original": use only original tag values
 */
export function getTrackReplayGain(
  song: {
    computedReplayGainTrackGain?: number | null;
    originalReplayGainTrackGain?: number | null;
    replayGainTrackGain?: number | null;
  },
  mode: ReplayGainMode,
): number {
  if (mode === "original") {
    return song.originalReplayGainTrackGain ?? 0;
  }
  // "computed" mode: prefer computed, fall back to original
  return (
    song.computedReplayGainTrackGain ?? song.originalReplayGainTrackGain ?? 0
  );
}

/**
 * Initialize Web Audio API for ReplayGain processing with dual audio elements.
 * Creates an AudioContext, two source/gain chains, and a shared analyser.
 * Both chains feed into: sourceNode → gainNode → analyserNode → destination
 * The inactive element's gain is set to 0 to prevent audio bleed.
 */
export function initializeWebAudio(
  audio0: HTMLAudioElement,
  audio1: HTMLAudioElement,
): void {
  if (audioContext) return; // Already initialized

  try {
    console.log(
      "[Audio] Initializing Web Audio API with dual elements for gapless playback",
    );
    audioContext = new AudioContext();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.connect(audioContext.destination);

    // Create source and gain nodes for each element
    for (const [i, audio] of [audio0, audio1].entries()) {
      sourceNodes[i as 0 | 1] = audioContext.createMediaElementSource(audio);
      gainNodes[i as 0 | 1] = audioContext.createGain();
      // Connect: source → gain → analyser
      sourceNodes[i as 0 | 1]!.connect(gainNodes[i as 0 | 1]!);
      gainNodes[i as 0 | 1]!.connect(analyserNode);
    }

    // Set inactive element gain to 0
    const inactiveIdx = activeIndex === 0 ? 1 : 0;
    gainNodes[inactiveIdx]!.gain.value = 0;

    console.log(
      "[Audio] Web Audio API initialized with dual elements, AudioContext state:",
      audioContext.state,
    );
  } catch (err) {
    console.error("[Audio] Failed to initialize Web Audio API:", err);
  }
}

/**
 * Resume the AudioContext if it's suspended.
 * Must be called from a user gesture handler (like clicking play).
 * Returns true if the context is running after this call.
 */
export async function resumeAudioContext(): Promise<boolean> {
  if (!audioContext) {
    console.warn("[Audio] Cannot resume: AudioContext not initialized");
    return false;
  }

  console.log("[Audio] AudioContext state before resume:", audioContext.state);

  if (audioContext.state === "suspended") {
    console.log("[Audio] Resuming suspended AudioContext...");
    try {
      await audioContext.resume();
      console.log("[Audio] AudioContext resumed, state:", audioContext.state);
    } catch (err) {
      console.error("[Audio] Failed to resume AudioContext:", err);
      return false;
    }
  } else if (audioContext.state === "closed") {
    console.error("[Audio] AudioContext is closed, cannot resume");
    return false;
  }

  return audioContext.state === "running";
}

/**
 * Update the ReplayGain volume adjustment for a specific audio element.
 * @param gainDb - The gain in dB to apply (can be negative)
 * @param elementIndex - Which audio element's gain to adjust (0 or 1). Defaults to active element.
 */
export function setReplayGain(gainDb: number, elementIndex?: 0 | 1): void {
  const idx = elementIndex ?? activeIndex;
  const node = gainNodes[idx];
  if (!node) {
    console.warn(
      "[Audio] Cannot set ReplayGain: gainNode not initialized for element",
      idx,
    );
    return;
  }

  const linearGain = dbToLinear(gainDb);
  // Clamp to prevent extreme values (max +12dB boost)
  const clampedGain = Math.min(linearGain, dbToLinear(12));
  node.gain.value = clampedGain;
  console.log(
    `[Audio] ReplayGain set on element ${idx}: ${gainDb.toFixed(2)} dB -> linear gain ${clampedGain.toFixed(4)}`,
  );
}

/**
 * Creates an audio element for gapless playback.
 * Uses `preload="auto"` for full buffering and enables CORS for Web Audio API.
 */
export function createAudioElement(): HTMLAudioElement {
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
  audio.setAttribute("aria-hidden", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);
  return audio;
}

/**
 * Gets or creates the dual audio elements for gapless playback.
 * Returns the currently active audio element.
 */
export function getGlobalAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (!audioElements[0]) {
    audioElements[0] = createAudioElement();
    audioElements[1] = createAudioElement();
  }
  return audioElements[activeIndex];
}

/** Gets the currently active audio element without creating elements. */
export function getActiveAudio(): HTMLAudioElement | null {
  return audioElements[activeIndex];
}

/** Gets the inactive (pre-buffer) audio element. */
export function getInactiveAudio(): HTMLAudioElement | null {
  return audioElements[activeIndex === 0 ? 1 : 0];
}

/** Invalidates the pre-buffer state, clearing any pre-loaded track. */
export function invalidatePreBuffer(): void {
  const inactiveAudio = getInactiveAudio();
  if (inactiveAudio && preBufferedTrackId) {
    console.log(
      "[Audio] Invalidating pre-buffer for track:",
      preBufferedTrackId,
    );
    inactiveAudio.pause();
    inactiveAudio.removeAttribute("src");
    inactiveAudio.load();
  }
  preBufferedTrackId = null;
  preBufferedStreamUrl = null;
  preBufferReady = false;
}

/** Set the active audio element index. */
export function setActiveIndex(idx: 0 | 1): void {
  activeIndex = idx;
}

/** Set pre-buffer tracking state. */
export function setPreBufferedTrackId(id: string | null): void {
  preBufferedTrackId = id;
}

export function setPreBufferedStreamUrl(url: string | null): void {
  preBufferedStreamUrl = url;
}

export function setPreBufferReady(ready: boolean): void {
  preBufferReady = ready;
}

/** Get the gain node for a specific element index. */
export function getGainNode(idx: 0 | 1): GainNode | null {
  return gainNodes[idx];
}
