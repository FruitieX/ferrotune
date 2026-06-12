/**
 * Haptic feedback utility for mobile/touch interactions.
 *
 * Backed by the Vibration API (Android WebView, most Chromium-based PWAs).
 * On iOS Safari the API is unavailable and all calls are silent no-ops.
 *
 * Each helper expresses a *semantic* event (selection, tap, toggle, star, …)
 * rather than a raw millisecond count, so call sites stay readable and the
 * physical "feel" of each interaction lives in a single place.
 *
 * Patterns are short, low-intensity and well under iOS/Android heuristic
 * throttling so they feel snappy rather than buzzy. Durations are in ms and
 * follow the navigator.vibrate() convention: alternating on/off values,
 * starting with the first "on" pulse.
 */

/** Internal: fire a vibrate pattern if the API is available. */
function pulse(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore — unsupported platform or permission denied */
  }
}

/**
 * Cancel any in-flight vibration pattern.
 * Useful before triggering a new one so successive haptics don't blur together.
 */
export function hapticCancel(): void {
  pulse(0);
}

// ---------------------------------------------------------------------------
// Generic building blocks
// ---------------------------------------------------------------------------

/** Single soft "tick" — the lightest possible acknowledgement. */
export function hapticTick(): void {
  pulse(3);
}

/** Single light tap — generic button press. */
export function hapticTap(): void {
  pulse(6);
}

/** Light double-pulse — "double-tap" feel, playful and friendly. */
export function hapticDouble(): void {
  pulse([4, 35, 4]);
}

/** Triple gentle pulse — subtle positive reinforcement. */
export function hapticTriple(): void {
  pulse([3, 28, 3, 28, 3]);
}

/** Two-pulse confirm — completing a meaningful but reversible action. */
export function hapticConfirm(): void {
  pulse([5, 28, 5]);
}

/** Firm single pulse — gesture threshold reached, reversible state change. */
export function hapticHeavy(): void {
  pulse(12);
}

/** Long-ish, decisive double pulse — destructive/irreversible. */
export function hapticDestructive(): void {
  pulse([10, 70, 14]);
}

// ---------------------------------------------------------------------------
// Semantic helpers (use these in feature code)
// ---------------------------------------------------------------------------

/** Binary toggle (shuffle, repeat, mute, follow mode, …). Asymmetric to feel distinct from a tap. */
export function hapticToggle(): void {
  pulse([3, 30, 7]);
}

/** Tiny blip for non-committal value changes — sliders, sort menu, filter toggles. */
export function hapticSelection(): void {
  pulse(3);
}

/** Blooming pattern for favoriting — feels like the item "lights up". */
export function hapticStar(): void {
  pulse([2, 30, 3, 30, 8]);
}

/** Soft retract for unfavoriting — gentle, slightly trailing. */
export function hapticUnstar(): void {
  pulse([6, 30, 2]);
}

/** Rising success pattern — for completed async actions (upload done, save ok). */
export function hapticSuccess(): void {
  pulse([4, 45, 4, 45, 9]);
}

/** Two-pulse warning — for confirmations before potentially impactful actions. */
export function hapticWarning(): void {
  pulse([8, 55, 8]);
}

/** Three-pulse error — failed operation, validation failure. */
export function hapticError(): void {
  pulse([8, 45, 8, 45, 8]);
}

/** Notchy "ratchet" tick used while scrubbing past small intervals. */
export function hapticNotch(): void {
  pulse(2);
}

// ---------------------------------------------------------------------------
// Continuous scrubbing helper
// ---------------------------------------------------------------------------

/**
 * Scrub/seek haptic — fires a notch tick when crossing a "ratchet" step.
 * Use during continuous scrubbing for tactile feedback at regular intervals
 * (e.g. every 1% of progress).
 *
 * @returns true if a notch was fired (caller should track last notch value)
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
    hapticNotch();
  }
  return crossed;
}
