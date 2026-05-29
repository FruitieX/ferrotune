/**
 * Haptic feedback utility for mobile/touch interactions.
 * Uses the Vibration API where available (Android, some iOS PWAs).
 * Silently no-ops on unsupported platforms.
 */

/** Very subtle feedback - e.g. toggling a switch, scrubbing past a threshold */
export function hapticTick() {
  try {
    navigator.vibrate?.(5);
  } catch {
    /* ignore */
  }
}

/** Light feedback - e.g. tapping a nav item, pressing a button */
export function hapticTap() {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* ignore */
  }
}

/** Medium feedback - e.g. completing a seek, confirming an action */
export function hapticConfirm() {
  try {
    navigator.vibrate?.(15);
  } catch {
    /* ignore */
  }
}

/** Heavy feedback - e.g. gesture threshold reached, destructive action */
export function hapticHeavy() {
  try {
    navigator.vibrate?.(25);
  } catch {
    /* ignore */
  }
}

/**
 * Scrub/seek haptic - fires a tick when crossing a "notch".
 * Use this during continuous scrubbing to give tactile feedback
 * at regular intervals (e.g. every N percent).
 *
 * @returns true if a tick was fired (caller should track last notch)
 */
export function hapticScrubNotch(
  currentValue: number,
  lastNotchValue: number,
  notchSize: number,
): boolean {
  const crossed =
    Math.floor(currentValue / notchSize) !==
    Math.floor(lastNotchValue / notchSize);
  if (crossed) {
    hapticTick();
  }
  return crossed;
}
