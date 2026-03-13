import { atom } from "jotai";

// Default flat height for unloaded bars (visual "dots")
export const FLAT_BAR_HEIGHT = 0.15;

export interface WaveformData {
  heights: number[];
  isLoaded: boolean;
}

export const waveformCacheAtom = atom<Map<string, WaveformData>>(new Map());
export const loadingWaveformIdAtom = atom<string | null>(null);
