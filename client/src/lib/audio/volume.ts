/**
 * Volume Utilities
 *
 * Converts between linear slider position (0-1) and logarithmic volume
 * for more natural-feeling volume control that matches human hearing.
 *
 * Human hearing is logarithmic, so a linear volume slider doesn't feel natural -
 * moving from 10% to 20% sounds like a much bigger change than 80% to 90%.
 * This utility applies an exponential curve so perceived loudness changes
 * evenly across the slider range.
 */

// Exponent for the volume curve (2-4 is typical, 3 gives a nice balance)
const VOLUME_EXPONENT = 3;

/**
 * Convert a linear slider position (0-1) to logarithmic volume (0-1).
 * This is applied when setting volume on audio elements.
 *
 * @param linear - Linear value from 0 to 1 (slider position)
 * @returns Logarithmic volume from 0 to 1
 */
export function linearToLogVolume(linear: number): number {
  // Clamp to valid range
  const clamped = Math.max(0, Math.min(1, linear));
  // Apply exponential curve: volume = linear^exponent
  return Math.pow(clamped, VOLUME_EXPONENT);
}

/**
 * Convert a logarithmic volume (0-1) to linear slider position (0-1).
 * This is the inverse operation, used if we need to display actual volume
 * on a linear slider (though typically we just store/display linear values).
 *
 * @param log - Logarithmic volume from 0 to 1
 * @returns Linear slider position from 0 to 1
 */
export function logToLinearVolume(log: number): number {
  // Clamp to valid range
  const clamped = Math.max(0, Math.min(1, log));
  // Apply inverse: linear = volume^(1/exponent)
  return Math.pow(clamped, 1 / VOLUME_EXPONENT);
}
