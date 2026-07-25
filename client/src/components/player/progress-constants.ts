/**
 * Progress UI updates do not need to run at the display refresh rate. The
 * CSS transition between these updates keeps the indicator moving smoothly
 * while avoiding a React render (or canvas redraw) for every animation frame.
 */
export const PROGRESS_UPDATE_INTERVAL_MS = 250;

/** Keep the tapped-position label visible briefly after a touch seek. */
export const TOUCH_PROGRESS_PREVIEW_DURATION_MS = 1000;
