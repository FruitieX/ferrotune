import { atom } from "jotai";

/**
 * Cast state tracks the Chromecast connection and playback state.
 */
export type CastState =
  | "unavailable" // No Cast devices available
  | "available" // Cast devices present, not connected
  | "connecting" // Connecting to a Cast device
  | "connected"; // Connected to a Cast device

export const castStateAtom = atom<CastState>("unavailable");

/** Name of the connected Cast device */
export const castDeviceNameAtom = atom<string | null>(null);

/** Whether the Cast SDK has been loaded */
export const castSdkLoadedAtom = atom(false);

/** Whether we are actively casting (connected and playing media) */
export const isCastingAtom = atom((get) => get(castStateAtom) === "connected");
