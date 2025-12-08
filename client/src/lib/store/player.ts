import { atom } from "jotai";
import { atomWithServerStorage } from "./server-storage";

// Playback state
export type PlaybackState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error";
export const playbackStateAtom = atom<PlaybackState>("idle");

// Playback error details
export interface PlaybackError {
  message: string;
  trackId?: string;
  trackTitle?: string;
  timestamp: number;
}
export const playbackErrorAtom = atom<PlaybackError | null>(null);

// Time tracking
export const currentTimeAtom = atom<number>(0);
export const durationAtom = atom<number>(0);
export const bufferedAtom = atom<number>(0);

// Progress percentage (0-100)
export const progressAtom = atom((get) => {
  const currentTime = get(currentTimeAtom);
  const duration = get(durationAtom);
  return duration > 0 ? (currentTime / duration) * 100 : 0;
});

// Volume (0-1)
export const volumeAtom = atomWithServerStorage("volume", 1);
export const isMutedAtom = atomWithServerStorage("muted", false);

// Effective volume (considering mute state)
export const effectiveVolumeAtom = atom((get) => {
  const volume = get(volumeAtom);
  const isMuted = get(isMutedAtom);
  return isMuted ? 0 : volume;
});

// Repeat mode
export type RepeatMode = "off" | "all" | "one";
export const repeatModeAtom = atomWithServerStorage<RepeatMode>(
  "repeat",
  "off",
);

// Scrobble tracking
export const hasScrobbledAtom = atom<boolean>(false);
export const scrobbleThresholdAtom = atom<number>(0.5); // 50% of track

// Audio element reference (for imperative control)
export const audioElementAtom = atom<HTMLAudioElement | null>(null);
