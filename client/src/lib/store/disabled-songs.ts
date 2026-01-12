"use client";

import { atom } from "jotai";

/**
 * Set of song IDs that are disabled by the user.
 * Disabled songs are not automatically included in playback queues
 * and show up as grayed out in library views.
 */
export const disabledSongsAtom = atom<Set<string>>(new Set<string>());

/**
 * Loading state for disabled songs
 */
export const disabledSongsLoadingAtom = atom<boolean>(false);
