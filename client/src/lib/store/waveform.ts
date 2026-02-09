import { atom } from "jotai";

// Number of bars in the waveform (doubled for higher resolution)
export const WAVEFORM_BAR_COUNT = 600;

// Default flat height for unanalyzed bars (visual "dots")
export const FLAT_BAR_HEIGHT = 0.15;

// Waveform data for each track, keyed by track ID
export interface WaveformData {
  // Normalized heights for display (0.15 to 1.0)
  heights: number[];
  // Whether the waveform has been loaded
  isLoaded: boolean;
  // Actual decoded audio duration in seconds (precise, from actual decoding)
  // Used for waveform-to-playback synchronization
  actualDuration: number | null;
}

// Cache of waveform data per track ID
export const waveformCacheAtom = atom<Map<string, WaveformData>>(new Map());

// Currently loading track ID (for showing loading state)
export const loadingWaveformIdAtom = atom<string | null>(null);

// Chunk animation info - tracks which bars were just updated
// Used for animating new chunk bars from left to right
export interface ChunkAnimationInfo {
  // Start index of the bars that were just updated
  startIndex: number;
  // End index (exclusive) of the bars that were just updated
  endIndex: number;
  // Timestamp when this chunk was received
  timestamp: number;
}

export const lastChunkInfoAtom = atom<ChunkAnimationInfo | null>(null);

// Actual decoded duration for the current waveform, keyed by track ID
// This is the precise duration from actual audio decoding, used for
// synchronizing the waveform progress with audio playback
export const waveformActualDurationAtom = atom<Map<string, number>>(new Map());
