import { atom } from "jotai";

// Number of bars in the waveform (doubled for higher resolution)
export const WAVEFORM_BAR_COUNT = 400;

// Default flat height for unanalyzed bars (visual "dots")
export const FLAT_BAR_HEIGHT = 0.15;

// Waveform data for each track, keyed by track ID
export interface WaveformData {
  // Normalized heights for display (0.15 to 1.0)
  heights: number[];
  // Whether the waveform has been loaded
  isLoaded: boolean;
}

// Cache of waveform data per track ID
export const waveformCacheAtom = atom<Map<string, WaveformData>>(new Map());

// Currently loading track ID (for showing loading state)
export const loadingWaveformIdAtom = atom<string | null>(null);
