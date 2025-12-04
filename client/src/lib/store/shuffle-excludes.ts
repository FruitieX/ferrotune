"use client";

import { atom } from "jotai";

/**
 * Set of song IDs that are excluded from shuffle playback.
 * This is synced with the server and used during shuffle operations.
 */
export const shuffleExcludesAtom = atom<Set<string>>(new Set<string>());

/**
 * Loading state for shuffle excludes
 */
export const shuffleExcludesLoadingAtom = atom<boolean>(false);
